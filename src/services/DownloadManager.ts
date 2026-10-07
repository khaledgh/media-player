import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { create } from 'zustand';
import { api, OfflineError } from './ApiClient';
import { absPath, ensureDirs, getDb, hasDb, kvGet, kvSet, libraryEvents } from '../data/db';
import { extFor, getSubtreeIds } from '../data/library';

interface DownloadStatus {
  active: { trackId: number; title: string; progress: number }[];
  queued: number;
  waitingForWifi: boolean;
  wifiOnly: boolean;
}

export const useDownloadStatus = create<DownloadStatus>(() => ({
  active: [],
  queued: 0,
  waitingForWifi: false,
  wifiOnly: true,
}));

const CONCURRENCY = 2;

/** Tracks the user wants on this device: everything in folders with auto-download on. */
const WANTED = `
  SELECT DISTINCT t.id, t.remote_id, t.title, t.mime, t.has_cover FROM tracks t
  JOIN items i ON i.track_id = t.id JOIN folders f ON f.id = i.folder_id
  WHERE f.auto_download = 1 AND t.remote_id IS NOT NULL AND t.download_state IN ('none', 'queued')`;

class DownloadManager {
  private workers = 0;
  private inFlight = new Set<number>();
  private tasks = new Map<number, FileSystem.DownloadResumable>();

  async init() {
    const v = await kvGet('wifi_only');
    useDownloadStatus.setState({ wifiOnly: v !== '0' });
    // Downloads cut off by an app kill, and earlier failures, get another try.
    await getDb().runAsync(`UPDATE tracks SET download_state = 'none' WHERE download_state IN ('downloading', 'error')`);
  }

  async setWifiOnly(on: boolean) {
    await kvSet('wifi_only', on ? '1' : '0');
    useDownloadStatus.setState({ wifiOnly: on });
    this.kick();
  }

  /** Starts workers if there is anything to download. Safe to call often. */
  kick() {
    if (!hasDb()) return;
    this.refreshCount();
    while (this.workers < CONCURRENCY) {
      this.workers++;
      this.worker().finally(() => {
        this.workers--;
        this.refreshCount();
      });
    }
  }

  async cancelAll() {
    for (const t of this.tasks.values()) await t.pauseAsync().catch(() => {});
    this.tasks.clear();
    this.inFlight.clear();
    useDownloadStatus.setState({ active: [], queued: 0 });
  }

  private async refreshCount() {
    if (!hasDb()) return;
    const r = await getDb()
      .getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM (${WANTED})`)
      .catch(() => null);
    useDownloadStatus.setState({ queued: Math.max(0, (r?.n ?? 0) - this.inFlight.size) });
  }

  private async canDownload() {
    try {
      const s = await Network.getNetworkStateAsync();
      if (!s.isConnected) return false;
      const wifi = s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET;
      const blocked = useDownloadStatus.getState().wifiOnly && !wifi;
      useDownloadStatus.setState({ waitingForWifi: blocked });
      return !blocked;
    } catch {
      return true;
    }
  }

  private async worker() {
    await ensureDirs();
    for (;;) {
      if (!hasDb() || !api.user || !(await this.canDownload())) return;
      const exclude = [...this.inFlight];
      const next = await getDb().getFirstAsync<{ id: number; remote_id: number; title: string; mime: string; has_cover: number }>(
        `${WANTED} ${exclude.length ? `AND t.id NOT IN (${exclude.join(',')})` : ''} ORDER BY i.added_at DESC LIMIT 1`,
      );
      if (!next) return;
      this.inFlight.add(next.id);
      try {
        await this.download(next);
      } catch (e) {
        if (e instanceof OfflineError) return;
        console.warn('[downloads] failed', next.title, e);
        await getDb().runAsync(`UPDATE tracks SET download_state = 'error' WHERE id = ?`, [next.id]);
      } finally {
        this.inFlight.delete(next.id);
        this.tasks.delete(next.id);
        useDownloadStatus.setState((s) => ({ active: s.active.filter((a) => a.trackId !== next.id) }));
        libraryEvents.emit();
      }
    }
  }

  private async download(t: { id: number; remote_id: number; title: string; mime: string; has_cover: number }) {
    const db = getDb();
    await db.runAsync(`UPDATE tracks SET download_state = 'downloading' WHERE id = ?`, [t.id]);
    libraryEvents.emit();
    useDownloadStatus.setState((s) => ({ active: [...s.active, { trackId: t.id, title: t.title, progress: 0 }] }));

    const urls = await api.get<{ url: string; cover_url?: string }>(`/tracks/${t.remote_id}/url`);
    const rel = `music/${t.remote_id}.${extFor(t.mime)}`;
    const task = FileSystem.createDownloadResumable(urls.url, absPath(rel)!, {}, (p) => {
      const progress = p.totalBytesExpectedToWrite > 0 ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0;
      useDownloadStatus.setState((s) => ({ active: s.active.map((a) => (a.trackId === t.id ? { ...a, progress } : a)) }));
    });
    this.tasks.set(t.id, task);
    let res;
    try {
      res = await task.downloadAsync();
    } catch {
      await db.runAsync(`UPDATE tracks SET download_state = 'none' WHERE id = ?`, [t.id]);
      throw new OfflineError('Download interrupted');
    }
    if (!res || res.status !== 200) {
      await FileSystem.deleteAsync(absPath(rel)!, { idempotent: true }).catch(() => {});
      throw new Error(`HTTP ${res?.status}`);
    }

    let coverRel: string | null = null;
    if (t.has_cover && urls.cover_url) {
      coverRel = `covers/${t.remote_id}.jpg`;
      const c = await FileSystem.downloadAsync(urls.cover_url, absPath(coverRel)!).catch(() => null);
      if (!c || c.status !== 200) coverRel = null;
    }
    await db.runAsync(`UPDATE tracks SET file = ?, cover_file = COALESCE(?, cover_file), download_state = 'done' WHERE id = ?`, [
      rel,
      coverRel,
      t.id,
    ]);
  }

  /** Turns on auto-download for a folder tree so its songs (now and later) are kept offline. */
  async downloadFolder(folderId: number) {
    const ids = await getSubtreeIds(folderId);
    await getDb().runAsync(`UPDATE folders SET auto_download = 1 WHERE id IN (${ids.join(',')})`);
    await getDb().runAsync(
      `UPDATE tracks SET download_state = 'none' WHERE download_state = 'error' AND id IN (SELECT track_id FROM items WHERE folder_id IN (${ids.join(',')}))`,
    );
    libraryEvents.emit();
    this.kick();
  }

  /**
   * Frees space used by a folder tree and stops auto-downloading it. Songs that
   * only exist on this device (not uploaded yet) and songs another auto-download
   * folder still needs are kept.
   */
  async removeFolderDownloads(folderId: number) {
    const db = getDb();
    const ids = (await getSubtreeIds(folderId)).join(',');
    await db.runAsync(`UPDATE folders SET auto_download = 0 WHERE id IN (${ids})`);
    const tracks = await db.getAllAsync<{ id: number; file: string }>(
      `SELECT DISTINCT t.id, t.file FROM tracks t JOIN items i ON i.track_id = t.id
       WHERE i.folder_id IN (${ids}) AND t.download_state = 'done' AND t.remote_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM items i2 JOIN folders f2 ON f2.id = i2.folder_id WHERE i2.track_id = t.id AND f2.auto_download = 1)`,
    );
    await this.deleteFiles(tracks);
    return tracks.length;
  }

  async removeTrackDownload(trackId: number) {
    const t = await getDb().getFirstAsync<{ id: number; file: string; remote_id: number | null }>('SELECT id, file, remote_id FROM tracks WHERE id = ?', [trackId]);
    if (!t?.remote_id) return; // never delete the only copy
    await this.deleteFiles([t]);
  }

  async downloadTrack(trackId: number) {
    await getDb().runAsync(`UPDATE tracks SET download_state = 'queued' WHERE id = ? AND download_state != 'done'`, [trackId]);
    // A queued track outside auto-download folders is picked up by a one-off pass.
    const t = await getDb().getFirstAsync<{ id: number; remote_id: number; title: string; mime: string; has_cover: number }>(
      'SELECT id, remote_id, title, mime, has_cover FROM tracks WHERE id = ? AND remote_id IS NOT NULL',
      [trackId],
    );
    if (!t || this.inFlight.has(t.id)) return;
    this.inFlight.add(t.id);
    try {
      await ensureDirs();
      await this.download(t);
    } catch (e) {
      await getDb().runAsync(`UPDATE tracks SET download_state = 'error' WHERE id = ?`, [t.id]);
      throw e;
    } finally {
      this.inFlight.delete(t.id);
      useDownloadStatus.setState((s) => ({ active: s.active.filter((a) => a.trackId !== t.id) }));
      libraryEvents.emit();
    }
  }

  private async deleteFiles(tracks: { id: number; file: string | null }[]) {
    const db = getDb();
    for (const t of tracks) {
      if (t.file) await FileSystem.deleteAsync(absPath(t.file)!, { idempotent: true }).catch(() => {});
      await db.runAsync(`UPDATE tracks SET file = NULL, download_state = 'none' WHERE id = ?`, [t.id]);
    }
    libraryEvents.emit();
  }

  /** Removes every downloaded song that is safely stored on the server. */
  async clearAll() {
    await this.cancelAll();
    const db = getDb();
    await db.runAsync('UPDATE folders SET auto_download = 0');
    const tracks = await db.getAllAsync<{ id: number; file: string }>(
      `SELECT id, file FROM tracks WHERE download_state = 'done' AND remote_id IS NOT NULL`,
    );
    await this.deleteFiles(tracks);
  }
}

export default new DownloadManager();

import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { api, ApiError, OfflineError } from './ApiClient';
import { absPath, getDb, hasDb, inTransaction, kvGet, kvSet, libraryEvents } from '../data/db';
import { onOutboxChange, pruneOrphanTracks } from '../data/library';
import type { OutboxOp } from '../data/library';
import DownloadManager from './DownloadManager';

interface SyncStatus {
  syncing: boolean;
  offline: boolean;
  lastSyncAt: number | null;
  error: string | null;
  firstSyncDone: boolean;
}

export const useSyncStatus = create<SyncStatus>(() => ({
  syncing: false,
  offline: false,
  lastSyncAt: null,
  error: null,
  firstSyncDone: false,
}));

// ---------- wire types (server) ----------

interface RemoteFolder {
  id: number;
  owner_user_id: number | null;
  parent_id: number | null;
  name: string;
  sort_order: number;
  sort_mode: string;
  auto_download: boolean;
  deleted: boolean;
}
interface RemoteItem {
  id: number;
  folder_id: number;
  track_id: number;
  sort_order: number;
  added_at: number;
  deleted: boolean;
}
interface RemoteTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  size_bytes: number;
  mime: string;
  has_cover: boolean;
  source: string;
}
interface PullResult {
  cursor: number;
  visible_folder_ids: number[];
  folders: RemoteFolder[];
  items: RemoteItem[];
  tracks: RemoteTrack[];
}
interface PushResult {
  folders: Record<string, number>;
  items: Record<string, number>;
  errors: { index: number; error: string }[];
}

type WireOp = Record<string, unknown> & { op: string };

class SyncService {
  private running: Promise<void> | null = null;
  private again = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove(): void } | null = null;

  /** Starts background syncing for the signed-in user. */
  start() {
    onOutboxChange(() => this.schedulePush());
    this.appStateSub?.remove();
    this.appStateSub = AppState.addEventListener('change', (s) => s === 'active' && this.run());
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => AppState.currentState === 'active' && this.run(), 15 * 60 * 1000);
    kvGet('first_sync_done').then((v) => useSyncStatus.setState({ firstSyncDone: v === '1' })).catch(() => {});
    this.run();
  }

  stop() {
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.interval) clearInterval(this.interval);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.interval = this.pushTimer = null;
    useSyncStatus.setState({ syncing: false, lastSyncAt: null, error: null, firstSyncDone: false });
  }

  /** Pushes local edits shortly after they happen, batching rapid changes. */
  schedulePush() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.run(), 1500);
  }

  /** Runs a full sync. Concurrent calls collapse into one follow-up run. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.once();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async once() {
    if (!hasDb() || !api.user) return;
    useSyncStatus.setState({ syncing: true });
    try {
      await this.push();
      await this.uploadLocalTracks();
      await this.push(); // item ops queued by uploads
      await this.pull();
      await kvSet('first_sync_done', '1');
      useSyncStatus.setState({ offline: false, error: null, lastSyncAt: Date.now(), firstSyncDone: true });
    } catch (e) {
      if (e instanceof OfflineError) useSyncStatus.setState({ offline: true, error: null });
      else {
        console.warn('[sync] failed:', e);
        useSyncStatus.setState({ error: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      useSyncStatus.setState({ syncing: false });
      DownloadManager.kick();
    }
  }

  // ---------- push ----------

  /**
   * Re-queues personal folders and links that never reached the server
   * (e.g. a create the server rejected because its parent was not synced yet).
   */
  private async requeueUnsynced() {
    const db = getDb();
    const pending = new Set(
      (await db.getAllAsync<{ op: string }>('SELECT op FROM outbox')).map((r) => {
        const o = JSON.parse(r.op) as { op: string; local?: number };
        return `${o.op}:${o.local}`;
      }),
    );
    const folders = await db.getAllAsync<{ id: number }>('SELECT id FROM folders WHERE remote_id IS NULL AND shared = 0 ORDER BY id');
    const items = await db.getAllAsync<{ id: number }>(
      `SELECT i.id FROM items i JOIN tracks t ON t.id = i.track_id JOIN folders f ON f.id = i.folder_id
       WHERE i.remote_id IS NULL AND t.remote_id IS NOT NULL AND f.shared = 0 ORDER BY i.id`,
    );
    for (const f of folders)
      if (!pending.has(`folder.upsert:${f.id}`)) await db.runAsync('INSERT INTO outbox (op) VALUES (?)', [JSON.stringify({ op: 'folder.upsert', local: f.id })]);
    for (const i of items)
      if (!pending.has(`item.upsert:${i.id}`)) await db.runAsync('INSERT INTO outbox (op) VALUES (?)', [JSON.stringify({ op: 'item.upsert', local: i.id })]);
  }

  private async push() {
    const db = getDb();
    await this.requeueUnsynced();
    for (;;) {
      const rows = await db.getAllAsync<{ id: number; op: string }>('SELECT id, op FROM outbox ORDER BY id LIMIT 500');
      if (!rows.length) return;
      const wire: WireOp[] = [];
      for (const r of rows) {
        const op = await this.translate(JSON.parse(r.op) as OutboxOp & { at?: number });
        if (op) wire.push(op);
      }
      if (wire.length) {
        const res = await api.post<PushResult>('/sync/push', { ops: wire });
        await inTransaction(async () => {
          for (const [ref, id] of Object.entries(res.folders)) {
            await db.runAsync('UPDATE folders SET remote_id = NULL WHERE remote_id = ? AND id != ?', [id, Number(ref.slice(1))]);
            await db.runAsync('UPDATE folders SET remote_id = ? WHERE id = ?', [id, Number(ref.slice(1))]);
          }
          for (const [ref, id] of Object.entries(res.items)) {
            await db.runAsync('UPDATE items SET remote_id = NULL WHERE remote_id = ? AND id != ?', [id, Number(ref.slice(1))]);
            await db.runAsync('UPDATE items SET remote_id = ? WHERE id = ?', [id, Number(ref.slice(1))]);
          }
        });
        for (const err of res.errors) console.warn('[sync] server rejected', wire[err.index]?.op, err.error);
      }
      // Sent (or unsendable) ops leave the outbox; the next pull restores server truth.
      await db.runAsync('DELETE FROM outbox WHERE id <= ?', [rows[rows.length - 1].id]);
    }
  }

  private async translate(op: OutboxOp & { at?: number }): Promise<WireOp | null> {
    const db = getDb();
    const at = op.at ?? 0;
    switch (op.op) {
      case 'folder.delete':
        return { op: 'folder.delete', id: op.remote };
      case 'item.delete':
        return { op: 'item.delete', id: op.remote };
      case 'folder.upsert': {
        const f = await db.getFirstAsync<{
          remote_id: number | null;
          parent_id: number | null;
          name: string;
          sort_order: number;
          sort_mode: string;
          auto_download: number;
          shared: number;
        }>('SELECT * FROM folders WHERE id = ?', [op.local]);
        if (!f || f.shared) return null;
        const creating = !f.remote_id;
        const fields = creating || !op.fields ? ['name', 'parent', 'sort_order', 'sort_mode', 'auto_download'] : op.fields;
        const out: WireOp = { op: 'folder.upsert', ref: `f${op.local}`, updated_at: at };
        if (!creating) out.id = f.remote_id;
        if (fields.includes('name')) out.name = f.name;
        if (fields.includes('sort_order')) out.sort_order = f.sort_order;
        if (fields.includes('sort_mode')) out.sort_mode = f.sort_mode;
        if (fields.includes('auto_download')) out.auto_download = !!f.auto_download;
        if (fields.includes('parent')) {
          if (f.parent_id === null) {
            if (!creating) out.to_root = true;
          } else {
            const p = await db.getFirstAsync<{ remote_id: number | null }>('SELECT remote_id FROM folders WHERE id = ?', [f.parent_id]);
            if (p?.remote_id) out.parent_id = p.remote_id;
            else out.parent_ref = `f${f.parent_id}`;
          }
        }
        return out;
      }
      case 'item.upsert': {
        const it = await db.getFirstAsync<{
          remote_id: number | null;
          folder_id: number;
          sort_order: number;
          track_remote: number | null;
          folder_remote: number | null;
          shared: number;
        }>(
          `SELECT i.remote_id, i.folder_id, i.sort_order, t.remote_id AS track_remote, f.remote_id AS folder_remote, f.shared
           FROM items i JOIN tracks t ON t.id = i.track_id JOIN folders f ON f.id = i.folder_id WHERE i.id = ?`,
          [op.local],
        );
        // Tracks not uploaded yet are attached by the upload itself.
        if (!it || it.shared || !it.track_remote) return null;
        const out: WireOp = { op: 'item.upsert', ref: `i${op.local}`, updated_at: at };
        const folder = it.folder_remote ? { folder_id: it.folder_remote } : { folder_ref: `f${it.folder_id}` };
        if (it.remote_id) {
          out.id = it.remote_id;
          if (op.fields?.includes('folder')) Object.assign(out, folder);
          if (!op.fields || op.fields.includes('sort_order')) out.sort_order = it.sort_order;
        } else {
          Object.assign(out, folder, { track_id: it.track_remote, sort_order: it.sort_order });
        }
        return out;
      }
    }
    return null;
  }

  // ---------- uploads of files imported on this device ----------

  private async uploadLocalTracks() {
    const db = getDb();
    const pending = await db.getAllAsync<{ id: number; file: string; title: string }>(
      `SELECT id, file, title FROM tracks WHERE upload_state = 'pending' AND file IS NOT NULL ORDER BY id`,
    );
    for (const t of pending) {
      const target = await db.getFirstAsync<{ item_id: number; folder_remote: number }>(
        `SELECT i.id AS item_id, f.remote_id AS folder_remote FROM items i JOIN folders f ON f.id = i.folder_id
         WHERE i.track_id = ? AND f.remote_id IS NOT NULL AND f.shared = 0 ORDER BY i.id LIMIT 1`,
        [t.id],
      );
      if (!target) continue; // its folder has not reached the server yet
      const path = absPath(t.file)!;
      if (!(await FileSystem.getInfoAsync(path)).exists) {
        await db.runAsync(`UPDATE tracks SET upload_state = 'error' WHERE id = ?`, [t.id]);
        continue;
      }
      const res = await this.uploadFile(path, target.folder_remote, t.title);
      if (!res) {
        await db.runAsync(`UPDATE tracks SET upload_state = 'error' WHERE id = ?`, [t.id]);
        continue;
      }
      await this.adoptUploadedTrack(t.id, res.track_id, target.item_id, res.item_id);
    }
  }

  private async uploadFile(path: string, folderRemote: number, title: string) {
    const send = async () =>
      FileSystem.uploadAsync(api.url(`/tracks/upload?folder_id=${folderRemote}&title=${encodeURIComponent(title)}`), path, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        headers: await api.authHeaders(),
      });
    let r;
    try {
      r = await send();
      if (r.status === 401 && (await api.refresh())) r = await send();
    } catch {
      throw new OfflineError('Upload interrupted');
    }
    if (r.status >= 500) throw new ApiError(r.status, 'Server error during upload');
    if (r.status !== 201) return null;
    return JSON.parse(r.body) as { track_id: number; item_id: number };
  }

  /** Links a local track to its server copy, merging with an existing copy if the server deduplicated it. */
  private async adoptUploadedTrack(localTrack: number, remoteTrack: number, localItem: number, remoteItem: number) {
    const db = getDb();
    await inTransaction(async () => {
      const existing = await db.getFirstAsync<{ id: number; file: string | null }>(
        'SELECT id, file FROM tracks WHERE remote_id = ? AND id != ?',
        [remoteTrack, localTrack],
      );
      let trackId = localTrack;
      if (existing) {
        const mine = await db.getFirstAsync<{ file: string | null }>('SELECT file FROM tracks WHERE id = ?', [localTrack]);
        await db.runAsync('UPDATE OR IGNORE items SET track_id = ? WHERE track_id = ?', [existing.id, localTrack]);
        await db.runAsync('UPDATE OR IGNORE favorites SET track_id = ? WHERE track_id = ?', [existing.id, localTrack]);
        await db.runAsync('UPDATE plays SET track_id = ? WHERE track_id = ?', [existing.id, localTrack]);
        if (!existing.file && mine?.file) {
          await db.runAsync(`UPDATE tracks SET file = ?, download_state = 'done' WHERE id = ?`, [mine.file, existing.id]);
        } else if (mine?.file) {
          await FileSystem.deleteAsync(absPath(mine.file)!, { idempotent: true }).catch(() => {});
        }
        await db.runAsync('DELETE FROM tracks WHERE id = ?', [localTrack]);
        trackId = existing.id;
      } else {
        await db.runAsync(`UPDATE tracks SET remote_id = ?, upload_state = 'done' WHERE id = ?`, [remoteTrack, localTrack]);
      }
      await db.runAsync('UPDATE items SET remote_id = NULL WHERE remote_id = ?', [remoteItem]);
      const item = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM items WHERE id = ? OR (track_id = ? AND folder_id = (SELECT folder_id FROM items WHERE id = ?))',
        [localItem, trackId, localItem],
      );
      if (item) await db.runAsync('UPDATE items SET remote_id = ? WHERE id = ?', [remoteItem, item.id]);
      // The track may sit in other folders too; those links are sent as normal item ops.
      const others = await db.getAllAsync<{ id: number }>('SELECT id FROM items WHERE track_id = ? AND remote_id IS NULL', [trackId]);
      for (const o of others) await db.runAsync('INSERT INTO outbox (op) VALUES (?)', [JSON.stringify({ op: 'item.upsert', local: o.id, at: Date.now() })]);
    });
    libraryEvents.emit();
  }

  // ---------- pull ----------

  private async pull() {
    const db = getDb();
    const me = api.user!.id;
    const since = Number((await kvGet('sync_cursor')) ?? 0);
    const res = await api.get<PullResult>(`/sync?since=${since}`);
    const changed = res.folders.length + res.items.length + res.tracks.length > 0;

    await inTransaction(async () => {
      for (const t of res.tracks) {
        const r = await db.runAsync(
          `UPDATE tracks SET title = ?, artist = ?, album = ?, duration_ms = ?, size_bytes = ?, mime = ?, has_cover = ?, source = ?
           WHERE remote_id = ?`,
          [t.title, t.artist, t.album, t.duration_ms, t.size_bytes, t.mime, t.has_cover ? 1 : 0, t.source, t.id],
        );
        if (!r.changes) {
          await db.runAsync(
            `INSERT INTO tracks (remote_id, title, artist, album, duration_ms, size_bytes, mime, has_cover, source, upload_state, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)`,
            [t.id, t.title, t.artist, t.album, t.duration_ms, t.size_bytes, t.mime, t.has_cover ? 1 : 0, t.source, Date.now()],
          );
        }
      }

      for (const f of res.folders) {
        if (f.deleted) {
          await db.runAsync('DELETE FROM folders WHERE remote_id = ?', [f.id]);
          continue;
        }
        const shared = f.owner_user_id !== me ? 1 : 0;
        const local = await db.getFirstAsync<{ id: number }>('SELECT id FROM folders WHERE remote_id = ?', [f.id]);
        if (local) {
          // Auto-download is per device, and sort mode of shared folders is a personal view choice.
          if (shared) await db.runAsync('UPDATE folders SET name = ?, sort_order = ?, shared = 1 WHERE id = ?', [f.name, f.sort_order, local.id]);
          else
            await db.runAsync('UPDATE folders SET name = ?, sort_order = ?, sort_mode = ?, shared = 0 WHERE id = ?', [
              f.name,
              f.sort_order,
              f.sort_mode,
              local.id,
            ]);
        } else {
          await db.runAsync(
            'INSERT INTO folders (remote_id, name, sort_order, sort_mode, auto_download, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [f.id, f.name, f.sort_order, f.sort_mode, 0, shared, Date.now()],
          );
        }
      }
      for (const f of res.folders) {
        if (f.deleted) continue;
        await db.runAsync(
          'UPDATE folders SET parent_id = (SELECT id FROM folders WHERE remote_id = ?) WHERE remote_id = ?',
          [f.parent_id, f.id],
        );
      }

      for (const it of res.items) {
        if (it.deleted) {
          await db.runAsync('DELETE FROM items WHERE remote_id = ?', [it.id]);
          continue;
        }
        const folder = await db.getFirstAsync<{ id: number }>('SELECT id FROM folders WHERE remote_id = ?', [it.folder_id]);
        const track = await db.getFirstAsync<{ id: number }>('SELECT id FROM tracks WHERE remote_id = ?', [it.track_id]);
        if (!folder || !track) continue;
        const byRemote = await db.getFirstAsync<{ id: number }>('SELECT id FROM items WHERE remote_id = ?', [it.id]);
        const byPair = await db.getFirstAsync<{ id: number }>('SELECT id FROM items WHERE folder_id = ? AND track_id = ?', [folder.id, track.id]);
        if (byRemote && byPair && byRemote.id !== byPair.id) await db.runAsync('DELETE FROM items WHERE id = ?', [byPair.id]);
        const target = byRemote ?? byPair;
        if (target) {
          await db.runAsync('UPDATE items SET remote_id = ?, folder_id = ?, track_id = ?, sort_order = ? WHERE id = ?', [
            it.id,
            folder.id,
            track.id,
            it.sort_order,
            target.id,
          ]);
        } else {
          await db.runAsync('INSERT INTO items (remote_id, folder_id, track_id, sort_order, added_at) VALUES (?, ?, ?, ?, ?)', [
            it.id,
            folder.id,
            track.id,
            it.sort_order,
            it.added_at,
          ]);
        }
      }

      // Folders the user lost access to (or that were deleted while we were away).
      const visible = new Set(res.visible_folder_ids);
      const synced = await db.getAllAsync<{ id: number; remote_id: number }>('SELECT id, remote_id FROM folders WHERE remote_id IS NOT NULL');
      for (const f of synced) if (!visible.has(f.remote_id)) await db.runAsync('DELETE FROM folders WHERE id = ?', [f.id]);
    });
    await kvSet('sync_cursor', String(res.cursor));
    await pruneOrphanTracks();
    if (changed) libraryEvents.emit();
  }
}

export default new SyncService();

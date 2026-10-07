import * as FileSystem from 'expo-file-system/legacy';
import { absPath, ensureDirs, getDb, inTransaction, libraryEvents } from './db';

export type DownloadState = 'none' | 'queued' | 'downloading' | 'done' | 'error';

export interface Track {
  id: number;
  remote_id: number | null;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  size_bytes: number;
  mime: string;
  has_cover: number;
  source: string;
  file: string | null;
  cover_file: string | null;
  download_state: DownloadState;
  upload_state: 'none' | 'pending' | 'done' | 'error';
  created_at: number;
}

export interface FolderTrack extends Track {
  item_id: number;
  folder_id: number;
  sort_order: number;
  added_at: number;
}

export interface Folder {
  id: number;
  remote_id: number | null;
  parent_id: number | null;
  name: string;
  sort_order: number;
  sort_mode: SortMode;
  auto_download: number;
  shared: number;
  track_count: number;
  folder_count: number;
}

export interface Artist {
  name: string;
  songs: number;
  albums: number;
  art_track_id: number;
  cover_file: string | null;
}

export interface Album {
  name: string;
  artist: string;
  songs: number;
  art_track_id: number;
  cover_file: string | null;
  year?: number;
}

export type SortMode =
  | 'custom'
  | 'title'
  | 'title_desc'
  | 'artist'
  | 'artist_desc'
  | 'added'
  | 'added_desc'
  | 'duration'
  | 'duration_desc';

export const SORT_LABELS: Record<SortMode, string> = {
  custom: 'Custom order',
  title: 'Title A–Z',
  title_desc: 'Title Z–A',
  artist: 'Artist A–Z',
  artist_desc: 'Artist Z–A',
  added: 'Oldest first',
  added_desc: 'Newest first',
  duration: 'Shortest first',
  duration_desc: 'Longest first',
};

function orderBy(mode: SortMode, hasItem: boolean) {
  const added = hasItem ? 'i.added_at' : 't.created_at';
  switch (mode) {
    case 'title':
      return 't.title COLLATE NOCASE ASC';
    case 'title_desc':
      return 't.title COLLATE NOCASE DESC';
    case 'artist':
      return `t.artist = '' ASC, t.artist COLLATE NOCASE ASC, t.title COLLATE NOCASE ASC`;
    case 'artist_desc':
      return `t.artist = '' ASC, t.artist COLLATE NOCASE DESC, t.title COLLATE NOCASE ASC`;
    case 'added':
      return `${added} ASC`;
    case 'added_desc':
      return `${added} DESC`;
    case 'duration':
      return 't.duration_ms ASC';
    case 'duration_desc':
      return 't.duration_ms DESC';
    default:
      return hasItem ? 'i.sort_order ASC, i.id ASC' : 't.title COLLATE NOCASE ASC';
  }
}

export const trackUri = (t: Pick<Track, 'file'>) => absPath(t.file);
export const coverUri = (t: Pick<Track, 'cover_file'>) => absPath(t.cover_file);
export const displayArtist = (t: Pick<Track, 'artist'>) => t.artist || 'Unknown artist';

// ---------- queries ----------

const FOLDER_SELECT = `
  SELECT f.*,
    (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id) AS track_count,
    (SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id) AS folder_count
  FROM folders f`;

/** Folders directly under parentId; `shared` limits the top level to your own (false) or shared-with-you (true) folders. */
export async function getFolders(parentId: number | null, shared?: boolean): Promise<Folder[]> {
  return getDb().getAllAsync<Folder>(
    `${FOLDER_SELECT} WHERE f.parent_id IS ?${shared === undefined ? '' : ` AND f.shared = ${shared ? 1 : 0}`} ORDER BY f.shared ASC, f.sort_order ASC, f.name COLLATE NOCASE ASC`,
    [parentId],
  );
}

export async function getAllFolders(): Promise<Folder[]> {
  return getDb().getAllAsync<Folder>(`${FOLDER_SELECT} ORDER BY f.name COLLATE NOCASE`);
}

export async function getFolder(id: number): Promise<Folder | null> {
  return getDb().getFirstAsync<Folder>(`${FOLDER_SELECT} WHERE f.id = ?`, [id]);
}

export async function getFolderPath(id: number): Promise<Folder[]> {
  const out: Folder[] = [];
  let cur = await getFolder(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent_id ? await getFolder(cur.parent_id) : null;
  }
  return out;
}

/** The folder and all of its descendants, depth-first in display order. */
export async function getSubtreeIds(id: number): Promise<number[]> {
  const out: number[] = [id];
  const children = await getFolders(id);
  for (const c of children) out.push(...(await getSubtreeIds(c.id)));
  return out;
}

export async function getFolderTracks(folderId: number, mode: SortMode = 'custom'): Promise<FolderTrack[]> {
  return getDb().getAllAsync<FolderTrack>(
    `SELECT t.*, i.id AS item_id, i.folder_id, i.sort_order, i.added_at
     FROM items i JOIN tracks t ON t.id = i.track_id
     WHERE i.folder_id = ? ORDER BY ${orderBy(mode, true)}`,
    [folderId],
  );
}

/** Tracks of a folder followed by those of every subfolder, each in its own sort. */
export async function getFolderTracksDeep(folderId: number): Promise<FolderTrack[]> {
  const out: FolderTrack[] = [];
  for (const id of await getSubtreeIds(folderId)) {
    const f = await getFolder(id);
    out.push(...(await getFolderTracks(id, f?.sort_mode ?? 'custom')));
  }
  return out;
}

export async function getFolderStats(folderId: number) {
  const ids = await getSubtreeIds(folderId);
  const ph = ids.map(() => '?').join(',');
  const row = await getDb().getFirstAsync<{ total: number; done: number; bytes: number; ms: number }>(
    `SELECT COUNT(DISTINCT t.id) AS total,
       COUNT(DISTINCT CASE WHEN t.download_state = 'done' THEN t.id END) AS done,
       COALESCE(SUM(DISTINCT CASE WHEN t.download_state = 'done' THEN t.size_bytes END), 0) AS bytes,
       COALESCE(SUM(t.duration_ms), 0) AS ms
     FROM items i JOIN tracks t ON t.id = i.track_id WHERE i.folder_id IN (${ph})`,
    ids,
  );
  return row ?? { total: 0, done: 0, bytes: 0, ms: 0 };
}

export async function getAllTracks(mode: SortMode = 'title'): Promise<Track[]> {
  return getDb().getAllAsync<Track>(
    `SELECT t.* FROM tracks t WHERE EXISTS (SELECT 1 FROM items i WHERE i.track_id = t.id) ORDER BY ${orderBy(mode, false)}`,
  );
}

/** Every song the server has shared with this account, whether or not it is on this phone. */
export async function getOnlineTracks(query = ''): Promise<Track[]> {
  const q = `%${query.trim().replace(/[%_]/g, '')}%`;
  return getDb().getAllAsync<Track>(
    `SELECT * FROM tracks WHERE remote_id IS NOT NULL AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)
     ORDER BY title COLLATE NOCASE ASC LIMIT 500`,
    [q, q, q],
  );
}

export async function getTrack(id: number): Promise<Track | null> {
  return getDb().getFirstAsync<Track>('SELECT * FROM tracks WHERE id = ?', [id]);
}

export async function getArtists(): Promise<Artist[]> {
  return getDb().getAllAsync<Artist>(
    `SELECT CASE WHEN t.artist = '' THEN 'Unknown artist' ELSE t.artist END AS name,
       COUNT(*) AS songs,
       COUNT(DISTINCT NULLIF(t.album, '')) AS albums,
       MAX(t.id) AS art_track_id,
       MAX(t.cover_file) AS cover_file
     FROM tracks t WHERE EXISTS (SELECT 1 FROM items i WHERE i.track_id = t.id)
     GROUP BY name ORDER BY name = 'Unknown artist', name COLLATE NOCASE`,
  );
}

export async function getAlbums(): Promise<Album[]> {
  return getDb().getAllAsync<Album>(
    `SELECT t.album AS name, MAX(t.artist) AS artist, COUNT(*) AS songs,
       MAX(t.id) AS art_track_id, MAX(t.cover_file) AS cover_file
     FROM tracks t WHERE t.album != '' AND EXISTS (SELECT 1 FROM items i WHERE i.track_id = t.id)
     GROUP BY t.album ORDER BY t.album COLLATE NOCASE`,
  );
}

export async function getTracksBy(kind: 'artist' | 'album', name: string): Promise<Track[]> {
  const col = kind === 'artist' ? 't.artist' : 't.album';
  const value = kind === 'artist' && name === 'Unknown artist' ? '' : name;
  return getDb().getAllAsync<Track>(
    `SELECT t.* FROM tracks t WHERE ${col} = ? AND EXISTS (SELECT 1 FROM items i WHERE i.track_id = t.id)
     ORDER BY t.album COLLATE NOCASE, t.title COLLATE NOCASE`,
    [value],
  );
}

/** Favorites, newest first. `folderId` limits it to one favorites folder; `null` = not in any folder. */
export async function getFavorites(folderId?: number | null): Promise<Track[]> {
  const where = folderId === undefined ? '' : folderId === null ? 'AND f.folder_id IS NULL' : 'AND f.folder_id = ?';
  return getDb().getAllAsync<Track>(
    `SELECT t.* FROM favorites f JOIN tracks t ON t.id = f.track_id WHERE f.deleted = 0 ${where} ORDER BY f.added_at DESC`,
    typeof folderId === 'number' ? [folderId] : [],
  );
}

export async function isFavorite(trackId: number) {
  return !!(await getDb().getFirstAsync('SELECT 1 FROM favorites WHERE track_id = ? AND deleted = 0', [trackId]));
}

/** Favorites are synced like everything else: a deleted favorite stays as a tombstone until the server has it. */
export async function toggleFavorite(trackId: number): Promise<boolean> {
  const fav = await isFavorite(trackId);
  const now = Date.now();
  if (fav) await getDb().runAsync('UPDATE favorites SET deleted = 1, dirty = 1, updated_at = ? WHERE track_id = ?', [now, trackId]);
  else
    await getDb().runAsync(
      `INSERT INTO favorites (track_id, added_at, folder_id, updated_at, deleted, dirty) VALUES (?, ?, NULL, ?, 0, 1)
       ON CONFLICT(track_id) DO UPDATE SET deleted = 0, folder_id = NULL, added_at = excluded.added_at, updated_at = excluded.updated_at, dirty = 1`,
      [trackId, now, now],
    );
  libraryEvents.emit();
  outboxListener?.();
  return !fav;
}

export interface FavFolder {
  id: number;
  remote_id: number | null;
  name: string;
  count: number;
}

export async function getFavFolders(): Promise<FavFolder[]> {
  return getDb().getAllAsync<FavFolder>(
    `SELECT ff.id, ff.remote_id, ff.name,
       (SELECT COUNT(*) FROM favorites f WHERE f.folder_id = ff.id AND f.deleted = 0) AS count
     FROM fav_folders ff WHERE ff.deleted = 0 ORDER BY ff.name COLLATE NOCASE`,
  );
}

export async function getFavoriteFolderId(trackId: number): Promise<number | null> {
  const r = await getDb().getFirstAsync<{ folder_id: number | null }>('SELECT folder_id FROM favorites WHERE track_id = ? AND deleted = 0', [trackId]);
  return r?.folder_id ?? null;
}

export async function createFavFolder(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');
  const r = await getDb().runAsync('INSERT INTO fav_folders (name, updated_at, deleted, dirty) VALUES (?, ?, 0, 1)', [trimmed, Date.now()]);
  libraryEvents.emit();
  outboxListener?.();
  return r.lastInsertRowId;
}

export async function renameFavFolder(id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');
  await getDb().runAsync('UPDATE fav_folders SET name = ?, updated_at = ?, dirty = 1 WHERE id = ?', [trimmed, Date.now(), id]);
  libraryEvents.emit();
  outboxListener?.();
}

/** Deleting a favorites folder keeps its songs in Favorites. */
export async function deleteFavFolder(id: number) {
  const now = Date.now();
  await getDb().runAsync('UPDATE favorites SET folder_id = NULL, dirty = 1, updated_at = ? WHERE folder_id = ?', [now, id]);
  await getDb().runAsync('UPDATE fav_folders SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', [now, id]);
  libraryEvents.emit();
  outboxListener?.();
}

/** Puts a song in a favorites folder (null = no folder). The song becomes a favorite if it is not one yet. */
export async function setFavoriteFolder(trackId: number, folderId: number | null) {
  const now = Date.now();
  await getDb().runAsync(
    `INSERT INTO favorites (track_id, added_at, folder_id, updated_at, deleted, dirty) VALUES (?, ?, ?, ?, 0, 1)
     ON CONFLICT(track_id) DO UPDATE SET deleted = 0, folder_id = excluded.folder_id, updated_at = excluded.updated_at, dirty = 1`,
    [trackId, now, folderId, now],
  );
  libraryEvents.emit();
  outboxListener?.();
}

export async function recordPlay(trackId: number) {
  await getDb().runAsync('INSERT INTO plays (track_id, played_at) VALUES (?, ?)', [trackId, Date.now()]);
  libraryEvents.emit();
}

export async function getRecentlyPlayed(limit = 30): Promise<Track[]> {
  return getDb().getAllAsync<Track>(
    `SELECT t.* FROM tracks t JOIN (SELECT track_id, MAX(played_at) AS last FROM plays GROUP BY track_id) p ON p.track_id = t.id
     ORDER BY p.last DESC LIMIT ?`,
    [limit],
  );
}

export async function getMostPlayed(limit = 20): Promise<Track[]> {
  return getDb().getAllAsync<Track>(
    `SELECT t.* FROM tracks t JOIN (SELECT track_id, COUNT(*) AS n FROM plays GROUP BY track_id) p ON p.track_id = t.id
     ORDER BY p.n DESC LIMIT ?`,
    [limit],
  );
}

export async function search(q: string) {
  const like = `%${q.trim()}%`;
  const db = getDb();
  const [tracks, folders, artists] = await Promise.all([
    db.getAllAsync<Track>(
      `SELECT t.* FROM tracks t WHERE (t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ?)
       AND EXISTS (SELECT 1 FROM items i WHERE i.track_id = t.id) ORDER BY t.title COLLATE NOCASE LIMIT 100`,
      [like, like, like],
    ),
    db.getAllAsync<Folder>(`${FOLDER_SELECT} WHERE f.name LIKE ? ORDER BY f.name COLLATE NOCASE LIMIT 30`, [like]),
    getArtists().then((a) => a.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 20)),
  ]);
  return { tracks, folders, artists };
}

export async function getStorageStats() {
  const row = await getDb().getFirstAsync<{ count: number; bytes: number; total: number }>(
    `SELECT COUNT(CASE WHEN download_state = 'done' THEN 1 END) AS count,
       COALESCE(SUM(CASE WHEN download_state = 'done' THEN size_bytes END), 0) AS bytes,
       COUNT(*) AS total
     FROM tracks t WHERE EXISTS (SELECT 1 FROM items i WHERE i.track_id = t.id)`,
  );
  return row ?? { count: 0, bytes: 0, total: 0 };
}

// ---------- mutations (offline-first: write locally, queue for the server) ----------

export type OutboxOp =
  | { op: 'folder.upsert'; local: number; fields?: ('name' | 'parent' | 'sort_order' | 'sort_mode' | 'auto_download')[]; at?: number }
  | { op: 'folder.delete'; remote: number }
  | { op: 'item.upsert'; local: number; fields?: ('folder' | 'sort_order')[]; at?: number }
  | { op: 'item.delete'; remote: number };

async function enqueue(...ops: OutboxOp[]) {
  const db = getDb();
  for (const op of ops) await db.runAsync('INSERT INTO outbox (op) VALUES (?)', [JSON.stringify({ at: Date.now(), ...op })]);
  libraryEvents.emit();
  outboxListener?.();
}

let outboxListener: (() => void) | null = null;
/** SyncService registers here to push soon after local edits. */
export function onOutboxChange(fn: () => void) {
  outboxListener = fn;
}

async function assertOwn(folderId: number) {
  const f = await getFolder(folderId);
  if (!f) throw new Error('Folder not found');
  if (f.shared) throw new Error('Shared folders are managed by your admin and cannot be changed.');
  return f;
}

export async function createFolder(name: string, parentId: number | null): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');
  if (parentId) await assertOwn(parentId);
  const db = getDb();
  const next = await db.getFirstAsync<{ n: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM folders WHERE parent_id IS ? AND shared = 0',
    [parentId],
  );
  const r = await db.runAsync('INSERT INTO folders (parent_id, name, sort_order, auto_download, created_at) VALUES (?, ?, ?, 0, ?)', [
    parentId,
    trimmed,
    next?.n ?? 0,
    Date.now(),
  ]);
  await enqueue({ op: 'folder.upsert', local: r.lastInsertRowId });
  return r.lastInsertRowId;
}

export async function renameFolder(id: number, name: string) {
  await assertOwn(id);
  if (!name.trim()) throw new Error('Folder name is required');
  await getDb().runAsync('UPDATE folders SET name = ? WHERE id = ?', [name.trim(), id]);
  await enqueue({ op: 'folder.upsert', local: id, fields: ['name'] });
}

export async function setFolderSort(id: number, mode: SortMode) {
  const f = await getFolder(id);
  if (!f) return;
  await getDb().runAsync('UPDATE folders SET sort_mode = ? WHERE id = ?', [mode, id]);
  if (f.shared) libraryEvents.emit(); // a personal view preference for shared folders
  else await enqueue({ op: 'folder.upsert', local: id, fields: ['sort_mode'] });
}

export async function setAutoDownload(id: number, on: boolean) {
  const f = await getFolder(id);
  if (!f) return;
  // Keeping a folder offline is a per-device choice, so it is not synced.
  await getDb().runAsync('UPDATE folders SET auto_download = ? WHERE id = ?', [on ? 1 : 0, id]);
  libraryEvents.emit();
}

export async function moveFolder(id: number, newParent: number | null) {
  await assertOwn(id);
  if (newParent !== null) {
    await assertOwn(newParent);
    if ((await getSubtreeIds(id)).includes(newParent)) throw new Error('A folder cannot be moved into itself.');
  }
  await getDb().runAsync('UPDATE folders SET parent_id = ? WHERE id = ?', [newParent, id]);
  await enqueue({ op: 'folder.upsert', local: id, fields: ['parent'] });
}

export async function reorderFolders(ids: number[]) {
  const db = getDb();
  const ops: OutboxOp[] = [];
  for (const [i, id] of ids.entries()) {
    await db.runAsync('UPDATE folders SET sort_order = ? WHERE id = ? AND shared = 0', [i, id]);
    ops.push({ op: 'folder.upsert', local: id, fields: ['sort_order'] });
  }
  await enqueue(...ops);
}

export async function deleteFolder(id: number) {
  const f = await assertOwn(id);
  await getDb().runAsync('DELETE FROM folders WHERE id = ?', [id]);
  // Never-synced folders just vanish: their pending create op is skipped at push time.
  if (f.remote_id) await enqueue({ op: 'folder.delete', remote: f.remote_id });
  else libraryEvents.emit();
}

export async function reorderItems(folderId: number, itemIds: number[]) {
  const f = await getFolder(folderId);
  if (!f) return;
  const db = getDb();
  await inTransaction(async () => {
    for (const [i, id] of itemIds.entries()) await db.runAsync('UPDATE items SET sort_order = ? WHERE id = ?', [i, id]);
    await db.runAsync(`UPDATE folders SET sort_mode = 'custom' WHERE id = ?`, [folderId]);
  });
  if (f.shared) return libraryEvents.emit();
  await enqueue(
    { op: 'folder.upsert', local: folderId, fields: ['sort_mode'] },
    ...itemIds.map((id): OutboxOp => ({ op: 'item.upsert', local: id, fields: ['sort_order'] })),
  );
}

async function nextItemOrder(folderId: number) {
  const r = await getDb().getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM items WHERE folder_id = ?', [folderId]);
  return r?.n ?? 0;
}

/** Adds tracks to a folder (they stay where they are too). */
export async function copyTracks(trackIds: number[], target: number) {
  await assertOwn(target);
  const db = getDb();
  const ops: OutboxOp[] = [];
  let order = await nextItemOrder(target);
  for (const t of trackIds) {
    const r = await db.runAsync('INSERT OR IGNORE INTO items (folder_id, track_id, sort_order, added_at) VALUES (?, ?, ?, ?)', [
      target,
      t,
      order++,
      Date.now(),
    ]);
    if (r.changes) ops.push({ op: 'item.upsert', local: r.lastInsertRowId });
  }
  await enqueue(...ops);
  return ops.length;
}

export async function moveItems(itemIds: number[], target: number) {
  await assertOwn(target);
  const db = getDb();
  const ops: OutboxOp[] = [];
  let order = await nextItemOrder(target);
  for (const id of itemIds) {
    const item = await db.getFirstAsync<{ id: number; remote_id: number | null; folder_id: number; track_id: number }>(
      'SELECT id, remote_id, folder_id, track_id FROM items WHERE id = ?',
      [id],
    );
    if (!item || item.folder_id === target) continue;
    await assertOwn(item.folder_id);
    const dup = await db.getFirstAsync('SELECT 1 FROM items WHERE folder_id = ? AND track_id = ?', [target, item.track_id]);
    if (dup) {
      // Already in the target: moving just removes it from the source.
      await db.runAsync('DELETE FROM items WHERE id = ?', [id]);
      if (item.remote_id) ops.push({ op: 'item.delete', remote: item.remote_id });
      continue;
    }
    await db.runAsync('UPDATE items SET folder_id = ?, sort_order = ?, added_at = ? WHERE id = ?', [target, order++, Date.now(), id]);
    ops.push({ op: 'item.upsert', local: id, fields: ['folder', 'sort_order'] });
  }
  await enqueue(...ops);
}

export async function removeItems(itemIds: number[]) {
  const db = getDb();
  const ops: OutboxOp[] = [];
  for (const id of itemIds) {
    const item = await db.getFirstAsync<{ remote_id: number | null; folder_id: number }>('SELECT remote_id, folder_id FROM items WHERE id = ?', [id]);
    if (!item) continue;
    await assertOwn(item.folder_id);
    await db.runAsync('DELETE FROM items WHERE id = ?', [id]);
    if (item.remote_id) ops.push({ op: 'item.delete', remote: item.remote_id });
  }
  await enqueue(...ops);
  await pruneOrphanTracks();
}

/** Deletes tracks that are no longer in any folder, with their files. */
export async function pruneOrphanTracks() {
  const db = getDb();
  const orphans = await db.getAllAsync<Track>(
    'SELECT * FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.track_id = t.id)',
  );
  for (const t of orphans) {
    for (const p of [absPath(t.file), absPath(t.cover_file)]) if (p) await FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {});
    await db.runAsync('DELETE FROM tracks WHERE id = ?', [t.id]);
  }
  if (orphans.length) libraryEvents.emit();
}

const EXT_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

export function extFor(mime: string, fallbackName?: string) {
  const fromName = fallbackName?.match(/\.([a-z0-9]{2,4})$/i)?.[1];
  return (fromName || EXT_BY_MIME[mime] || 'mp3').toLowerCase();
}

/** Imports a file picked on the device. It plays immediately and uploads in the background. */
export async function importLocalFile(folderId: number, uri: string, name: string, size = 0) {
  await assertOwn(folderId);
  await ensureDirs();
  const ext = extFor('', name);
  const rel = `music/local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  await FileSystem.copyAsync({ from: uri, to: absPath(rel)! });
  const db = getDb();
  const title = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
  const t = await db.runAsync(
    `INSERT INTO tracks (title, size_bytes, mime, file, download_state, upload_state, created_at)
     VALUES (?, ?, ?, ?, 'done', 'pending', ?)`,
    [title, size, `audio/${ext === 'mp3' ? 'mpeg' : ext}`, rel, Date.now()],
  );
  await db.runAsync('INSERT INTO items (folder_id, track_id, sort_order, added_at) VALUES (?, ?, ?, ?)', [
    folderId,
    t.lastInsertRowId,
    await nextItemOrder(folderId),
    Date.now(),
  ]);
  libraryEvents.emit();
  outboxListener?.();
  return t.lastInsertRowId;
}

import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Each signed-in user gets their own database file so libraries on a shared
 * device never mix. Everything works offline; SyncService reconciles with the
 * server through `remote_id` columns and the `outbox` of pending changes.
 */
let db: SQLite.SQLiteDatabase | null = null;
let openUser: number | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id INTEGER UNIQUE,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  sort_mode TEXT NOT NULL DEFAULT 'custom',
  auto_download INTEGER NOT NULL DEFAULT 1,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mime TEXT NOT NULL DEFAULT 'audio/mpeg',
  has_cover INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'upload',
  file TEXT,
  cover_file TEXT,
  download_state TEXT NOT NULL DEFAULT 'none',
  upload_state TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id INTEGER UNIQUE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (folder_id, track_id)
);
CREATE INDEX IF NOT EXISTS idx_items_track ON items(track_id);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plays_track ON plays(track_id);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export async function openUserDb(userId: number) {
  if (db && openUser === userId) return db;
  if (db) await db.closeAsync().catch(() => {});
  db = await SQLite.openDatabaseAsync(`mume_user_${userId}.db`);
  await db.execAsync(SCHEMA);
  openUser = userId;
  await importLegacyLibrary(db, userId);
  return db;
}

export async function closeUserDb() {
  if (db) await db.closeAsync().catch(() => {});
  db = null;
  openUser = null;
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Library database is not open');
  return db;
}

export function hasDb() {
  return db !== null;
}

// ---------- key/value ----------

export async function kvGet(key: string): Promise<string | null> {
  const row = await getDb().getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string) {
  await getDb().runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
}

// ---------- change notifications ----------

type Listener = () => void;
const listeners = new Set<Listener>();
let pending: ReturnType<typeof setTimeout> | null = null;

export const libraryEvents = {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Coalesces bursts of writes into one UI refresh. */
  emit() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      listeners.forEach((l) => l());
    }, 50);
  },
};

// ---------- files ----------

export const MUSIC_DIR = `${FileSystem.documentDirectory}music/`;
export const COVER_DIR = `${FileSystem.documentDirectory}covers/`;

/** Paths are stored relative to documentDirectory so they survive app updates. */
export function absPath(rel: string | null | undefined) {
  return rel ? `${FileSystem.documentDirectory}${rel}` : null;
}

export async function ensureDirs() {
  for (const d of [MUSIC_DIR, COVER_DIR]) {
    const info = await FileSystem.getInfoAsync(d);
    if (!info.exists) await FileSystem.makeDirectoryAsync(d, { intermediates: true });
  }
}

// ---------- one-time import of the pre-account library ----------

/**
 * Before accounts existed the app kept folders in sonicgroup.db. The first user
 * to sign in on this device adopts that library: folders become their personal
 * folders and the files are queued for upload so they reach other devices.
 */
async function importLegacyLibrary(target: SQLite.SQLiteDatabase, userId: number) {
  const done = await target.getFirstAsync<{ value: string }>(`SELECT value FROM kv WHERE key = 'legacy_checked'`);
  if (done) return;
  await target.runAsync(`INSERT OR REPLACE INTO kv (key, value) VALUES ('legacy_checked', '1')`);

  const legacyPath = `${FileSystem.documentDirectory}SQLite/sonicgroup.db`;
  if (!(await FileSystem.getInfoAsync(legacyPath)).exists) return;

  let legacy: SQLite.SQLiteDatabase | null = null;
  try {
    legacy = await SQLite.openDatabaseAsync('sonicgroup.db');
    const claimed = await legacy
      .getFirstAsync<{ value: string }>(`SELECT value FROM settings WHERE key = 'mume_migrated_to'`)
      .catch(() => null);
    if (claimed) return;

    const groups = await legacy.getAllAsync<{ id: number; name: string; parent_id: number | null }>(
      'SELECT id, name, parent_id FROM groups ORDER BY id',
    );
    const files = await legacy.getAllAsync<{ id: number; name: string; file_name: string; group_id: number; sort_order: number }>(
      'SELECT id, name, file_name, group_id, sort_order FROM files ORDER BY sort_order, id',
    );
    const now = Date.now();
    const folderMap = new Map<number, number>();

    await target.withTransactionAsync(async () => {
      // Parents first: groups are created before their children by id order,
      // but resolve iteratively in case of out-of-order ids.
      let remaining = [...groups];
      while (remaining.length) {
        const next = remaining.filter((g) => g.parent_id === null || folderMap.has(g.parent_id) || !groups.some((x) => x.id === g.parent_id));
        if (!next.length) break;
        for (const [i, g] of next.entries()) {
          const parent = g.parent_id !== null ? folderMap.get(g.parent_id) ?? null : null;
          const r = await target.runAsync(
            'INSERT INTO folders (parent_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)',
            [parent, g.name, i, now],
          );
          folderMap.set(g.id, r.lastInsertRowId);
          await target.runAsync('INSERT INTO outbox (op) VALUES (?)', [JSON.stringify({ op: 'folder.upsert', local: r.lastInsertRowId })]);
        }
        remaining = remaining.filter((g) => !folderMap.has(g.id));
      }

      for (const f of files) {
        const folder = folderMap.get(f.group_id);
        if (!folder || !f.file_name) continue;
        const exists = (await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}${f.file_name}`)).exists;
        if (!exists) continue;
        const t = await target.runAsync(
          `INSERT INTO tracks (title, file, download_state, upload_state, created_at) VALUES (?, ?, 'done', 'pending', ?)`,
          [f.name.replace(/\.[^.]+$/, ''), f.file_name, now],
        );
        await target.runAsync('INSERT OR IGNORE INTO items (folder_id, track_id, sort_order, added_at) VALUES (?, ?, ?, ?)', [
          folder,
          t.lastInsertRowId,
          f.sort_order,
          now,
        ]);
      }
    });
    await legacy.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES ('mume_migrated_to', ?)`, [String(userId)]);
  } catch (e) {
    console.warn('[db] legacy import skipped:', e);
  } finally {
    await legacy?.closeAsync().catch(() => {});
  }
}

import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";

export interface Group {
  id: number;
  name: string;
}

export interface MediaFile {
  id: number;
  name: string;
  local_uri: string;
  file_name: string;
  group_id: number;
  sort_order: number;
  missing?: boolean; // New flag
}

let db: SQLite.SQLiteDatabase;

export const initDatabase = async () => {
  try {
    if (db) {
      console.log('[SQLite] Database already initialized');
      return;
    }
    
    db = await SQLite.openDatabaseAsync("sonicgroup.db");
    console.log('[SQLite] Database opened successfully');
  } catch (error) {
    console.error('[SQLite] Failed to open database:', error);
    throw error;
  }

  try {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        parent_id INTEGER DEFAULT NULL,
        FOREIGN KEY (parent_id) REFERENCES groups (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        local_uri TEXT NOT NULL,
        group_id INTEGER,
        FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    console.log('[SQLite] Database schema initialized successfully');
  } catch (error) {
    console.error('[SQLite] Failed to initialize database schema:', error);
    throw error;
  }

  // Migration: add file_name column if missing
  try {
    await db.execAsync(`ALTER TABLE files ADD COLUMN file_name TEXT DEFAULT ''`);
  } catch (e) {
    // Column already exists — safe to ignore
  }

  // Migration: add sort_order column if missing
  try {
    await db.execAsync(`ALTER TABLE files ADD COLUMN sort_order INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists — safe to ignore
  }

  // Backfill file_name for rows that don't have it yet
  await db.runAsync(`
    UPDATE files SET file_name = REPLACE(REPLACE(local_uri, ?, ''), 'file://', '')
    WHERE file_name = '' OR file_name IS NULL
  `, [FileSystem.documentDirectory || '']);
  
  // Backfill sort_order based on current ID order
  try {
    await db.runAsync(`
      UPDATE files SET sort_order = id WHERE sort_order = 0 OR sort_order IS NULL
    `);
    console.log('[SQLite] Sort order backfilled successfully');
  } catch (error) {
    console.error('[SQLite] Failed to backfill sort order:', error);
    // Don't throw here, just log it
  }
};

export const saveSetting = async (key: string, value: string) => {
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [key, value]
  );
};

export const getSetting = async (key: string): Promise<string | null> => {
  if (!db) {
    console.error('[SQLite] Database not initialized in getSetting');
    return null;
  }
  const result = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  return result ? result.value : null;
};

export const getGroups = async (parentId: number | null = null): Promise<Group[]> => {
  if (!db) {
    console.error('[SQLite] Database not initialized in getGroups');
    return [];
  }
  const query = parentId === null 
    ? "SELECT * FROM groups WHERE parent_id IS NULL ORDER BY name ASC" 
    : "SELECT * FROM groups WHERE parent_id = ? ORDER BY name ASC";
  const params = parentId === null ? [] : [parentId];
  const result = await db.getAllAsync<Group>(query, params);
  return result;
};

export const addGroup = async (name: string, parentId: number | null = null): Promise<number> => {
  if (!db) {
    console.error('[SQLite] Database not initialized in addGroup');
    return 0;
  }
  const result = await db.runAsync("INSERT INTO groups (name, parent_id) VALUES (?, ?)", [name, parentId]);
  return result.lastInsertRowId;
};

export const deleteGroup = async (id: number) => {
  // Delete the associated files first so we don't get orphans
  await db.runAsync("DELETE FROM files WHERE group_id = ?", [id]);
  await db.runAsync("DELETE FROM groups WHERE id = ?", [id]);
};

/**
 * Resolves the full URI for a file based on its stored file_name.
 * Falls back to local_uri if file_name is empty.
 */
const resolveFileUri = (row: any): MediaFile => {
  const fileName = row.file_name || '';
  let resolvedUri = row.local_uri;

  if (fileName) {
    // Rebuild the full path from the current documentDirectory
    resolvedUri = `${FileSystem.documentDirectory}${fileName}`;
  }

  return {
    id: row.id,
    name: row.name,
    local_uri: resolvedUri,
    file_name: fileName,
    group_id: row.group_id,
    sort_order: row.sort_order || 0,
  };
};

export const getFilesByGroupIds = async (
  groupIds: number[],
): Promise<MediaFile[]> => {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM files WHERE group_id IN (${placeholders}) ORDER BY sort_order ASC`,
    groupIds,
  );
  return rows.map(resolveFileUri);
};

/**
 * Add a file. Stores only the filename (not the full absolute path)
 * so the app survives sandbox path changes on Android.
 */
export const addFile = async (
  name: string,
  local_uri: string,
  group_id: number,
): Promise<number> => {
  // Extract just the filename from the URI
  const fileName = local_uri.replace(FileSystem.documentDirectory || '', '');

  const result = await db.runAsync(
    "INSERT INTO files (name, local_uri, file_name, group_id) VALUES (?, ?, ?, ?)",
    [name, local_uri, fileName, group_id],
  );
  return result.lastInsertRowId;
};

export const deleteFile = async (id: number) => {
  await db.runAsync("DELETE FROM files WHERE id = ?", [id]);
};

export const getAllFiles = async (): Promise<MediaFile[]> => {
  const rows = await db.getAllAsync<any>("SELECT * FROM files");
  return rows.map(resolveFileUri);
};

/**
 * Verify which files actually exist on disk.
 * Returns only files that are present.
 */
/**
 * Verify which files actually exist on disk.
 * Marks files as missing rather than dropping them.
 */
export const verifyFilesExist = async (files: MediaFile[]): Promise<MediaFile[]> => {
  const verified: MediaFile[] = [];
  for (const file of files) {
    try {
      const info = await FileSystem.getInfoAsync(file.local_uri);
      verified.push({
        ...file,
        missing: !info.exists
      });
    } catch {
      verified.push({ ...file, missing: true });
    }
  }
  return verified;
};

export const getFilesByGroupId = async (groupId: number): Promise<MediaFile[]> => {
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM files WHERE group_id = ? ORDER BY sort_order ASC`,
    [groupId]
  );
  return rows.map(resolveFileUri);
};

export const updateFileSortOrder = async (fileId: number, sortOrder: number) => {
  await db.runAsync(
    "UPDATE files SET sort_order = ? WHERE id = ?",
    [sortOrder, fileId]
  );
};

export const updateMultipleFileSortOrders = async (updates: Array<{ id: number; sortOrder: number }>) => {
  for (const update of updates) {
    await updateFileSortOrder(update.id, update.sortOrder);
  }
};

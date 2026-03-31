import * as SQLite from "expo-sqlite";

export interface Group {
  id: number;
  name: string;
}

export interface MediaFile {
  id: number;
  name: string;
  local_uri: string;
  group_id: number;
}

let db: SQLite.SQLiteDatabase;

export const initDatabase = async () => {
  db = await SQLite.openDatabaseAsync("sonicgroup.db");

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
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
};

export const saveSetting = async (key: string, value: string) => {
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [key, value]
  );
};

export const getSetting = async (key: string): Promise<string | null> => {
  const result = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  return result ? result.value : null;
};

export const getGroups = async (): Promise<Group[]> => {
  return await db.getAllAsync<Group>("SELECT * FROM groups");
};

export const addGroup = async (name: string): Promise<number> => {
  const result = await db.runAsync("INSERT INTO groups (name) VALUES (?)", [
    name,
  ]);
  return result.lastInsertRowId;
};

export const deleteGroup = async (id: number) => {
  await db.runAsync("DELETE FROM groups WHERE id = ?", [id]);
};

export const getFilesByGroupIds = async (
  groupIds: number[],
): Promise<MediaFile[]> => {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map(() => "?").join(",");
  return await db.getAllAsync<MediaFile>(
    `SELECT * FROM files WHERE group_id IN (${placeholders})`,
    groupIds,
  );
};

export const addFile = async (
  name: string,
  local_uri: string,
  group_id: number,
): Promise<number> => {
  const result = await db.runAsync(
    "INSERT INTO files (name, local_uri, group_id) VALUES (?, ?, ?)",
    [name, local_uri, group_id],
  );
  return result.lastInsertRowId;
};

export const deleteFile = async (id: number) => {
  await db.runAsync("DELETE FROM files WHERE id = ?", [id]);
};

export const getAllFiles = async (): Promise<MediaFile[]> => {
  return await db.getAllAsync<MediaFile>("SELECT * FROM files");
};

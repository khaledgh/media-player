export type Role = 'admin' | 'user';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface AdminUser extends User {
  disabled: boolean;
  created_at: number;
  group_ids: number[];
  tracks: number;
}

export interface Group {
  id: number;
  name: string;
  user_ids: number[];
}

export interface Folder {
  id: number;
  owner_user_id: number | null;
  parent_id: number | null;
  name: string;
  sort_order: number;
  sort_mode: string;
  track_count: number;
}

export interface Track {
  item_id?: number;
  id: number;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  size_bytes: number;
  mime: string;
  has_cover: boolean;
  source: 'upload' | 'youtube';
  source_url?: string;
  created_at: number;
}

export interface DayPoint {
  day: string;
  plays: number;
  users: number;
}

export interface TopTrack {
  id: number;
  title: string;
  artist: string;
  plays: number;
  downloads: number;
  listeners: number;
  last_played_at: number;
}

export interface TopArtist {
  artist: string;
  plays: number;
  tracks: number;
}

export interface TopUser {
  id: number;
  email: string;
  name: string;
  plays: number;
  downloads: number;
  last_played_at: number;
}

export interface Overview {
  days: number;
  plays_total: number;
  plays_period: number;
  listeners_period: number;
  downloads_total: number;
  favorites_total: number;
  daily: DayPoint[];
  top_tracks: TopTrack[];
  top_downloaded: TopTrack[];
  top_artists: TopArtist[];
  top_users: TopUser[];
}

export interface UserActivity {
  user_id: number;
  plays_total: number;
  plays_period: number;
  downloads_total: number;
  favorites_total: number;
  unique_tracks: number;
  last_played_at: number;
  daily: DayPoint[];
  top_played: TopTrack[];
  top_downloaded: TopTrack[];
  top_artists: TopArtist[];
}

export interface AiSuggestion {
  id: number;
  old_title: string;
  old_artist: string;
  title: string;
  artist: string;
  confidence: 'high' | 'low';
}

export interface ImportJob {
  id: number;
  folder_id: number;
  file_name: string;
  status: 'queued' | 'running' | 'done' | 'error';
  total: number;
  processed: number;
  failed: number;
  error?: string;
  created_at: number;
}

export interface YouTubeJob {
  id: number;
  user_id: number;
  user_email?: string;
  url: string;
  folder_id: number;
  status: 'queued' | 'running' | 'done' | 'error';
  error?: string;
  track_id: number | null;
  created_at: number;
}

export interface Session {
  id: number;
  device_name: string;
  last_used_at: number;
  expires_at: number;
}

export type Stats = Record<
  'users' | 'tracks' | 'storage_bytes' | 'shared_folders' | 'user_folders' | 'youtube_today' | 'youtube_failed' | 'active_devices',
  number
>;

interface Tokens {
  access_token: string;
  refresh_token: string;
  user: User;
}

const KEY = 'mume.cms.session';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function loadSession(): Tokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

let session = loadSession();
const listeners = new Set<() => void>();

function setSession(s: Tokens | null) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the session lives in memory only
  }
  listeners.forEach((l) => l());
}

export const auth = {
  user: () => session?.user ?? null,
  token: () => session?.access_token ?? null,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async login(email: string, password: string) {
    const t = await raw<Tokens>('POST', '/auth/login', { email, password, device_name: 'Admin CMS' }, false);
    if (t.user.role !== 'admin') throw new ApiError(403, 'This account is not an administrator.');
    setSession(t);
  },
  async logout() {
    const rt = session?.refresh_token;
    setSession(null);
    if (rt) await raw('POST', '/auth/logout', { refresh_token: rt }, false).catch(() => {});
  },
};

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const t = await raw<Tokens>('POST', '/auth/refresh', { refresh_token: session!.refresh_token }, false);
      setSession(t);
      return true;
    } catch {
      setSession(null);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function raw<T>(method: string, path: string, body?: unknown, authed = true, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (authed && session) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (res.status === 401 && authed && retry && (await refresh())) {
    return raw<T>(method, path, body, authed, false);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => raw<T>('GET', p),
  post: <T>(p: string, b?: unknown) => raw<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => raw<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => raw<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => raw<T>('DELETE', p),
};

/** Uploads files with progress reporting (fetch has no upload progress). */
export function uploadFiles(
  path: string,
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<{ job_ids: number[]; skipped: string[] }> {
  const send = (): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/v1${path}`);
      xhr.setRequestHeader('Authorization', `Bearer ${auth.token()}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
      xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
      xhr.send(form);
    });
  return (async () => {
    let r = await send();
    if (r.status === 401 && (await refresh())) r = await send();
    if (r.status < 200 || r.status >= 300) {
      let msg = `Upload failed (${r.status})`;
      try {
        msg = JSON.parse(r.body).error ?? msg;
      } catch {
        // keep generic message
      }
      throw new ApiError(r.status, msg);
    }
    return JSON.parse(r.body);
  })();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function timeAgo(ms: number) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

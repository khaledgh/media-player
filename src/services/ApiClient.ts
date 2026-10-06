import * as SecureStore from 'expo-secure-store';

export interface ApiUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

interface Session {
  server: string;
  accessToken: string;
  refreshToken: string;
  user: ApiUser;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Thrown when the device cannot reach the server; callers treat it as "offline". */
export class OfflineError extends Error {}

const SESSION_KEY = 'mume.session';
const SERVER_KEY = 'mume.server';
export const DEFAULT_SERVER = 'http://10.0.2.2:8080'; // Android emulator → host machine

let session: Session | null = null;
let onSignedOut: (() => void) | null = null;

export const api = {
  async load(): Promise<Session | null> {
    try {
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      session = raw ? JSON.parse(raw) : null;
    } catch {
      session = null;
    }
    return session;
  },

  get user() {
    return session?.user ?? null;
  },

  get server() {
    return session?.server ?? null;
  },

  /** Called when the server rejects the refresh token (account disabled, password changed). */
  setSignedOutHandler(fn: () => void) {
    onSignedOut = fn;
  },

  async lastServer(): Promise<string> {
    return (await SecureStore.getItemAsync(SERVER_KEY).catch(() => null)) || DEFAULT_SERVER;
  },

  async login(server: string, email: string, password: string, deviceName: string): Promise<ApiUser> {
    const base = server.trim().replace(/\/+$/, '');
    const t = await request<{ access_token: string; refresh_token: string; user: ApiUser }>(base, 'POST', '/auth/login', {
      email,
      password,
      device_name: deviceName,
    });
    await save({ server: base, accessToken: t.access_token, refreshToken: t.refresh_token, user: t.user });
    await SecureStore.setItemAsync(SERVER_KEY, base);
    return t.user;
  },

  async logout() {
    const s = session;
    await save(null);
    if (s) request(s.server, 'POST', '/auth/logout', { refresh_token: s.refreshToken }).catch(() => {});
  },

  get: <T>(path: string) => authed<T>('GET', path),
  post: <T>(path: string, body?: unknown) => authed<T>('POST', path, body ?? {}),

  /** Absolute URL plus auth header, for native upload/download APIs. */
  async authHeaders(): Promise<Record<string, string>> {
    if (!session) throw new ApiError(401, 'Not signed in');
    return { Authorization: `Bearer ${session.accessToken}` };
  },

  url(path: string) {
    return `${session?.server}/api/v1${path}`;
  },

  refresh: () => refresh(),
};

async function save(s: Session | null) {
  session = s;
  if (s) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
}

async function request<T>(base: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new OfflineError('Cannot reach the server');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      // non-JSON body
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const s = session;
  if (!s) return false;
  refreshing ??= (async () => {
    try {
      const t = await request<{ access_token: string; refresh_token: string; user: ApiUser }>(s.server, 'POST', '/auth/refresh', {
        refresh_token: s.refreshToken,
      });
      await save({ ...s, accessToken: t.access_token, refreshToken: t.refresh_token, user: t.user });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await save(null);
        onSignedOut?.();
      }
      if (e instanceof OfflineError) throw e;
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!session) throw new ApiError(401, 'Not signed in');
  try {
    return await request<T>(session.server, method, path, body, session.accessToken);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && (await refresh()) && session) {
      return request<T>(session.server, method, path, body, session.accessToken);
    }
    throw e;
  }
}

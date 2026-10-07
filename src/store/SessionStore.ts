import { Platform } from 'react-native';
import { create } from 'zustand';
import TrackPlayer from 'react-native-track-player';
import { api } from '../services/ApiClient';
import type { ApiUser } from '../services/ApiClient';
import { closeUserDb, openUserDb } from '../data/db';
import SyncService from '../services/SyncService';
import DownloadManager from '../services/DownloadManager';
import YouTubeService from '../services/YouTubeService';

interface SessionState {
  status: 'loading' | 'signedOut' | 'ready';
  user: ApiUser | null;
  restore: () => Promise<void>;
  login: (server: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

async function startServices(user: ApiUser) {
  await openUserDb(user.id);
  await DownloadManager.init();
  SyncService.start();
  YouTubeService.init();
}

// Best-effort: one failing or hanging step must never block signing out.
const attempt = (fn: () => unknown, ms = 3000) =>
  Promise.race([Promise.resolve().then(fn), new Promise((r) => setTimeout(r, ms))]).catch((e) => console.warn('[session] teardown step failed', e));

// Teardown that is still running after the UI has already switched to signed-out.
let stopping: Promise<void> = Promise.resolve();

async function stopServices() {
  await attempt(() => SyncService.stop());
  await attempt(() => YouTubeService.stop());
  await attempt(() => DownloadManager.cancelAll());
  await attempt(() => TrackPlayer.reset());
  await attempt(() => closeUserDb());
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,

  // Offline-first: a saved session opens the local library without the network.
  restore: async () => {
    api.setSignedOutHandler(() => {
      stopServices().finally(() => set({ status: 'signedOut', user: null }));
    });
    const s = await api.load();
    if (!s) return set({ status: 'signedOut' });
    await startServices(s.user);
    set({ status: 'ready', user: s.user });
  },

  login: async (server, email, password) => {
    const device = `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} ${Platform.Version}`;
    const user = await api.login(server, email, password, device);
    await stopping;
    await startServices(user);
    set({ status: 'ready', user });
  },

  logout: async () => {
    console.log('[session] signing out');
    // Switch the UI first so no mounted screen queries a closing database.
    set({ status: 'signedOut', user: null });
    stopping = stopServices().then(() => attempt(() => api.logout()).then(() => {}));
    await stopping;
    console.log('[session] signed out');
  },
}));

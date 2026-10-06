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

async function stopServices() {
  SyncService.stop();
  YouTubeService.stop();
  await DownloadManager.cancelAll();
  await TrackPlayer.reset().catch(() => {});
  await closeUserDb();
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
    await startServices(user);
    set({ status: 'ready', user });
  },

  logout: async () => {
    await stopServices();
    await api.logout();
    set({ status: 'signedOut', user: null });
  },
}));

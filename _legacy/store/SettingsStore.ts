import { create } from 'zustand';
import * as SQLiteService from '../services/SQLiteService';

interface SettingsState {
  serverUrl: string;
  sleepTimerMinutes: number; // 0 = off
  setServerUrl: (url: string) => Promise<void>;
  setSleepTimerMinutes: (minutes: number) => void;
  loadSettings: () => Promise<void>;
}

const DEFAULT_SERVER_URL = 'https://yt.linksbridge.top';

export const useSettingsStore = create<SettingsState>((set) => ({
  serverUrl: DEFAULT_SERVER_URL,
  sleepTimerMinutes: 0,

  setServerUrl: async (url: string) => {
    const trimmed = url.trim() || DEFAULT_SERVER_URL;
    set({ serverUrl: trimmed });
    await SQLiteService.saveSetting('serverUrl', trimmed);
  },

  setSleepTimerMinutes: (minutes: number) => {
    set({ sleepTimerMinutes: minutes });
  },

  loadSettings: async () => {
    try {
      const url = await SQLiteService.getSetting('serverUrl');
      if (url) set({ serverUrl: url });
    } catch {
      // use defaults
    }
  },
}));

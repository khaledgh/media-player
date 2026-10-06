import { create } from 'zustand';

interface DownloadState {
  isDownloading: boolean;
  progress: number; // 0 to 1
  itemName: string;
  error: string | null;

  startDownload: (name: string) => void;
  updateProgress: (progress: number) => void;
  finishDownload: () => void;
  failDownload: (error: string) => void;
  reset: () => void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  isDownloading: false,
  progress: 0,
  itemName: '',
  error: null,

  startDownload: (name: string) =>
    set({ isDownloading: true, progress: 0, itemName: name, error: null }),

  updateProgress: (progress: number) =>
    set({ progress }),

  finishDownload: () =>
    set({ isDownloading: false, progress: 1, itemName: '', error: null }),

  failDownload: (error: string) =>
    set({ isDownloading: false, progress: 0, error }),

  reset: () =>
    set({ isDownloading: false, progress: 0, itemName: '', error: null }),
}));

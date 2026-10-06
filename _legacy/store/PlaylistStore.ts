import { create } from "zustand";
import * as SQLiteService from "../services/SQLiteService";
import TrackPlayer, { RepeatMode } from "react-native-track-player";

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
  missing?: boolean;
}

export type RepeatModeType = 'off' | 'one' | 'all';

interface PlaylistState {
  availableGroups: Group[];
  selectedGroupIds: number[];
  currentPlaylist: MediaFile[];
  currentTrack: MediaFile | null;
  isPlaying: boolean;
  isLoading: boolean;
  isShuffled: boolean;
  repeatMode: RepeatModeType;
  recentlyPlayed: MediaFile[];

  // Actions
  refreshGroups: () => Promise<void>;
  toggleGroupSelection: (groupId: number) => Promise<void>;
  selectGroup: (groupId: number) => Promise<void>;
  deselectGroup: (groupId: number) => Promise<void>;
  setCurrentTrack: (track: MediaFile | null) => void;
  setIsPlaying: (playing: boolean) => void;
  loadInitialData: () => Promise<void>;
  reorderTrack: (fromIndex: number, toIndex: number) => void;
  deleteTrack: (trackId: number) => void;
  refreshPlaylist: () => Promise<void>;
  toggleShuffle: () => Promise<void>;
  cycleRepeatMode: () => Promise<void>;
  addToRecentlyPlayed: (track: MediaFile) => void;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  availableGroups: [],
  selectedGroupIds: [],
  currentPlaylist: [],
  currentTrack: null,
  isPlaying: false,
  isLoading: false,
  isShuffled: false,
  repeatMode: 'all',
  recentlyPlayed: [],

  refreshGroups: async () => {
    set({ isLoading: true });
    try {
      const groups = await SQLiteService.getGroups();
      set({ availableGroups: groups });
    } finally {
      set({ isLoading: false });
    }
  },

  toggleGroupSelection: async (groupId: number) => {
    const { selectedGroupIds } = get();
    const isSelected = selectedGroupIds.includes(groupId);

    const newSelectedGroupIds = isSelected
      ? selectedGroupIds.filter((id) => id !== groupId)
      : [...selectedGroupIds, groupId];

    set({ selectedGroupIds: newSelectedGroupIds, isLoading: true });
    await SQLiteService.saveSetting("selectedGroupIds", JSON.stringify(newSelectedGroupIds));

    try {
      const files = await SQLiteService.getFilesByGroupIds(newSelectedGroupIds);
      // Verify files actually exist on disk
      const verified = await SQLiteService.verifyFilesExist(files);
      set({ currentPlaylist: verified });
    } finally {
      set({ isLoading: false });
    }
  },

  selectGroup: async (groupId: number) => {
    const { selectedGroupIds } = get();
    if (selectedGroupIds.includes(groupId)) {
      const files = await SQLiteService.getFilesByGroupIds(selectedGroupIds);
      const verified = await SQLiteService.verifyFilesExist(files);
      set({ currentPlaylist: verified });
      return;
    }
    const newSelectedGroupIds = [...selectedGroupIds, groupId];
    set({ selectedGroupIds: newSelectedGroupIds, isLoading: true });
    await SQLiteService.saveSetting("selectedGroupIds", JSON.stringify(newSelectedGroupIds));
    try {
      const files = await SQLiteService.getFilesByGroupIds(newSelectedGroupIds);
      const verified = await SQLiteService.verifyFilesExist(files);
      set({ currentPlaylist: verified });
    } finally {
      set({ isLoading: false });
    }
  },

  deselectGroup: async (groupId: number) => {
    const { selectedGroupIds } = get();
    const newSelectedGroupIds = selectedGroupIds.filter((id) => id !== groupId);
    set({ selectedGroupIds: newSelectedGroupIds, isLoading: true });
    await SQLiteService.saveSetting("selectedGroupIds", JSON.stringify(newSelectedGroupIds));
    try {
      const files = await SQLiteService.getFilesByGroupIds(newSelectedGroupIds);
      const verified = await SQLiteService.verifyFilesExist(files);
      set({ currentPlaylist: verified });
    } finally {
      set({ isLoading: false });
    }
  },

  setCurrentTrack: (track: MediaFile | null) => {
    set({ currentTrack: track });
  },

  setIsPlaying: (playing: boolean) => {
    set({ isPlaying: playing });
  },

  loadInitialData: async () => {
    set({ isLoading: true });
    try {
      await SQLiteService.initDatabase();
      console.log('[PlaylistStore] Database initialized successfully');

      const savedIds = await SQLiteService.getSetting("selectedGroupIds");
      let selectedGroupIds: number[] = [];
      if (savedIds) {
        try {
          selectedGroupIds = JSON.parse(savedIds);
        } catch (e) {}
      }

      const groups = await SQLiteService.getGroups();
      selectedGroupIds = selectedGroupIds.filter(id => groups.some(g => g.id === id));

      set({ availableGroups: groups, selectedGroupIds });

      if (selectedGroupIds.length > 0) {
        const files = await SQLiteService.getFilesByGroupIds(selectedGroupIds);
        const verified = await SQLiteService.verifyFilesExist(files);
        set({ currentPlaylist: verified });
      }
    } catch (error) {
      console.error("Failed to load initial data", error);
    } finally {
      set({ isLoading: false });
    }
  },

  reorderTrack: async (fromIndex: number, toIndex: number) => {
    const { currentPlaylist } = get();
    if (toIndex < 0 || toIndex >= currentPlaylist.length) return;

    const newPlaylist = [...currentPlaylist];
    const [movedItem] = newPlaylist.splice(fromIndex, 1);
    newPlaylist.splice(toIndex, 0, movedItem);
    
    // Update sort_order for all affected tracks
    const updates = newPlaylist.map((track, index) => ({
      id: track.id,
      sortOrder: index
    }));
    
    await SQLiteService.updateMultipleFileSortOrders(updates);
    
    // Update local state with new sort orders
    const updatedPlaylist = newPlaylist.map((track, index) => ({
      ...track,
      sort_order: index
    }));
    
    set({ currentPlaylist: updatedPlaylist });
  },

  deleteTrack: (trackId: number) => {
    const { currentPlaylist, currentTrack } = get();
    set({
      currentPlaylist: currentPlaylist.filter((t) => t.id !== trackId),
      currentTrack: currentTrack?.id === trackId ? null : currentTrack,
    });
  },

  refreshPlaylist: async () => {
    const { selectedGroupIds } = get();
    if (selectedGroupIds.length === 0) {
      set({ currentPlaylist: [] });
      return;
    }
    set({ isLoading: true });
    try {
      const files = await SQLiteService.getFilesByGroupIds(selectedGroupIds);
      const verified = await SQLiteService.verifyFilesExist(files);
      set({ currentPlaylist: verified });
    } finally {
      set({ isLoading: false });
    }
  },

  toggleShuffle: async () => {
    const { isShuffled, currentPlaylist } = get();
    const newShuffled = !isShuffled;
    if (newShuffled) {
      // Fisher-Yates shuffle
      const shuffled = [...currentPlaylist];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      set({ isShuffled: true, currentPlaylist: shuffled });
    } else {
      // Restore original sort order
      const sorted = [...currentPlaylist].sort((a, b) => a.sort_order - b.sort_order);
      set({ isShuffled: false, currentPlaylist: sorted });
    }
  },

  cycleRepeatMode: async () => {
    const { repeatMode } = get();
    const next: RepeatModeType =
      repeatMode === 'off' ? 'one' : repeatMode === 'one' ? 'all' : 'off';
    set({ repeatMode: next });
    const rnMode =
      next === 'off' ? RepeatMode.Off :
      next === 'one' ? RepeatMode.Track :
      RepeatMode.Queue;
    try {
      await TrackPlayer.setRepeatMode(rnMode);
    } catch {}
  },

  addToRecentlyPlayed: (track: MediaFile) => {
    const { recentlyPlayed } = get();
    const filtered = recentlyPlayed.filter(t => t.id !== track.id);
    set({ recentlyPlayed: [track, ...filtered].slice(0, 20) });
  },
}));

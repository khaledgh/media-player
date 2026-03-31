import { create } from "zustand";
import * as SQLiteService from "../services/SQLiteService";

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

interface PlaylistState {
  availableGroups: Group[];
  selectedGroupIds: number[];
  currentPlaylist: MediaFile[];
  currentTrack: MediaFile | null;
  isLoading: boolean;

  // Actions
  refreshGroups: () => Promise<void>;
  toggleGroupSelection: (groupId: number) => Promise<void>;
  selectGroup: (groupId: number) => Promise<void>;
  deselectGroup: (groupId: number) => Promise<void>;
  setCurrentTrack: (track: MediaFile | null) => void;
  loadInitialData: () => Promise<void>;
  reorderTrack: (fromIndex: number, toIndex: number) => void;
  deleteTrack: (trackId: number) => void;
  refreshPlaylist: () => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  availableGroups: [],
  selectedGroupIds: [],
  currentPlaylist: [],
  currentTrack: null,
  isLoading: false,

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
      set({ currentPlaylist: files });
    } finally {
      set({ isLoading: false });
    }
  },
  
  selectGroup: async (groupId: number) => {
    const { selectedGroupIds } = get();
    if (selectedGroupIds.includes(groupId)) {
        // If already selected, just refresh to be safe
        const files = await SQLiteService.getFilesByGroupIds(selectedGroupIds);
        set({ currentPlaylist: files });
        return;
    }
    const newSelectedGroupIds = [...selectedGroupIds, groupId];
    set({ selectedGroupIds: newSelectedGroupIds, isLoading: true });
    await SQLiteService.saveSetting("selectedGroupIds", JSON.stringify(newSelectedGroupIds));
    try {
      const files = await SQLiteService.getFilesByGroupIds(newSelectedGroupIds);
      set({ currentPlaylist: files });
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
      set({ currentPlaylist: files });
    } finally {
      set({ isLoading: false });
    }
  },

  setCurrentTrack: (track: MediaFile | null) => {
    set({ currentTrack: track });
  },

  loadInitialData: async () => {
    set({ isLoading: true });
    try {
      await SQLiteService.initDatabase();
      
      // Load saved selections
      const savedIds = await SQLiteService.getSetting("selectedGroupIds");
      let selectedGroupIds: number[] = [];
      if (savedIds) {
        try {
          selectedGroupIds = JSON.parse(savedIds);
        } catch (e) {}
      }

      const groups = await SQLiteService.getGroups();
      
      // Filter out any IDs that no longer exist (optional but good)
      selectedGroupIds = selectedGroupIds.filter(id => groups.some(g => g.id === id));
      
      set({ availableGroups: groups, selectedGroupIds });
      
      // Load files for selected groups
      if (selectedGroupIds.length > 0) {
        const files = await SQLiteService.getFilesByGroupIds(selectedGroupIds);
        set({ currentPlaylist: files });
      }
    } catch (error) {
      console.error("Failed to load initial data", error);
    } finally {
      set({ isLoading: false });
    }
  },
  reorderTrack: (fromIndex: number, toIndex: number) => {
    const { currentPlaylist } = get();
    if (toIndex < 0 || toIndex >= currentPlaylist.length) return;
    
    const newPlaylist = [...currentPlaylist];
    const [movedItem] = newPlaylist.splice(fromIndex, 1);
    newPlaylist.splice(toIndex, 0, movedItem);
    set({ currentPlaylist: newPlaylist });
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
      set({ currentPlaylist: files });
    } finally {
      set({ isLoading: false });
    }
  },
}));

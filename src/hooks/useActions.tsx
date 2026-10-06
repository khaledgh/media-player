import React, { useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { CloudDownload, CloudOff, FolderInput, FolderPlus, ListMusic, Pencil, Play, Shuffle, SquarePlay, Trash2, Upload } from 'lucide-react-native';
import { useOverlays } from '../components/Overlays';
import Artwork from '../components/Artwork';
import Player from '../services/PlayerService';
import DownloadManager from '../services/DownloadManager';
import YouTubeService from '../services/YouTubeService';
import {
  createFolder,
  deleteFolder,
  getFolderTracksDeep,
  getSubtreeIds,
  importLocalFile,
  moveFolder,
  renameFolder,
  setFolderSort,
  SORT_LABELS,
} from '../data/library';
import type { Folder, SortMode, Track } from '../data/library';
import { colors } from '../theme';

export function useActions() {
  const o = useOverlays();

  const play = useCallback(
    async (tracks: Track[], index = 0, opts: { shuffle?: boolean; title?: string } = {}) => {
      try {
        await Player.playList(tracks, index, opts);
      } catch (e) {
        o.toast(e instanceof Error ? e.message : String(e));
      }
    },
    [o],
  );

  const playFolder = useCallback(
    async (folder: Folder, shuffle = false) => {
      const tracks = await getFolderTracksDeep(folder.id);
      if (!tracks.length) return o.toast('This folder is empty');
      await play(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0, { shuffle, title: folder.name });
    },
    [o, play],
  );

  const newFolder = useCallback(
    async (parentId: number | null) => {
      const name = await o.prompt({ title: parentId ? 'New subfolder' : 'New folder', placeholder: 'e.g. Gym, Road trip, Chill', confirm: 'Create' });
      if (!name) return null;
      try {
        const id = await createFolder(name, parentId);
        o.toast(`Created "${name}"`);
        return id;
      } catch (e) {
        o.toast(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [o],
  );

  const addFromYouTube = useCallback(
    async (folderId?: number) => {
      const url = await o.prompt({
        title: 'Add from YouTube',
        placeholder: 'Paste a YouTube link',
        confirm: 'Add',
        hint: 'The song is saved to the cloud and downloads to all your devices.',
      });
      if (!url) return;
      const target = folderId ?? (await o.pickFolder({ title: 'Save to folder' }));
      if (!target) return;
      try {
        await YouTubeService.add(url, target);
        o.toast('Getting the audio… it will appear in the folder shortly');
      } catch (e) {
        o.toast(e instanceof Error ? e.message : String(e));
      }
    },
    [o],
  );

  const importFiles = useCallback(
    async (folderId: number) => {
      const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
      if (res.canceled) return;
      let n = 0;
      for (const a of res.assets) {
        try {
          await importLocalFile(folderId, a.uri, a.name, a.size ?? 0);
          n++;
        } catch (e) {
          o.toast(e instanceof Error ? e.message : String(e));
        }
      }
      if (n) o.toast(`Imported ${n} song${n === 1 ? '' : 's'} — uploading in the background`);
    },
    [o],
  );

  const chooseSort = useCallback(
    async (folder: Folder) => {
      const mode = await o.choose<SortMode>({
        title: 'Sort songs by',
        selected: folder.sort_mode,
        options: (Object.keys(SORT_LABELS) as SortMode[]).map((value) => ({ value, label: SORT_LABELS[value] })),
      });
      if (mode) await setFolderSort(folder.id, mode);
    },
    [o],
  );

  const folderMenu = useCallback(
    (folder: Folder, extra: { onDeleted?: () => void } = {}) => {
      const own = !folder.shared;
      const icon = (I: typeof Play, danger = false) => <I size={20} color={danger ? colors.danger : colors.text} />;
      o.actions({
        title: folder.name,
        subtitle: `${folder.track_count} songs${folder.folder_count ? ` · ${folder.folder_count} folders` : ''}${folder.shared ? ' · Shared with you' : ''}`,
        header: <Artwork seed={folder.id} kind="folder" size={48} radius={14} />,
        items: [
          { label: 'Play', icon: icon(Play), onPress: () => playFolder(folder) },
          { label: 'Shuffle', icon: icon(Shuffle), onPress: () => playFolder(folder, true) },
          folder.auto_download
            ? {
                label: 'Remove downloads',
                icon: icon(CloudOff),
                onPress: async () => {
                  if (
                    await o.confirm({
                      title: 'Remove downloads?',
                      message: 'Songs stay in your library and in the cloud. They will stream when online and stop downloading automatically.',
                      confirm: 'Remove',
                    })
                  ) {
                    const n = await DownloadManager.removeFolderDownloads(folder.id);
                    o.toast(n ? `Freed ${n} song${n === 1 ? '' : 's'}` : 'Auto-download turned off');
                  }
                },
              }
            : { label: 'Download folder', icon: icon(CloudDownload), onPress: () => (DownloadManager.downloadFolder(folder.id), o.toast('Downloading for offline')) },
          { label: 'Sort songs', icon: icon(ListMusic), onPress: () => chooseSort(folder) },
          ...(own
            ? [
                { label: 'Add from YouTube', icon: icon(SquarePlay), onPress: () => addFromYouTube(folder.id) },
                { label: 'Import from phone', icon: icon(Upload), onPress: () => importFiles(folder.id) },
                { label: 'New subfolder', icon: icon(FolderPlus), onPress: () => newFolder(folder.id) },
                {
                  label: 'Rename',
                  icon: icon(Pencil),
                  onPress: async () => {
                    const name = await o.prompt({ title: 'Rename folder', initial: folder.name });
                    if (name) await renameFolder(folder.id, name);
                  },
                },
                {
                  label: 'Move',
                  icon: icon(FolderInput),
                  onPress: async () => {
                    const target = await o.pickFolder({ title: `Move "${folder.name}" to`, excludeIds: await getSubtreeIds(folder.id), allowRoot: true });
                    if (target !== undefined) {
                      await moveFolder(folder.id, target);
                      o.toast('Folder moved');
                    }
                  },
                },
                {
                  label: 'Delete',
                  danger: true,
                  icon: icon(Trash2, true),
                  onPress: async () => {
                    if (
                      await o.confirm({
                        title: `Delete "${folder.name}"?`,
                        message: 'The folder and its subfolders are removed from all your devices. Songs that are in other folders stay there.',
                        confirm: 'Delete',
                        danger: true,
                      })
                    ) {
                      await deleteFolder(folder.id);
                      extra.onDeleted?.();
                    }
                  },
                },
              ]
            : []),
        ],
      });
    },
    [o, playFolder, chooseSort, addFromYouTube, importFiles, newFolder],
  );

  return { ...o, play, playFolder, newFolder, addFromYouTube, importFiles, folderMenu, chooseSort };
}

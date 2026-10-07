import DownloadManager from '../services/DownloadManager';
import { copyTracks } from '../data/library';
import type { Track } from '../data/library';

interface Ui {
  pickFolder: (o: { title: string; excludeIds?: number[]; allowRoot?: boolean }) => Promise<number | null | undefined>;
  toast: (msg: string) => void;
}

/**
 * Saves a song from the online library: asks which of your folders it should go to
 * (the picker also offers "New folder"), adds it there and downloads the file.
 */
export async function downloadToFolder(track: Track, ui: Ui) {
  const target = await ui.pickFolder({ title: 'Download to folder' });
  if (!target) return; // cancelled
  try {
    await copyTracks([track.id], target);
    if (track.download_state === 'done') return ui.toast(`Added "${track.title}" to the folder`);
    ui.toast(`Downloading "${track.title}"…`);
    await DownloadManager.downloadTrack(track.id);
    ui.toast(`Downloaded "${track.title}"`);
  } catch (e) {
    ui.toast(e instanceof Error && e.message ? `Download failed: ${e.message}` : 'Download failed');
  }
}

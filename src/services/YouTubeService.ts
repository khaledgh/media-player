import { create } from 'zustand';
import { api } from './ApiClient';
import SyncService from './SyncService';
import { getDb, kvGet, kvSet } from '../data/db';

export interface YouTubeJob {
  id: number;
  url: string;
  status: 'queued' | 'running' | 'done' | 'error';
  error?: string;
  folderName: string;
}

interface State {
  jobs: YouTubeJob[];
}

export const useYouTubeJobs = create<State>(() => ({ jobs: [] }));

const YT = /(youtube\.com\/(watch\?(.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(.*&)?v=)[A-Za-z0-9_-]{11}/;

export const isYouTubeUrl = (s: string) => YT.test(s.trim());

class YouTubeService {
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Restores jobs that were still running when the app closed. */
  async init() {
    const raw = await kvGet('youtube_jobs');
    const jobs: YouTubeJob[] = raw ? JSON.parse(raw) : [];
    useYouTubeJobs.setState({ jobs: jobs.filter((j) => j.status === 'queued' || j.status === 'running') });
    this.poll();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    useYouTubeJobs.setState({ jobs: [] });
  }

  /** Asks the server to fetch a video's audio into a folder. */
  async add(url: string, folderId: number) {
    if (!isYouTubeUrl(url)) throw new Error('Paste a YouTube video link, e.g. https://youtu.be/…');
    let folder = await getDb().getFirstAsync<{ remote_id: number | null; name: string; shared: number }>(
      'SELECT remote_id, name, shared FROM folders WHERE id = ?',
      [folderId],
    );
    if (!folder) throw new Error('Folder not found');
    if (folder.shared) throw new Error('Pick one of your own folders.');
    if (!folder.remote_id) {
      // A folder made offline must reach the server first.
      await SyncService.run();
      folder = await getDb().getFirstAsync('SELECT remote_id, name, shared FROM folders WHERE id = ?', [folderId]);
      if (!folder?.remote_id) throw new Error('You are offline. Try again when connected.');
    }
    const job = await api.post<{ id: number; url: string; status: YouTubeJob['status'] }>('/youtube', {
      url: url.trim(),
      folder_id: folder.remote_id,
    });
    await this.save([...useYouTubeJobs.getState().jobs, { id: job.id, url: job.url, status: job.status, folderName: folder.name }]);
    this.poll();
  }

  dismiss(id: number) {
    this.save(useYouTubeJobs.getState().jobs.filter((j) => j.id !== id));
  }

  private async save(jobs: YouTubeJob[]) {
    useYouTubeJobs.setState({ jobs });
    await kvSet('youtube_jobs', JSON.stringify(jobs)).catch(() => {});
  }

  private poll() {
    if (this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      const jobs = useYouTubeJobs.getState().jobs;
      const open = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
      if (!open.length) return;
      let finished = false;
      const updated = await Promise.all(
        jobs.map(async (j) => {
          if (j.status === 'done' || j.status === 'error') return j;
          try {
            const r = await api.get<{ status: YouTubeJob['status']; error?: string }>(`/youtube/${j.id}`);
            if (r.status === 'done') finished = true;
            return { ...j, status: r.status, error: r.error };
          } catch {
            return j; // offline: keep waiting
          }
        }),
      );
      await this.save(updated);
      if (finished) {
        await SyncService.run(); // brings in the new song; the download manager fetches it
        // Done jobs disappear after a short while; failed ones stay until dismissed.
        setTimeout(() => this.save(useYouTubeJobs.getState().jobs.filter((j) => j.status !== 'done')), 6000);
      }
      this.poll();
    }, 3000);
  }
}

export default new YouTubeService();

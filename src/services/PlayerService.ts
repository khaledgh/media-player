import TrackPlayer, { Event, RepeatMode, State } from 'react-native-track-player';
import type { Track as RNTrack } from 'react-native-track-player';
import { create } from 'zustand';
import { api } from './ApiClient';
import { setupPlayer, JUMP_SECONDS } from './PlaybackService';
import { hasDb, libraryEvents } from '../data/db';
import { coverUri, displayArtist, getTrack, recordPlay, toggleFavorite, isFavorite, trackUri } from '../data/library';
import type { Track } from '../data/library';

const ARTWORK = require('../../assets/artwork.png');

export type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  current: Track | null;
  isPlaying: boolean;
  isFavorite: boolean;
  shuffle: boolean;
  repeat: Repeat;
  rate: number;
  sleepAt: number | null; // epoch ms
  queueTitle: string;
}

export const usePlayer = create<PlayerState>(() => ({
  current: null,
  isPlaying: false,
  isFavorite: false,
  shuffle: false,
  repeat: 'all',
  rate: 1,
  sleepAt: null,
  queueTitle: '',
}));

function toRN(t: Track, url: string): RNTrack {
  return {
    id: String(t.id),
    url,
    title: t.title,
    artist: displayArtist(t),
    album: t.album || undefined,
    duration: t.duration_ms ? t.duration_ms / 1000 : undefined,
    artwork: coverUri(t) ?? ARTWORK,
  };
}

/** A playable URL: the downloaded file, or a short-lived stream link when online. */
async function urlFor(t: Track): Promise<string | null> {
  const local = trackUri(t);
  if (local && t.download_state === 'done') return local;
  if (!t.remote_id) return null;
  try {
    const r = await api.get<{ url: string }>(`/tracks/${t.remote_id}/url`);
    return r.url;
  } catch {
    return null;
  }
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let sleepTimer: ReturnType<typeof setTimeout> | null = null;
let listenersReady = false;

class PlayerService {
  async init() {
    await setupPlayer();
    if (listenersReady) return;
    listenersReady = true;

    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (e) => {
      if (!e.track || !hasDb()) return usePlayer.setState({ current: null });
      const t = await getTrack(Number(e.track.id));
      usePlayer.setState({ current: t, isFavorite: t ? await isFavorite(t.id) : false });
      if (t) recordPlay(t.id).catch(() => {});
    });
    TrackPlayer.addEventListener(Event.PlaybackState, (e) => usePlayer.setState({ isPlaying: e.state === State.Playing }));
    TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
      console.warn('[player] error', e);
      TrackPlayer.skipToNext().catch(() => {});
    });
    // Keep lock-screen metadata fresh when sync updates titles or a cover finishes downloading.
    libraryEvents.subscribe(() => this.refreshCurrent());
  }

  private async refreshCurrent() {
    const cur = usePlayer.getState().current;
    if (!cur || !hasDb()) return;
    const t = await getTrack(cur.id);
    if (!t) return;
    usePlayer.setState({ current: t, isFavorite: await isFavorite(t.id) });
    if (t.title !== cur.title || t.artist !== cur.artist || t.cover_file !== cur.cover_file) {
      const idx = await TrackPlayer.getActiveTrackIndex();
      if (idx !== undefined)
        await TrackPlayer.updateMetadataForTrack(idx, { title: t.title, artist: displayArtist(t), album: t.album, artwork: coverUri(t) ?? ARTWORK });
    }
  }

  /**
   * Replaces the queue and starts playing. Songs that are not downloaded are
   * streamed when online and skipped when offline.
   */
  async playList(tracks: Track[], startIndex = 0, opts: { shuffle?: boolean; title?: string } = {}) {
    await this.init();
    if (!tracks.length) return;
    const shuffle = opts.shuffle ?? false;
    const first = tracks[Math.min(startIndex, tracks.length - 1)];
    const rest = tracks.filter((_, i) => i !== startIndex);
    const order = shuffle ? [first, ...shuffled(rest)] : tracks;

    const firstUrl = await urlFor(first);
    if (!firstUrl) throw new Error(`"${first.title}" is not downloaded yet and you are offline.`);

    // Local files are instant; stream links for the rest are fetched in the background.
    const queue: RNTrack[] = [];
    const later: Track[] = [];
    for (const t of order) {
      if (t.id === first.id) queue.push(toRN(t, firstUrl));
      else if (t.download_state === 'done' && trackUri(t)) queue.push(toRN(t, trackUri(t)!));
      else if (t.remote_id) later.push(t);
    }
    await TrackPlayer.reset();
    await TrackPlayer.add(queue);
    const idx = queue.findIndex((q) => q.id === String(first.id));
    if (idx > 0) await TrackPlayer.skip(idx);
    await TrackPlayer.setRate(usePlayer.getState().rate);
    await TrackPlayer.play();
    usePlayer.setState({ shuffle, queueTitle: opts.title ?? '' });
    this.appendStreams(later);
  }

  private async appendStreams(tracks: Track[]) {
    for (const t of tracks) {
      const url = await urlFor(t);
      if (!url) return; // offline: stop trying
      await TrackPlayer.add(toRN(t, url)).catch(() => {});
    }
  }

  async playNext(track: Track) {
    await this.init();
    const url = await urlFor(track);
    if (!url) throw new Error('This song is not downloaded and you are offline.');
    const idx = await TrackPlayer.getActiveTrackIndex();
    if (idx === undefined) return this.playList([track]);
    await TrackPlayer.add(toRN(track, url), idx + 1);
  }

  async addToQueue(track: Track) {
    await this.init();
    const url = await urlFor(track);
    if (!url) throw new Error('This song is not downloaded and you are offline.');
    if ((await TrackPlayer.getActiveTrackIndex()) === undefined) return this.playList([track]);
    await TrackPlayer.add(toRN(track, url));
  }

  async toggle() {
    const { state } = await TrackPlayer.getPlaybackState();
    if (state === State.Playing) await TrackPlayer.pause();
    else await TrackPlayer.play();
  }

  next = () => TrackPlayer.skipToNext().catch(() => {});

  async previous() {
    const { position } = await TrackPlayer.getProgress();
    if (position > 3) await TrackPlayer.seekTo(0);
    else await TrackPlayer.skipToPrevious().catch(() => TrackPlayer.seekTo(0));
  }

  seekTo = (s: number) => TrackPlayer.seekTo(s);
  jump = (dir: 1 | -1) => TrackPlayer.seekBy(dir * JUMP_SECONDS);

  async cycleRepeat() {
    const next: Repeat = { off: 'all', all: 'one', one: 'off' }[usePlayer.getState().repeat] as Repeat;
    await TrackPlayer.setRepeatMode(next === 'off' ? RepeatMode.Off : next === 'one' ? RepeatMode.Track : RepeatMode.Queue);
    usePlayer.setState({ repeat: next });
  }

  /** Shuffles the songs after the current one (or restores nothing: queue order stays as is). */
  async toggleShuffle() {
    const on = !usePlayer.getState().shuffle;
    usePlayer.setState({ shuffle: on });
    if (!on) return;
    const queue = await TrackPlayer.getQueue();
    const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
    const upcoming = queue.slice(idx + 1);
    if (upcoming.length < 2) return;
    await TrackPlayer.removeUpcomingTracks();
    await TrackPlayer.add(shuffled(upcoming));
  }

  async setRate(rate: number) {
    await TrackPlayer.setRate(rate);
    usePlayer.setState({ rate });
  }

  setSleepTimer(minutes: number) {
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = null;
    if (minutes <= 0) return usePlayer.setState({ sleepAt: null });
    const at = Date.now() + minutes * 60_000;
    sleepTimer = setTimeout(async () => {
      await TrackPlayer.pause();
      usePlayer.setState({ sleepAt: null });
      sleepTimer = null;
    }, minutes * 60_000);
    usePlayer.setState({ sleepAt: at });
  }

  async toggleFavoriteCurrent() {
    const cur = usePlayer.getState().current;
    if (!cur) return;
    usePlayer.setState({ isFavorite: await toggleFavorite(cur.id) });
  }

  async skipToQueueIndex(i: number) {
    await TrackPlayer.skip(i);
    await TrackPlayer.play();
  }

  async removeFromQueue(i: number) {
    await TrackPlayer.remove(i);
  }
}

const player = new PlayerService();
export default player;

/** Lock-screen "like" button. */
export async function toggleLikeFromRemote() {
  if (hasDb()) await player.toggleFavoriteCurrent();
}

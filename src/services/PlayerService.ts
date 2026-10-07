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
let playToken = 0; // bumped by every playList so an older background fill stops
let errorStreak = 0;
const retried = new Set<string>(); // tracks whose stream link was already re-fetched after an error

async function isActivelyPlaying(state?: State): Promise<boolean> {
  const st = state ?? (await TrackPlayer.getPlaybackState()).state;
  if (st === State.Playing) return true;
  if (st === State.Buffering || st === State.Loading) return TrackPlayer.getPlayWhenReady();
  return false;
}

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
    // "Playing" means the user wants sound: it stays true while buffering or loading,
    // so the button does not flicker and a tap during buffering pauses.
    TrackPlayer.addEventListener(Event.PlaybackState, async (e) => {
      if (e.state === State.Playing) errorStreak = 0;
      usePlayer.setState({ isPlaying: await isActivelyPlaying(e.state) });
    });
    TrackPlayer.addEventListener(Event.PlaybackPlayWhenReadyChanged, async () => {
      usePlayer.setState({ isPlaying: await isActivelyPlaying() });
    });
    TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
      console.warn('[player] error', e);
      this.recover();
    });
    await this.resync();
    // Keep lock-screen metadata fresh when sync updates titles or a cover finishes downloading.
    libraryEvents.subscribe(() => this.refreshCurrent());
  }

  /** Picks up playback that kept running in the background while the app was closed. */
  private async resync() {
    if (!hasDb()) return;
    const active = await TrackPlayer.getActiveTrack().catch(() => undefined);
    if (!active) return;
    const t = await getTrack(Number(active.id));
    usePlayer.setState({ current: t, isFavorite: t ? await isFavorite(t.id) : false, isPlaying: await isActivelyPlaying() });
  }

  /**
   * A track failed to play. First retry once with a fresh stream link (links expire);
   * otherwise move on, but give up after a few failures in a row instead of looping.
   */
  private async recover() {
    try {
      const idx = await TrackPlayer.getActiveTrackIndex();
      const active = await TrackPlayer.getActiveTrack();
      if (idx === undefined || !active) return;
      if (!retried.has(active.id)) {
        retried.add(active.id);
        const t = await getTrack(Number(active.id));
        const url = t && (await urlFor(t));
        if (t && url && url !== active.url) {
          await TrackPlayer.add(toRN(t, url), idx + 1);
          await TrackPlayer.remove(idx);
          await TrackPlayer.play();
          return;
        }
      }
      if (++errorStreak >= 3) {
        errorStreak = 0;
        await TrackPlayer.pause();
        return;
      }
      await TrackPlayer.skipToNext();
    } catch {
      // end of queue or player gone: nothing more to do
    }
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
    const rest = tracks.filter((t) => t.id !== first.id);
    const order = shuffle ? [first, ...shuffled(rest)] : tracks;

    const firstUrl = await urlFor(first);
    if (!firstUrl) throw new Error(`"${first.title}" is not downloaded yet and you are offline.`);

    const token = ++playToken;
    errorStreak = 0;
    retried.clear();
    await TrackPlayer.reset();
    await TrackPlayer.add(toRN(first, firstUrl));
    await TrackPlayer.setRate(usePlayer.getState().rate);
    await TrackPlayer.play();
    usePlayer.setState({ shuffle, queueTitle: opts.title ?? '' });

    const at = order.findIndex((t) => t.id === first.id);
    this.fillQueue(order.slice(at + 1), order.slice(0, at), token);
  }

  /**
   * Adds the rest of the list around the song that is already playing, keeping the
   * original order: later songs are appended, earlier ones inserted before it.
   * Stream links are fetched a few at a time; songs that cannot be resolved are skipped.
   */
  private async fillQueue(after: Track[], before: Track[], token: number) {
    const resolve = async (list: Track[]) => {
      const out: RNTrack[] = [];
      for (let i = 0; i < list.length; i += 6) {
        const urls = await Promise.all(list.slice(i, i + 6).map((t) => urlFor(t)));
        if (token !== playToken) return null;
        list.slice(i, i + 6).forEach((t, j) => urls[j] && out.push(toRN(t, urls[j]!)));
      }
      return out;
    };
    try {
      for (let i = 0; i < after.length; i += 6) {
        const chunk = await resolve(after.slice(i, i + 6));
        if (!chunk || token !== playToken) return;
        if (chunk.length) await TrackPlayer.add(chunk);
      }
      const earlier = await resolve(before);
      if (earlier && earlier.length && token === playToken) await TrackPlayer.add(earlier, 0);
    } catch (e) {
      console.warn('[player] could not fill queue', e);
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
    await this.init();
    const { state } = await TrackPlayer.getPlaybackState();
    if (await isActivelyPlaying(state)) return TrackPlayer.pause();
    if (state === State.Ended) await TrackPlayer.seekTo(0);
    if (state === State.Error) {
      errorStreak = 0;
      retried.clear();
      return this.recover();
    }
    await TrackPlayer.play();
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

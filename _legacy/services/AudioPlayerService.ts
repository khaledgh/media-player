import TrackPlayer, { State, Event, usePlaybackState, useProgress } from 'react-native-track-player';
import { setupPlayer } from './PlaybackService';

class AudioPlayerService {
  private isSetup: boolean = false;
  private listeners: Map<string, Set<Function>> = new Map();
  private sleepTimerId: ReturnType<typeof setTimeout> | null = null;
  async setupPlayer() {
    if (this.isSetup) return;
    this.isSetup = await setupPlayer();

    // Listen for track changes (auto-next handled natively by TrackPlayer)
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
      if (event.track) {
        this.emit('trackChanged', {
          id: event.track.id,
          title: event.track.title,
          artist: event.track.artist,
          url: event.track.url,
        });
      }
    });

    // Listen for playback state changes
    TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
      const isPlaying = event.state === State.Playing;
      this.emit('playbackStateChanged', { isPlaying });
    });

    // Listen for queue ended (loop restarts automatically via RepeatMode.Queue)
    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      this.emit('queueEnded', {});
    });

    // Emit initial state
    const state = await TrackPlayer.getPlaybackState();
    const isInitialPlaying = state.state === State.Playing;
    this.emit('playbackStateChanged', { isPlaying: isInitialPlaying });
  }

  async loadPlaylist(tracks: Array<{ id: string; url: string; title: string; artist: string }>, startIndex: number = 0) {
    if (!this.isSetup) await this.setupPlayer();
    
    await TrackPlayer.reset();
    const queue = tracks.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title || 'Unknown Track',
      artist: t.artist || 'SonicGroup Library',
      artwork: 'https://cdn-icons-png.flaticon.com/512/3844/3844724.png', // Fallback artwork helps with visibility
    }));
    
    await TrackPlayer.add(queue);
    
    // Always call skip even if it's 0 to ensure the track is loaded into the player
    if (queue.length > 0) {
      await TrackPlayer.skip(startIndex);
    }
    
    // Trigger initial play to ensure notification shows up immediately
    await TrackPlayer.play();
  }

  async loadTrack(track: { id: string; url: string; title: string; artist: string }) {
    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: track.id,
      url: track.url,
      title: track.title,
      artist: track.artist,
    });
  }

  async play() { await TrackPlayer.play(); }
  async pause() { await TrackPlayer.pause(); }
  async stop() { await TrackPlayer.stop(); }
  async reset() { await TrackPlayer.reset(); }
  async seekTo(positionSeconds: number) { await TrackPlayer.seekTo(positionSeconds); }

  async skipToNext() {
    try { await TrackPlayer.skipToNext(); } catch (e) {}
  }

  async skipToPrevious() {
    try { await TrackPlayer.skipToPrevious(); } catch (e) {}
  }

  async getState() {
    const state = await TrackPlayer.getPlaybackState();
    const progress = await TrackPlayer.getProgress();
    const track = await TrackPlayer.getActiveTrack();

    return {
      isPlaying: state.state === State.Playing,
      position: progress.position,
      duration: progress.duration,
      currentTrack: track ? {
        id: track.id,
        title: track.title,
        artist: track.artist,
        url: track.url,
      } : null,
    };
  }

  addEventListener(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  removeEventListener(event: string, callback: Function) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(callback);
    }
  }

  /** Start a sleep timer; automatically pauses after `minutes` minutes. */
  startSleepTimer(minutes: number) {
    this.clearSleepTimer();
    if (minutes <= 0) return;
    this.sleepTimerId = setTimeout(async () => {
      await TrackPlayer.pause();
      this.sleepTimerId = null;
      this.emit('sleepTimerFired', {});
    }, minutes * 60 * 1000);
  }

  clearSleepTimer() {
    if (this.sleepTimerId !== null) {
      clearTimeout(this.sleepTimerId);
      this.sleepTimerId = null;
    }
  }

  get hasSleepTimer(): boolean {
    return this.sleepTimerId !== null;
  }

  private emit(event: string, data: any) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(callback => callback(data));
    }
  }
}

export default new AudioPlayerService();

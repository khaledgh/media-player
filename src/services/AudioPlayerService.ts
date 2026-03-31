import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';

class AudioPlayerService {
  private player: AudioPlayer | null = null;
  private currentTrack: any = null;
  private isPlayingState: boolean = false;
  private positionSeconds: number = 0;
  private durationSeconds: number = 0;
  private listeners: Map<string, Set<Function>> = new Map();
  private progressInterval: ReturnType<typeof setInterval> | null = null;

  async setupPlayer() {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
  }

  async loadTrack(track: { id: string; url: string; title: string; artist: string }) {
    // Release the previous player if it exists
    if (this.player) {
      const oldPlayer = this.player;
      this.player = null; // Mark as null immediately to prevent other calls from using it
      this.stopProgressTracking();
      
      try {
        oldPlayer.pause();
        oldPlayer.setActiveForLockScreen(false);
        oldPlayer.remove();
      } catch (e) {
        console.error("Cleanup error", e);
      }
      
      // Small delay to let Android release the audio focus/hardware
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.currentTrack = track;

    // Create a new AudioPlayer with the track URI
    const newPlayer = createAudioPlayer({ uri: track.url });
    this.player = newPlayer;

    // Enable lock screen controls
    this.player.setActiveForLockScreen(true, {
      title: track.title,
      artist: track.artist,
    });

    // Start tracking progress
    this.startProgressTracking();
  }

  play() {
    if (this.player) {
      this.player.play();
      this.isPlayingState = true;
      this.emit('playbackStateChanged', { isPlaying: true });
    }
  }

  pause() {
    if (this.player) {
      this.player.pause();
      this.isPlayingState = false;
      this.emit('playbackStateChanged', { isPlaying: false });
    }
  }

  stop() {
    if (this.player) {
      this.player.pause();
      this.player.seekTo(0);
      this.isPlayingState = false;
      this.emit('playbackStateChanged', { isPlaying: false });
    }
  }

  async reset() {
    this.stopProgressTracking();
    if (this.player) {
      const oldPlayer = this.player;
      this.player = null;
      try {
        oldPlayer.pause();
        oldPlayer.setActiveForLockScreen(false);
        oldPlayer.remove();
      } catch (e) {
        console.error("Error in reset cleanup", e);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.currentTrack = null;
    this.isPlayingState = false;
    this.positionSeconds = 0;
    this.durationSeconds = 0;
  }

  async seekTo(positionSeconds: number) {
    if (this.player) {
      await this.player.seekTo(positionSeconds);
    }
  }

  getState() {
    if (this.player) {
      return {
        isPlaying: this.player.playing,
        position: this.player.currentTime,
        duration: this.player.duration,
        currentTrack: this.currentTrack,
      };
    }
    return {
      isPlaying: false,
      position: 0,
      duration: 0,
      currentTrack: this.currentTrack,
    };
  }

  private startProgressTracking() {
    this.stopProgressTracking();
    this.progressInterval = setInterval(() => {
      if (this.player) {
        const currentTime = this.player.currentTime;
        const duration = this.player.duration;
        const isPlaying = this.player.playing;

        this.positionSeconds = currentTime;
        this.durationSeconds = duration;
        this.isPlayingState = isPlaying;

        this.emit('progressUpdate', {
          position: currentTime,
          duration: duration,
        });

        // Check if playback has ended (position reached duration)
        // Check for position being very close to duration and player not playing
        if (duration > 0 && currentTime >= (duration - 0.5) && !isPlaying) {
          this.emit('trackEnded', {});
          this.stopProgressTracking(); // Stop until next load
        }
      }
    }, 500);
  }

  private stopProgressTracking() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
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

  private emit(event: string, data: any) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(callback => callback(data));
    }
  }
}

export default new AudioPlayerService();

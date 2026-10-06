import TrackPlayer, {
  Event,
  RepeatMode,
  State,
  Capability,
  AppKilledPlaybackBehavior,
} from "react-native-track-player";

// Playback service - handles remote control events from notification/lock screen
export default async function playbackService() {
  console.log('[PlaybackService] Background task started');

  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    console.warn('[PlaybackService] Remote Pause event received');
    await TrackPlayer.pause();
  });
  
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    console.warn('[PlaybackService] Remote Play event received');
    await TrackPlayer.play();
  });
  
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    console.log('[PlaybackService] Remote Next event received');
    await TrackPlayer.skipToNext();
  });
  
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    console.log('[PlaybackService] Remote Previous event received');
    await TrackPlayer.skipToPrevious();
  });
  
  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    console.log('[PlaybackService] Remote Stop event received');
    await TrackPlayer.pause();
    await TrackPlayer.reset();
  });
  
  TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
    console.log('[PlaybackService] Remote Seek event received:', event.position);
    await TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.PlaybackError, (error) => {
    console.error('[PlaybackService] Playback Error:', error);
  });

  TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
    console.log('[PlaybackService] State changed to:', event.state);
  });
};

export const setupPlayer = async () => {
  let isSetup = false;
  try {
    // Check if already initialized - getPlaybackState is safer than getActiveTrackIndex
    await TrackPlayer.getPlaybackState();
    isSetup = true;
    console.log('[PlaybackService] Player already setup');
  } catch {
    console.log('[PlaybackService] Setting up player for the first time');
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    });
    isSetup = true;
  }

  if (isSetup) {
    await TrackPlayer.updateOptions({
      android: {
        // Use ContinuePlayback to be more sticky on Android
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
        alwaysPauseOnInterruption: true,
        // Ensure notification is visible
        showProgress: true,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.Stop,
        Capability.SeekTo,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.Stop,
      ],
    });
    await TrackPlayer.setRepeatMode(RepeatMode.Queue);
  }

  return isSetup;
};

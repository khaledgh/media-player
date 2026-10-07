import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  IOSCategoryMode,
  RepeatMode,
} from 'react-native-track-player';

export const JUMP_SECONDS = 10;

/**
 * Runs in the background (Android headless task / iOS audio session) and
 * answers lock-screen, notification, headset and car controls.
 */
export default async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    await TrackPlayer.pause();
    await TrackPlayer.seekTo(0);
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext().catch(() => {}));
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    // Like most players: restart the song unless we are at its very beginning.
    const { position } = await TrackPlayer.getProgress();
    if (position > 3) await TrackPlayer.seekTo(0);
    else await TrackPlayer.skipToPrevious().catch(() => TrackPlayer.seekTo(0));
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => TrackPlayer.seekTo(e.position));
  TrackPlayer.addEventListener(Event.RemoteJumpForward, (e) => TrackPlayer.seekBy(e.interval ?? JUMP_SECONDS));
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, (e) => TrackPlayer.seekBy(-(e.interval ?? JUMP_SECONDS)));
  TrackPlayer.addEventListener(Event.RemoteDuck, async (e) => {
    if (e.permanent) await TrackPlayer.pause();
  });
  TrackPlayer.addEventListener(Event.RemoteLike, async () => {
    // Lazy import: the library DB lives in the app context and may not be open here.
    const { toggleLikeFromRemote } = await import('./PlayerService');
    await toggleLikeFromRemote();
  });
}

let ready: Promise<void> | null = null;

export function setupPlayer(): Promise<void> {
  ready ??= (async () => {
    try {
      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
        iosCategory: IOSCategory.Playback,
        iosCategoryMode: IOSCategoryMode.Default,
      });
    } catch (e) {
      // Already initialised (e.g. after a JS reload) is fine.
      if (!String(e).includes('already been initialized')) throw e;
    }
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
        alwaysPauseOnInterruption: true,
      },
      icon: require('../../assets/notification-icon.png'),
      color: 0xffff8216 | 0, // ARGB as a signed 32-bit int, as Android expects
      forwardJumpInterval: JUMP_SECONDS,
      backwardJumpInterval: JUMP_SECONDS,
      progressUpdateEventInterval: 1,
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.JumpForward,
        Capability.JumpBackward,
        Capability.Stop,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToPrevious,
        Capability.SkipToNext,
        Capability.JumpBackward,
        Capability.JumpForward,
        Capability.SeekTo,
      ],
      compactCapabilities: [Capability.SkipToPrevious, Capability.Play, Capability.Pause, Capability.SkipToNext],
    });
    await TrackPlayer.setRepeatMode(RepeatMode.Queue);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

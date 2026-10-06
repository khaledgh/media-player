import TrackPlayer from 'react-native-track-player';
import { registerRootComponent } from 'expo';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './App';
import playbackService from './src/services/PlaybackService';

// Must be registered before the app mounts so lock-screen / notification
// controls work even when the UI is not running.
TrackPlayer.registerPlaybackService(() => playbackService);

const Root = () => (
  <SafeAreaProvider>
    <App />
  </SafeAreaProvider>
);

registerRootComponent(Root);

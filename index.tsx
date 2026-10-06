import TrackPlayer from "react-native-track-player";
import playbackService from './src/services/PlaybackService';
import { registerRootComponent } from "expo";
import App from "./App";
import { SafeAreaProvider } from "react-native-safe-area-context";
import React from "react";

// Register playback service first
TrackPlayer.registerPlaybackService(() => playbackService);

const Root = () => (
  <SafeAreaProvider>
    <App />
  </SafeAreaProvider>
);

registerRootComponent(Root);

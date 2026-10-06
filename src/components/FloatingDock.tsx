import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MiniPlayer from './MiniPlayer';
import StatusBanner from './StatusBanner';

/** Mini player + status line for screens shown above the tab bar. */
export default function FloatingDock({ hidden }: { hidden?: boolean }) {
  const insets = useSafeAreaInsets();
  if (hidden) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 4 }}>
      <StatusBanner />
      <MiniPlayer />
    </View>
  );
}

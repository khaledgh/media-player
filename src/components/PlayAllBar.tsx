import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Play, Shuffle } from 'lucide-react-native';
import { Button } from './ui';
import { colors } from '../theme';
import type { Track } from '../data/library';

interface Props {
  tracks: Track[];
  /** Starts playback; wired to useActions().play by the screens. */
  onPlay: (tracks: Track[], index: number, opts: { shuffle?: boolean }) => void;
}

/** Play all / Shuffle all buttons shown above a flat song list. */
export default function PlayAllBar({ tracks, onPlay }: Props) {
  const empty = tracks.length === 0;
  return (
    <View style={styles.row}>
      <Button
        title="Play all"
        icon={<Play size={18} color="#fff" fill="#fff" />}
        disabled={empty}
        onPress={() => onPlay(tracks, 0, {})}
        style={{ flex: 1 }}
      />
      <Button
        title="Shuffle"
        variant="secondary"
        icon={<Shuffle size={18} color={colors.brand} />}
        disabled={empty}
        onPress={() => onPlay(tracks, Math.floor(Math.random() * tracks.length), { shuffle: true })}
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
});

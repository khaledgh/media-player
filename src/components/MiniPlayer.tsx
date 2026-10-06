import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useProgress } from 'react-native-track-player';
import { Pause, Play, SkipForward } from 'lucide-react-native';
import Artwork from './Artwork';
import { usePlayer } from '../services/PlayerService';
import Player from '../services/PlayerService';
import { displayArtist } from '../data/library';
import { colors, font } from '../theme';
import { navigate } from '../navigation/ref';

export default function MiniPlayer() {
  const current = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const { position, duration } = useProgress(500);
  if (!current) return null;
  const pct = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.wrap}>
      <Pressable style={styles.bar} onPress={() => navigate('Player')} accessibilityLabel={`Now playing ${current.title}. Open player`}>
        <Artwork seed={current.remote_id ?? current.id} coverFile={current.cover_file} size={42} radius={10} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {displayArtist(current)}
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => Player.toggle()} accessibilityLabel={isPlaying ? 'Pause' : 'Play'} style={styles.playBtn}>
          {isPlaying ? <Pause size={16} color="#fff" fill="#fff" /> : <Play size={16} color="#fff" fill="#fff" style={{ marginLeft: 2 }} />}
        </Pressable>
        <Pressable hitSlop={8} onPress={Player.next} accessibilityLabel="Next song" style={{ padding: 4 }}>
          <SkipForward size={20} color={colors.text} fill={colors.text} />
        </Pressable>
      </Pressable>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, paddingRight: 14 },
  title: { fontFamily: font.semibold, fontSize: 14, color: colors.text },
  artist: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  playBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  track: { height: 2, backgroundColor: colors.line },
  fill: { height: 2, backgroundColor: colors.brand },
});

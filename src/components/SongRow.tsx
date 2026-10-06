import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, CloudDownload, EllipsisVertical, Pause, Play } from 'lucide-react-native';
import Artwork from './Artwork';
import { colors, font, formatTime } from '../theme';
import { displayArtist } from '../data/library';
import type { Track } from '../data/library';

interface Props {
  track: Track;
  isCurrent?: boolean;
  isPlaying?: boolean;
  selected?: boolean;
  selecting?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onMore?: () => void;
  onPlay?: () => void;
  leading?: React.ReactNode;
}

function SongRow({ track, isCurrent, isPlaying, selected, selecting, onPress, onLongPress, onMore, onPlay, leading }: Props) {
  const offline = track.download_state !== 'done';
  const downloading = track.download_state === 'downloading';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${displayArtist(track)}`}
      style={({ pressed }) => [styles.row, (pressed || selected) && { backgroundColor: colors.surface }]}
    >
      {leading}
      {selecting && (
        <View style={[styles.check, selected && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
          {selected && <Check size={14} color="#fff" strokeWidth={3} />}
        </View>
      )}
      <Artwork seed={track.remote_id ?? track.id} coverFile={track.cover_file} size={52} radius={14} />
      <View style={styles.text}>
        <Text style={[styles.title, isCurrent && { color: colors.brand }]} numberOfLines={1}>
          {track.title}
        </Text>
        <View style={styles.metaRow}>
          {offline && (
            <CloudDownload size={12} color={downloading ? colors.brand : colors.faint} style={{ marginRight: 4 }} />
          )}
          <Text style={styles.meta} numberOfLines={1}>
            {displayArtist(track)}
            {track.duration_ms ? `  |  ${formatTime(track.duration_ms / 1000)} mins` : ''}
          </Text>
        </View>
      </View>
      {!selecting && (
        <>
          <Pressable
            onPress={onPlay ?? onPress}
            hitSlop={6}
            accessibilityLabel={isCurrent && isPlaying ? 'Pause' : 'Play'}
            style={({ pressed }) => [styles.play, pressed && { transform: [{ scale: 0.92 }] }]}
          >
            {isCurrent && isPlaying ? <Pause size={14} color="#fff" fill="#fff" /> : <Play size={14} color="#fff" fill="#fff" style={{ marginLeft: 2 }} />}
          </Pressable>
          {onMore && (
            <Pressable onPress={onMore} hitSlop={10} accessibilityLabel="More options" style={styles.more}>
              <EllipsisVertical size={20} color={colors.muted} />
            </Pressable>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 9, gap: 14 },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.semibold, fontSize: 15, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  meta: { fontFamily: font.regular, fontSize: 12, color: colors.muted, flexShrink: 1 },
  play: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  more: { paddingLeft: 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default memo(SongRow);

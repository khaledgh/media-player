import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, CloudDownload, EllipsisVertical, Pause, Play } from 'lucide-react-native';
import Artwork from './Artwork';
import { useOverlays } from './Overlays';
import { useDownloadStatus } from '../services/DownloadManager';
import { downloadToFolder } from '../hooks/downloadToFolder';
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
  const { toast, pickFolder } = useOverlays();
  const offline = track.download_state !== 'done';
  const downloading = track.download_state === 'downloading';
  const canDownload = offline && !!track.remote_id; // songs only on this phone have nothing to download
  const progress = useDownloadStatus((s) => s.active.find((a) => a.trackId === track.id)?.progress);

  const download = () => downloadToFolder(track, { pickFolder, toast });

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
          {canDownload && (
            <Pressable
              onPress={download}
              disabled={downloading}
              hitSlop={8}
              accessibilityLabel={downloading ? 'Downloading' : 'Download for offline'}
              style={styles.more}
            >
              {downloading ? (
                <View style={styles.spinner}>
                  <ActivityIndicator size="small" color={colors.brand} />
                  {progress !== undefined && progress > 0 && <Text style={styles.pct}>{Math.round(progress * 100)}</Text>}
                </View>
              ) : (
                <CloudDownload size={22} color={track.download_state === 'error' ? colors.danger : colors.muted} />
              )}
            </Pressable>
          )}
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
  spinner: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pct: { position: 'absolute', fontFamily: font.semibold, fontSize: 7, color: colors.text },
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

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useProgress, usePlaybackState, useActiveTrack, State } from 'react-native-track-player';
import { Play, Pause, SkipForward, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AudioPlayerService from '../services/AudioPlayerService';
import { usePlaylistStore } from '../store/PlaylistStore';
import { getTrackGradient } from '../utils/trackColors';
import * as Haptics from 'expo-haptics';

const MiniPlayer = ({ onShowPlayer, insetsBottom }: { onShowPlayer: () => void, insetsBottom: number }) => {
  const { position, duration } = useProgress();
  const playbackState = usePlaybackState();
  const activeTrack = useActiveTrack();
  const { setCurrentTrack, setIsPlaying } = usePlaylistStore();

  if (!activeTrack) return null;

  const isPlaying = playbackState.state === State.Playing;
  const progress = duration > 0 ? position / duration : 0;
  const [c1, c2] = getTrackGradient(activeTrack.id ?? activeTrack.title ?? 'default');
  const initials = String(activeTrack.title ?? '').slice(0, 2).toUpperCase();

  const togglePlay = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPlaying) await AudioPlayerService.pause();
    else await AudioPlayerService.play();
  };

  const handleStop = async () => {
    await AudioPlayerService.stop();
    setCurrentTrack(null);
    setIsPlaying(false);
  };

  return (
    <View style={[styles.container, { bottom: insetsBottom + 12 }]}>
      {/* Progress bar — top edge */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: c1 }]} />
      </View>

      <TouchableOpacity onPress={onShowPlayer} style={styles.content} activeOpacity={0.9}>
        {/* Gradient Art */}
        <LinearGradient colors={[c1, c2]} style={styles.art}>
          <Text style={styles.artText}>{initials}</Text>
        </LinearGradient>

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{activeTrack.title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{activeTrack.artist || 'My Library'}</Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity onPress={togglePlay} style={styles.btn}>
            {isPlaying
              ? <Pause color="#fff" size={22} fill="#fff" />
              : <Play color="#fff" size={22} fill="#fff" />
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await AudioPlayerService.skipToNext();
            }}
            style={styles.btn}
          >
            <SkipForward color="#a78bfa" size={22} />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleStop} style={styles.btn}>
            <X color="#ef4444" size={20} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(20, 20, 40, 0.95)',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  progressTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  art: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  artText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  info: {
    marginLeft: 12,
    flex: 1,
  },
  title: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  subtitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MiniPlayer;

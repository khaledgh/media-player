import React, { useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Dimensions, StyleSheet,
  FlatList, Animated as RNAnimated,
} from 'react-native';
import { useProgress, usePlaybackState, useActiveTrack, State } from 'react-native-track-player';
import AudioPlayerService from '../services/AudioPlayerService';
import {
  Play, Pause, SkipBack, SkipForward, ChevronDown, Share2,
  Shuffle, Repeat, Repeat1, ListMusic, X,
} from 'lucide-react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, withDelay, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { usePlaylistStore } from '../store/PlaylistStore';
import { getTrackGradient } from '../utils/trackColors';
import * as Haptics from 'expo-haptics';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');
const NUM_BARS = 14;

// ── Animated Equalizer Bar ─────────────────────────────────────────────────
const EqBar = ({ isPlaying, index }: { isPlaying: boolean; index: number }) => {
  const h = useSharedValue(6);
  const minH = 6 + (index % 3) * 4;
  const maxH = 22 + (index % 5) * 10;
  const dur = 300 + (index * 47) % 400;

  useEffect(() => {
    if (isPlaying) {
      h.value = withRepeat(
        withSequence(
          withDelay(index * 40, withTiming(maxH, { duration: dur, easing: Easing.inOut(Easing.sin) })),
          withTiming(minH, { duration: dur, easing: Easing.inOut(Easing.sin) }),
        ),
        -1, true
      );
    } else {
      cancelAnimation(h);
      h.value = withTiming(minH, { duration: 200 });
    }
  }, [isPlaying]);

  const barStyle = useAnimatedStyle(() => ({
    height: h.value,
    opacity: isPlaying ? 0.85 : 0.2,
  }));

  return (
    <Animated.View
      style={[
        {
          width: 4, borderRadius: 2,
          backgroundColor: index % 4 === 0 ? '#a78bfa' : index % 4 === 1 ? '#7c3aed' : 'rgba(255,255,255,0.3)',
        },
        barStyle,
      ]}
    />
  );
};

// ── Album Art (gradient) ───────────────────────────────────────────────────
const AlbumArt = ({ trackId, size, animStyle }: { trackId: string | number; size: number; animStyle: any }) => {
  const [c1, c2] = getTrackGradient(trackId);
  return (
    <Animated.View style={[{ width: size, height: size }, animStyle]}>
      <LinearGradient
        colors={[c1, c2]}
        style={{ width: size, height: size, borderRadius: size * 0.2, alignItems: 'center', justifyContent: 'center' }}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      >
        <View style={[st.artInner, { borderRadius: size * 0.12, width: size * 0.42, height: size * 0.42 }]}>
          <Text style={{ fontSize: size * 0.2, color: 'rgba(255,255,255,0.9)', fontWeight: '900' }}>
            {String(trackId).slice(0, 2).toUpperCase()}
          </Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
};

// ── Main Player ─────────────────────────────────────────────────────────────
const Player = ({ onClose }: { onClose: () => void }) => {
    const { position, duration } = useProgress();
    const playbackState = usePlaybackState();
    const activeTrack = useActiveTrack();
    const insets = useSafeAreaInsets();
    const { isShuffled, repeatMode, currentPlaylist, toggleShuffle, cycleRepeatMode, addToRecentlyPlayed } = usePlaylistStore();
    const isPlaying = playbackState.state === State.Playing;

    // Queue panel
    const queueAnim = useRef(new RNAnimated.Value(0)).current;
    const [showQueue, setShowQueue] = React.useState(false);

    const openQueue = () => {
      setShowQueue(true);
      RNAnimated.spring(queueAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }).start();
    };
    const closeQueue = () => {
      RNAnimated.timing(queueAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setShowQueue(false));
    };

    const rotation = useSharedValue(0);
    const pulseScale = useSharedValue(1);

    useEffect(() => {
      if (isPlaying) {
        rotation.value = withRepeat(withTiming(360, { duration: 15000, easing: Easing.linear }), -1, false);
        pulseScale.value = withRepeat(withTiming(1.04, { duration: 2200, easing: Easing.bezier(0.4, 0, 0.2, 1) }), -1, true);
      } else {
        cancelAnimation(rotation);
        cancelAnimation(pulseScale);
        pulseScale.value = withTiming(1, { duration: 300 });
      }
    }, [isPlaying]);

    // Record recently played on track change
    useEffect(() => {
      if (activeTrack) {
        const match = currentPlaylist.find(t => String(t.id) === String(activeTrack.id));
        if (match) addToRecentlyPlayed(match);
      }
    }, [activeTrack?.id]);

    const discStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: `${rotation.value}deg` }, { scale: pulseScale.value }],
    }));

    const formatTime = (s: number) => {
      const m = Math.floor(s / 60);
      return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
    };

    const hapticPress = async (fn: () => void | Promise<void>) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fn();
    };

    if (!activeTrack) return null;

    const [artC1] = getTrackGradient(activeTrack.id ?? activeTrack.title ?? 'default');
    const queueTranslate = queueAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0] });
    const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
    const repeatColor = repeatMode === 'off' ? '#334155' : '#a78bfa';

    return (
      <View style={st.container}>
        <LinearGradient colors={[artC1 + '55', '#050510', '#000']} style={StyleSheet.absoluteFill} />

        <View style={[st.safeArea, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
          {/* Top Bar */}
          <View style={st.topBar}>
            <TouchableOpacity onPress={onClose} style={st.topBtn}>
              <ChevronDown color="#fff" size={24} />
            </TouchableOpacity>
            <View style={st.topCenter}>
              <Text style={st.playingFrom}>NOW PLAYING</Text>
              <Text style={st.nowPlaying} numberOfLines={1}>{activeTrack.title}</Text>
            </View>
            <TouchableOpacity style={st.topBtn}>
              <Share2 color="#fff" size={20} />
            </TouchableOpacity>
          </View>

          <View style={st.content}>
            {/* Album Art */}
            <View style={st.artArea}>
              <AlbumArt
                trackId={activeTrack.id ?? activeTrack.title ?? 'default'}
                size={width * 0.72}
                animStyle={discStyle}
              />
            </View>

            {/* Track Info */}
            <View style={st.infoRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.trackTitle} numberOfLines={1}>{activeTrack.title}</Text>
                <Text style={st.trackArtist} numberOfLines={1}>{activeTrack.artist || 'My Library'}</Text>
              </View>
            </View>

            {/* Animated Equalizer */}
            <View style={st.eqRow}>
              {Array.from({ length: NUM_BARS }).map((_, i) => (
                <EqBar key={i} isPlaying={isPlaying} index={i} />
              ))}
            </View>

            {/* Progress */}
            <View style={st.progressArea}>
              <Slider
                style={st.slider}
                minimumValue={0}
                maximumValue={duration || 1}
                value={position}
                onSlidingComplete={val => AudioPlayerService.seekTo(val)}
                minimumTrackTintColor="#a78bfa"
                maximumTrackTintColor="rgba(255,255,255,0.1)"
                thumbTintColor="#fff"
              />
              <View style={st.timeLabels}>
                <Text style={st.timeText}>{formatTime(position)}</Text>
                <Text style={st.timeText}>{formatTime(duration)}</Text>
              </View>
            </View>

            {/* Controls */}
            <View style={st.controls}>
              <TouchableOpacity onPress={() => hapticPress(toggleShuffle)} style={st.sideBtn}>
                <Shuffle color={isShuffled ? '#a78bfa' : '#334155'} size={22} />
              </TouchableOpacity>

              <View style={st.mainControls}>
                <TouchableOpacity onPress={() => hapticPress(() => AudioPlayerService.skipToPrevious())} style={st.skipBtn}>
                  <SkipBack color="#fff" size={28} fill="#fff" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => hapticPress(() => isPlaying ? AudioPlayerService.pause() : AudioPlayerService.play())}
                  style={st.playBtn}
                >
                  {isPlaying
                    ? <Pause color="#000" size={32} fill="#000" />
                    : <Play color="#000" size={32} fill="#000" style={{ marginLeft: 4 }} />
                  }
                </TouchableOpacity>

                <TouchableOpacity onPress={() => hapticPress(() => AudioPlayerService.skipToNext())} style={st.skipBtn}>
                  <SkipForward color="#fff" size={28} fill="#fff" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={() => hapticPress(cycleRepeatMode)} style={st.sideBtn}>
                <RepeatIcon color={repeatColor} size={22} />
              </TouchableOpacity>
            </View>

            {/* Queue toggle */}
            <TouchableOpacity style={st.queueToggle} onPress={openQueue} activeOpacity={0.7}>
              <ListMusic color="#64748b" size={18} style={{ marginRight: 8 }} />
              <Text style={st.queueToggleTxt}>Up Next ({currentPlaylist.filter(t => !t.missing).length} tracks)</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Queue Panel */}
        {showQueue && (
          <RNAnimated.View style={[st.queuePanel, { transform: [{ translateY: queueTranslate }] }]}>
            <View style={st.queueHandle} />
            <View style={st.queueHeader}>
              <Text style={st.queueTitle}>Up Next</Text>
              <TouchableOpacity onPress={closeQueue} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X color="#94a3b8" size={20} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={currentPlaylist.filter(t => !t.missing)}
              keyExtractor={item => String(item.id)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
              renderItem={({ item }) => {
                const isActive = String(item.id) === String(activeTrack?.id);
                const [c1, c2] = getTrackGradient(item.id);
                return (
                  <View style={[st.queueItem, isActive && st.queueItemActive]}>
                    <LinearGradient colors={[c1, c2]} style={st.queueArt}>
                      <Text style={st.queueArtTxt}>{item.name.slice(0, 2).toUpperCase()}</Text>
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.queueName, isActive && { color: '#a78bfa' }]} numberOfLines={1}>{item.name}</Text>
                      <Text style={st.queueArtist} numberOfLines={1}>My Library</Text>
                    </View>
                    {isActive && <View style={st.activeDot} />}
                  </View>
                );
              }}
            />
          </RNAnimated.View>
        )}
      </View>
    );
};

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  safeArea: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, height: 72,
  },
  topBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  topCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 10 },
  playingFrom: { color: '#64748b', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  nowPlaying: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 },
  content: { flex: 1, justifyContent: 'space-evenly', paddingHorizontal: 28, paddingBottom: 12 },
  artArea: { alignItems: 'center' },
  artInner: {
    position: 'absolute', backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  trackTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 },
  trackArtist: { color: '#a78bfa', fontSize: 15, fontWeight: '600', opacity: 0.85 },
  eqRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, gap: 5,
  },
  progressArea: { marginTop: 4 },
  slider: { width: '100%', height: 36 },
  timeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4, paddingHorizontal: 4 },
  timeText: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6,
  },
  sideBtn: { padding: 12 },
  mainControls: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  skipBtn: { padding: 10 },
  playBtn: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#fff', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 12,
  },
  queueToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  queueToggleTxt: { color: '#475569', fontSize: 13, fontWeight: '600' },
  queuePanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: SCREEN_HEIGHT * 0.62,
    backgroundColor: '#0f0f1e',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  queueHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginTop: 12,
  },
  queueHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  queueTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  queueItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10, gap: 12,
  },
  queueItemActive: { backgroundColor: 'rgba(124,58,237,0.12)' },
  queueArt: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  queueArtTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  queueName: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  queueArtist: { color: '#475569', fontSize: 12, marginTop: 2 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#a78bfa' },
});

export default Player;

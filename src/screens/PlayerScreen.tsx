import React, { useEffect, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import TrackPlayer, { useProgress } from 'react-native-track-player';
import type { Track as RNTrack } from 'react-native-track-player';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronDown,
  EllipsisVertical,
  Gauge,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  Timer,
  X,
} from 'lucide-react-native';
import Artwork from '../components/Artwork';
import { IconButton, haptic } from '../components/ui';
import { Sheet } from '../components/Overlays';
import { useActions } from '../hooks/useActions';
import Player, { usePlayer } from '../services/PlayerService';
import { displayArtist } from '../data/library';
import { artGradient, colors, font, formatTime, type } from '../theme';

const { width } = Dimensions.get('window');
const ART = Math.min(width - 56, 360);
const RATES = [0.75, 1, 1.25, 1.5, 2];
const SLEEP = [0, 15, 30, 45, 60];

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const a = useActions();
  const { current, isPlaying, isFavorite, shuffle, repeat, rate, sleepAt, queueTitle } = usePlayer();
  const { position, duration } = useProgress(250);
  const [seeking, setSeeking] = useState<number | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  // Gentle "breathing" of the artwork while playing.
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withSpring(isPlaying ? 1 : 0.92, { damping: 14 });
  }, [isPlaying, scale]);
  const artStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    if (!current) nav.goBack();
  }, [current, nav]);
  if (!current) return null;

  const [g1] = artGradient(current.remote_id ?? current.id);
  const shown = seeking ?? position;
  const total = duration || current.duration_ms / 1000;

  async function chooseSleep() {
    const v = await a.choose({
      title: 'Sleep timer',
      options: SLEEP.map((m) => ({ value: String(m), label: m ? `${m} minutes` : 'Off' })),
      selected: sleepAt ? undefined : '0',
    });
    if (v !== null) {
      Player.setSleepTimer(Number(v));
      a.toast(Number(v) ? `Music stops in ${v} minutes` : 'Sleep timer off');
    }
  }

  async function chooseRate() {
    const v = await a.choose({ title: 'Playback speed', options: RATES.map((r) => ({ value: String(r), label: `${r}×` })), selected: String(rate) });
    if (v) Player.setRate(Number(v));
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={[`${g1.replace('hsl', 'hsla').replace(')', ', 0.35)')}`, colors.bg]} style={StyleSheet.absoluteFill} locations={[0, 0.6]} />
      <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
        <IconButton label="Close player" onPress={() => nav.goBack()}>
          <ChevronDown size={28} color={colors.text} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={type.tiny}>PLAYING FROM</Text>
          <Text style={[type.bodyMedium, { fontSize: 13 }]} numberOfLines={1}>
            {queueTitle || 'Your library'}
          </Text>
        </View>
        <IconButton label="Song options" onPress={() => a.songMenu(current)}>
          <EllipsisVertical size={22} color={colors.text} />
        </IconButton>
      </View>

      <View style={styles.center}>
        <Animated.View entering={FadeIn.duration(300)} style={[styles.artShadow, artStyle]}>
          <Artwork seed={current.remote_id ?? current.id} coverFile={current.cover_file} size={ART} radius={32} />
        </Animated.View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {current.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {displayArtist(current)}
            </Text>
          </View>
          <IconButton label={isFavorite ? 'Remove from favorites' : 'Add to favorites'} onPress={() => (haptic(), Player.toggleFavoriteCurrent())}>
            <Heart size={26} color={isFavorite ? colors.brand : colors.text} fill={isFavorite ? colors.brand : 'transparent'} />
          </IconButton>
        </View>

        <Slider
          style={{ marginHorizontal: -12, height: 36 }}
          minimumValue={0}
          maximumValue={Math.max(total, 1)}
          value={shown}
          minimumTrackTintColor={colors.brand}
          maximumTrackTintColor={colors.line}
          thumbTintColor={colors.brand}
          onValueChange={setSeeking}
          onSlidingComplete={async (v) => {
            await Player.seekTo(v);
            setSeeking(null);
          }}
          accessibilityLabel="Seek"
        />
        <View style={styles.times}>
          <Text style={type.tiny}>{formatTime(shown)}</Text>
          <Text style={type.tiny}>{formatTime(total)}</Text>
        </View>

        <View style={styles.controls}>
          <IconButton label="Previous" onPress={() => Player.previous()} size={48}>
            <SkipBack size={26} color={colors.text} fill={colors.text} />
          </IconButton>
          <IconButton label="Back 10 seconds" onPress={() => Player.jump(-1)} size={48}>
            <RotateCcw size={24} color={colors.text} />
            <Text style={styles.jumpText}>10</Text>
          </IconButton>
          <Pressable onPress={() => (haptic(), Player.toggle())} accessibilityLabel={isPlaying ? 'Pause' : 'Play'} style={({ pressed }) => [styles.playBtn, pressed && { transform: [{ scale: 0.94 }] }]}>
            {isPlaying ? <Pause size={30} color="#fff" fill="#fff" /> : <Play size={30} color="#fff" fill="#fff" style={{ marginLeft: 4 }} />}
          </Pressable>
          <IconButton label="Forward 10 seconds" onPress={() => Player.jump(1)} size={48}>
            <RotateCw size={24} color={colors.text} />
            <Text style={styles.jumpText}>10</Text>
          </IconButton>
          <IconButton label="Next" onPress={Player.next} size={48}>
            <SkipForward size={26} color={colors.text} fill={colors.text} />
          </IconButton>
        </View>

        <View style={styles.extras}>
          <Extra label={rate === 1 ? 'Speed' : `${rate}×`} active={rate !== 1} onPress={chooseRate} icon={<Gauge size={20} color={rate !== 1 ? colors.brand : colors.muted} />} />
          <Extra
            label={sleepAt ? formatTime(Math.max(0, (sleepAt - Date.now()) / 1000)).slice(0, 5) : 'Timer'}
            active={!!sleepAt}
            onPress={chooseSleep}
            icon={<Timer size={20} color={sleepAt ? colors.brand : colors.muted} />}
          />
          <Extra label="Shuffle" active={shuffle} onPress={() => Player.toggleShuffle()} icon={<Shuffle size={20} color={shuffle ? colors.brand : colors.muted} />} />
          <Extra
            label={repeat === 'one' ? 'Repeat 1' : 'Repeat'}
            active={repeat !== 'off'}
            onPress={() => Player.cycleRepeat()}
            icon={repeat === 'one' ? <Repeat1 size={20} color={colors.brand} /> : <Repeat size={20} color={repeat === 'all' ? colors.brand : colors.muted} />}
          />
          <Extra label="Queue" onPress={() => setQueueOpen(true)} icon={<ListMusic size={20} color={colors.muted} />} />
        </View>
      </View>

      <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
    </View>
  );
}

function Extra({ icon, label, onPress, active }: { icon: React.ReactNode; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.extra} accessibilityLabel={label} hitSlop={4}>
      {icon}
      <Text style={[styles.extraText, active && { color: colors.brand }]}>{label}</Text>
    </Pressable>
  );
}

function QueueSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [queue, setQueue] = useState<RNTrack[]>([]);
  const [active, setActive] = useState<number | undefined>();
  const current = usePlayer((s) => s.current?.id);

  const load = async () => {
    setQueue(await TrackPlayer.getQueue());
    setActive(await TrackPlayer.getActiveTrackIndex());
  };
  useEffect(() => {
    if (visible) load();
  }, [visible, current]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[type.h2, { paddingHorizontal: 24, marginBottom: 8 }]}>Up next</Text>
      <FlatList
        style={{ maxHeight: 460 }}
        data={queue}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        initialScrollIndex={active && active > 2 ? active - 2 : 0}
        getItemLayout={(_, i) => ({ length: 60, offset: 60 * i, index: i })}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => Player.skipToQueueIndex(index).then(load)} style={[styles.qRow, index === active && { backgroundColor: colors.surface2 }]}>
            <Text style={[type.caption, { width: 22, textAlign: 'right' }]}>{index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, index === active && { color: colors.brand }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={type.caption} numberOfLines={1}>
                {item.artist}
              </Text>
            </View>
            {index !== active && (
              <Pressable hitSlop={10} onPress={() => Player.removeFromQueue(index).then(load)} accessibilityLabel={`Remove ${item.title} from queue`}>
                <X size={18} color={colors.muted} />
              </Pressable>
            )}
          </Pressable>
        )}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artShadow: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 16, borderRadius: 32 },
  bottom: { paddingHorizontal: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  title: { fontFamily: font.semibold, fontSize: 22, color: colors.text },
  artist: { fontFamily: font.regular, fontSize: 14, color: colors.muted, marginTop: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  jumpText: { position: 'absolute', fontFamily: font.semibold, fontSize: 8, color: colors.text, top: 19 },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brand,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  extras: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26 },
  extra: { alignItems: 'center', gap: 4, minWidth: 52 },
  extraText: { fontFamily: font.medium, fontSize: 10, color: colors.muted },
  qRow: { height: 60, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24 },
});

import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Play, Shuffle } from 'lucide-react-native';
import Header from '../components/Header';
import Artwork from '../components/Artwork';
import SongRow from '../components/SongRow';
import FloatingDock from '../components/FloatingDock';
import { Button, SectionHeader } from '../components/ui';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { useLibrary } from '../hooks/useLibrary';
import { useActions } from '../hooks/useActions';
import { usePlayer } from '../services/PlayerService';
import Player from '../services/PlayerService';
import { getTracksBy } from '../data/library';
import type { RootStackParams } from '../navigation/ref';
import { colors, formatTime, type } from '../theme';

/** Artist or album page. */
export default function Collection() {
  const refreshControl = usePullRefresh();
  const { kind, name } = useRoute<RouteProp<RootStackParams, 'Collection'>>().params;
  const tracks = useLibrary(() => getTracksBy(kind, name), [kind, name]);
  const a = useActions();
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const list = tracks.data ?? [];
  const ms = list.reduce((s, t) => s + t.duration_ms, 0);
  const albums = new Set(list.map((t) => t.album).filter(Boolean)).size;
  const cover = list.find((t) => t.cover_file);

  return (
    <View style={styles.root}>
      <Header back />
      <FlatList
        refreshControl={refreshControl}
        data={list}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingBottom: 170 }}
        ListHeaderComponent={
          <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.hero}>
            <Artwork seed={name} coverFile={cover?.cover_file} size={kind === 'artist' ? 180 : 200} kind={kind === 'artist' && !cover ? 'artist' : 'track'} radius={32} />
            <Text style={[type.h1, { textAlign: 'center', marginTop: 12 }]} numberOfLines={2}>
              {name}
            </Text>
            <Text style={type.caption}>
              {kind === 'artist' ? `${albums} Album${albums === 1 ? '' : 's'}  |  ` : ''}
              {list.length} Songs{ms ? `  |  ${formatTime(ms / 1000)} mins` : ''}
            </Text>
            <View style={styles.buttons}>
              <Button title="Shuffle" icon={<Shuffle size={18} color="#fff" />} style={{ flex: 1 }} disabled={!list.length} onPress={() => a.play(list, Math.floor(Math.random() * list.length), { shuffle: true, title: name })} />
              <Button title="Play" variant="secondary" icon={<Play size={18} color={colors.brand} fill={colors.brand} />} style={{ flex: 1 }} disabled={!list.length} onPress={() => a.play(list, 0, { title: name })} />
            </View>
            <SectionHeader title="Songs" style={{ alignSelf: 'stretch', marginTop: 24, marginBottom: 0 }} />
          </Animated.View>
        }
        renderItem={({ item, index }) => (
          <SongRow
            track={item}
            isCurrent={item.id === current}
            isPlaying={isPlaying}
            onPress={() => (item.id === current ? Player.toggle() : a.play(list, index, { title: name }))}
            onMore={() => a.songMenu(item)}
          />
        )}
      />
      <FloatingDock />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, gap: 4 },
  buttons: { flexDirection: 'row', gap: 14, alignSelf: 'stretch', marginTop: 18 },
});

import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { History } from 'lucide-react-native';
import Header from '../components/Header';
import SongRow from '../components/SongRow';
import FloatingDock from '../components/FloatingDock';
import { Empty } from '../components/ui';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { useLibrary } from '../hooks/useLibrary';
import { useActions } from '../hooks/useActions';
import { usePlayer } from '../services/PlayerService';
import Player from '../services/PlayerService';
import { getMostPlayed, getRecentlyPlayed } from '../data/library';
import type { RootStackParams } from '../navigation/ref';
import { colors } from '../theme';

/** "See All" lists: Recently Played and Most Played. */
export default function SongList() {
  const refreshControl = usePullRefresh();
  const { title, source } = useRoute<RouteProp<RootStackParams, 'Songs'>>().params;
  const tracks = useLibrary(() => (source === 'recent' ? getRecentlyPlayed(100) : getMostPlayed(100)), [source]);
  const a = useActions();
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const list = tracks.data ?? [];
  return (
    <View style={styles.root}>
      <Header back title={title} />
      <FlatList
        refreshControl={refreshControl}
        data={list}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingBottom: 170, paddingTop: 8 }}
        ListEmptyComponent={tracks.loading ? null : <Empty icon={<History size={28} color={colors.brand} />} title="Nothing played yet" />}
        renderItem={({ item, index }) => (
          <SongRow
            track={item}
            isCurrent={item.id === current}
            isPlaying={isPlaying}
            onPress={() => (item.id === current ? Player.toggle() : a.play(list, index, { title }))}
            onMore={() => a.songMenu(item)}
          />
        )}
      />
      <FloatingDock />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg } });

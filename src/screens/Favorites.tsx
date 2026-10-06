import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import Header from '../components/Header';
import SongRow from '../components/SongRow';
import { Empty } from '../components/ui';
import { useLibrary } from '../hooks/useLibrary';
import { useActions } from '../hooks/useActions';
import { usePlayer } from '../services/PlayerService';
import Player from '../services/PlayerService';
import { getFavorites } from '../data/library';
import { colors } from '../theme';
import { BOTTOM_SPACE, CountHeader } from './Home';

export default function Favorites() {
  const favs = useLibrary(() => getFavorites(), []);
  const a = useActions();
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const list = favs.data ?? [];
  return (
    <View style={styles.root}>
      <Header />
      <FlatList
        data={list}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingBottom: BOTTOM_SPACE }}
        ListHeaderComponent={list.length ? <CountHeader count={list.length} noun="favorites" /> : null}
        ListEmptyComponent={
          favs.loading ? null : (
            <Empty icon={<Heart size={28} color={colors.brand} />} title="No favorites yet" body="Tap the heart on any song — or on the lock screen — to keep it here." />
          )
        }
        renderItem={({ item, index }) => (
          <SongRow
            track={item}
            isCurrent={item.id === current}
            isPlaying={isPlaying}
            onPress={() => (item.id === current ? Player.toggle() : a.play(list, index, { title: 'Favorites' }))}
            onMore={() => a.songMenu(item)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg } });

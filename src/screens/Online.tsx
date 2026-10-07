import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Cloud, Search } from 'lucide-react-native';
import Header from '../components/Header';
import SongRow from '../components/SongRow';
import { Empty } from '../components/ui';
import { useLibrary } from '../hooks/useLibrary';
import { useActions } from '../hooks/useActions';
import { usePullRefresh } from '../hooks/usePullRefresh';
import Player, { usePlayer } from '../services/PlayerService';
import { useSyncStatus } from '../services/SyncService';
import { getOnlineTracks } from '../data/library';
import { colors, font, radius, type } from '../theme';
import { BOTTOM_SPACE } from './Home';

/** Online library: every song on the server. Tap the cloud on a song to save it to one of your folders. */
export default function Online() {
  const [q, setQ] = useState('');
  const tracks = useLibrary(() => getOnlineTracks(q), [q]);
  const a = useActions();
  const refreshControl = usePullRefresh();
  const syncing = useSyncStatus((s) => s.syncing);
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const list = tracks.data ?? [];

  return (
    <View style={styles.root}>
      <Header title="Online" />
      <View style={styles.search}>
        <Search size={18} color={colors.faint} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search the online library"
          placeholderTextColor={colors.faint}
          style={styles.input}
          selectionColor={colors.brand}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <FlatList
        refreshControl={refreshControl}
        data={list}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingBottom: BOTTOM_SPACE }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          list.length ? (
            <Text style={[type.caption, styles.hint]}>
              {list.length} songs online · tap <Text style={{ color: colors.brand }}>the cloud</Text> to save one to a folder · pull down to refresh
            </Text>
          ) : null
        }
        ListEmptyComponent={
          tracks.loading ? null : (
            <Empty
              icon={<Cloud size={28} color={colors.brand} />}
              title={q ? 'No matches' : syncing ? 'Loading the online library…' : 'Nothing online yet'}
              body={q ? undefined : 'Pull down to refresh and check the server for new songs.'}
            />
          )
        }
        renderItem={({ item, index }) => (
          <SongRow
            track={item}
            isCurrent={item.id === current}
            isPlaying={isPlaying}
            onPress={() => (item.id === current ? Player.toggle() : a.play(list.slice(index, index + 50), 0, { title: 'Online library' }))}
            onMore={() => a.songMenu(item)}
          />
        )}
        initialNumToRender={14}
        windowSize={9}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 6,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontFamily: font.regular, fontSize: 14, color: colors.text, padding: 0 },
  hint: { paddingHorizontal: 20, paddingVertical: 8 },
});

import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FolderHeart, Heart, Pencil, Plus, Trash2 } from 'lucide-react-native';
import Header from '../components/Header';
import SongRow from '../components/SongRow';
import PlayAllBar from '../components/PlayAllBar';
import { Empty } from '../components/ui';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { useLibrary } from '../hooks/useLibrary';
import { useActions } from '../hooks/useActions';
import { usePlayer } from '../services/PlayerService';
import Player from '../services/PlayerService';
import { createFavFolder, deleteFavFolder, getFavFolders, getFavorites, renameFavFolder } from '../data/library';
import type { FavFolder } from '../data/library';
import { colors, font, radius } from '../theme';
import { BOTTOM_SPACE, CountHeader } from './Home';

export default function Favorites() {
  const refreshControl = usePullRefresh();
  const [folderId, setFolderId] = useState<number | undefined>(undefined); // undefined = all favorites
  const folders = useLibrary(() => getFavFolders(), []);
  const favs = useLibrary(() => getFavorites(folderId), [folderId]);
  const a = useActions();
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const list = favs.data ?? [];
  const folderList = folders.data ?? [];
  const selected = folderList.find((f) => f.id === folderId);
  // A folder that was deleted (here or on another device) falls back to "All".
  if (folderId !== undefined && folders.data && !selected) setFolderId(undefined);

  async function newFolder() {
    const name = await a.prompt({ title: 'New favorites folder', placeholder: 'e.g. Road trip, Gym, Sleep', confirm: 'Create' });
    if (!name) return;
    try {
      setFolderId(await createFavFolder(name));
    } catch (e) {
      a.toast(e instanceof Error ? e.message : String(e));
    }
  }

  function folderMenu(f: FavFolder) {
    a.actions({
      title: f.name,
      subtitle: `${f.count} song${f.count === 1 ? '' : 's'}`,
      items: [
        {
          label: 'Rename',
          icon: <Pencil size={20} color={colors.text} />,
          onPress: async () => {
            const name = await a.prompt({ title: 'Rename folder', initial: f.name });
            if (name) await renameFavFolder(f.id, name);
          },
        },
        {
          label: 'Delete folder',
          danger: true,
          icon: <Trash2 size={20} color={colors.danger} />,
          onPress: async () => {
            if (await a.confirm({ title: `Delete "${f.name}"?`, message: 'Its songs stay in your favorites.', confirm: 'Delete', danger: true })) {
              await deleteFavFolder(f.id);
            }
          },
        },
      ],
    });
  }

  return (
    <View style={styles.root}>
      <Header />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" active={folderId === undefined} onPress={() => setFolderId(undefined)} />
          {folderList.map((f) => (
            <Chip key={f.id} label={`${f.name} · ${f.count}`} active={f.id === folderId} onPress={() => setFolderId(f.id)} onLongPress={() => folderMenu(f)} />
          ))}
          <Pressable onPress={newFolder} style={[styles.chip, styles.chipAdd]} accessibilityLabel="New favorites folder">
            <Plus size={14} color={colors.brand} />
            <Text style={[styles.chipText, { color: colors.brand }]}>Folder</Text>
          </Pressable>
        </ScrollView>
      </View>
      <FlatList
        refreshControl={refreshControl}
        data={list}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingBottom: BOTTOM_SPACE }}
        ListHeaderComponent={
          list.length ? (
            <>
              <PlayAllBar tracks={list} onPlay={(tracks, index, opts) => a.play(tracks, index, { ...opts, title: selected ? selected.name : 'Favorites' })} />
              <CountHeader count={list.length} noun={selected ? `in ${selected.name}` : 'favorites'} />
            </>
          ) : null
        }
        ListEmptyComponent={
          favs.loading ? null : selected ? (
            <Empty
              icon={<FolderHeart size={28} color={colors.brand} />}
              title="This folder is empty"
              body="Open a song's menu and choose Favorites Folder to put it here."
            />
          ) : (
            <Empty icon={<Heart size={28} color={colors.brand} />} title="No favorites yet" body="Tap the heart on any song — or on the lock screen — to keep it here." />
          )
        }
        renderItem={({ item, index }) => (
          <SongRow
            track={item}
            isCurrent={item.id === current}
            isPlaying={isPlaying}
            onPress={() => (item.id === current ? Player.toggle() : a.play(list, index, { title: selected ? selected.name : 'Favorites' }))}
            onMore={() => a.songMenu(item)}
          />
        )}
      />
    </View>
  );
}

function Chip({ label, active, onPress, onLongPress }: { label: string; active: boolean; onPress: () => void; onLongPress?: () => void }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button">
      <Text style={[styles.chipText, active && { color: '#fff' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface, maxWidth: 220 },
  chipActive: { backgroundColor: colors.brand },
  chipAdd: { borderWidth: 1, borderColor: colors.brand, backgroundColor: 'transparent' },
  chipText: { fontFamily: font.medium, fontSize: 13, color: colors.muted },
});

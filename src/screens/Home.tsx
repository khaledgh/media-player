import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ArrowDownUp, FolderPlus, Music, SquarePlay } from 'lucide-react-native';
import Header from '../components/Header';
import Artwork from '../components/Artwork';
import SongRow from '../components/SongRow';
import FolderRow from '../components/FolderRow';
import { Button, Empty, SectionHeader } from '../components/ui';
import { useLibrary } from '../hooks/useLibrary';
import { useActions } from '../hooks/useActions';
import { usePlayer } from '../services/PlayerService';
import Player from '../services/PlayerService';
import { kvGet, kvSet } from '../data/db';
import {
  displayArtist,
  getAlbums,
  getAllTracks,
  getArtists,
  getFolders,
  getMostPlayed,
  getRecentlyPlayed,
  SORT_LABELS,
} from '../data/library';
import type { SortMode, Track } from '../data/library';
import { colors, font, type } from '../theme';
import { navigate } from '../navigation/ref';
import { useSyncStatus } from '../services/SyncService';

const TABS = ['Suggested', 'Songs', 'Artists', 'Albums', 'Folders'] as const;
type Tab = (typeof TABS)[number];
export const BOTTOM_SPACE = 170; // tab bar + mini player

const { width } = Dimensions.get('window');

export default function Home() {
  const [tab, setTab] = useState<Tab>('Suggested');
  return (
    <View style={styles.root}>
      <Header />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && { color: colors.brand }]}>{t}</Text>
            {tab === t && <Animated.View entering={FadeIn.duration(150)} style={styles.underline} />}
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.tabsLine} />
      {tab === 'Suggested' && <Suggested onSeeAll={setTab} />}
      {tab === 'Songs' && <Songs />}
      {tab === 'Artists' && <Artists />}
      {tab === 'Albums' && <Albums />}
      {tab === 'Folders' && <Folders />}
    </View>
  );
}

function useNowPlaying() {
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  return { current, isPlaying };
}

/** Plays a list, or toggles pause if the tapped song is already playing. */
function useTapToPlay(list: Track[] | undefined, title: string) {
  const { play } = useActions();
  const { current } = useNowPlaying();
  return useCallback(
    (i: number) => {
      if (!list) return;
      if (list[i]?.id === current) return Player.toggle();
      play(list, i, { title });
    },
    [list, current, play, title],
  );
}

// ---------- Suggested ----------

function Suggested({ onSeeAll }: { onSeeAll: (t: Tab) => void }) {
  const recent = useLibrary(() => getRecentlyPlayed(12), []);
  const most = useLibrary(() => getMostPlayed(12), []);
  const artists = useLibrary(() => getArtists(), []);
  const all = useLibrary(() => getAllTracks('added_desc'), []);
  const syncing = useSyncStatus((s) => s.syncing && !s.firstSyncDone);
  const { play, addFromYouTube } = useActions();

  if (all.data && !all.data.length) {
    return (
      <Empty
        icon={<Music size={28} color={colors.brand} />}
        title={syncing ? 'Setting up your library…' : 'Your library is empty'}
        body={syncing ? 'Your music is on its way to this device.' : 'Save a song from YouTube or create a folder and import music from your phone.'}
        action={!syncing && <Button title="Add from YouTube" icon={<SquarePlay size={18} color="#fff" />} onPress={() => addFromYouTube()} style={{ marginTop: 12 }} />}
      />
    );
  }

  const recentList = recent.data?.length ? recent.data : all.data?.slice(0, 12);
  const mostList = most.data?.length ? most.data : all.data?.slice(12, 24);

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: BOTTOM_SPACE }} showsVerticalScrollIndicator={false}>
      <SectionHeader
        title={recent.data?.length ? 'Recently Played' : 'Recently Added'}
        action="See All"
        onAction={() => (recent.data?.length ? navigate('Songs', { title: 'Recently Played', source: 'recent' }) : onSeeAll('Songs'))}
        style={styles.pad}
      />
      <FlatList
        horizontal
        data={recentList}
        keyExtractor={(t) => String(t.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.hList}
        renderItem={({ item, index }) => <Card track={item} onPress={() => recentList && play(recentList, index, { title: 'Recently played' })} />}
      />

      {!!artists.data?.length && (
        <>
          <SectionHeader title="Artists" action="See All" onAction={() => onSeeAll('Artists')} style={[styles.pad, { marginTop: 28 }]} />
          <FlatList
            horizontal
            data={artists.data.slice(0, 12)}
            keyExtractor={(a) => a.name}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
            renderItem={({ item }) => (
              <Pressable style={{ width: 100, alignItems: 'center', gap: 8 }} onPress={() => navigate('Collection', { kind: 'artist', name: item.name })}>
                <Artwork seed={item.name} coverFile={item.cover_file} size={96} kind="artist" />
                <Text style={[type.bodyMedium, { fontSize: 13 }]} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      {!!mostList?.length && (
        <>
          <SectionHeader
            title={most.data?.length ? 'Most Played' : 'More to explore'}
            action="See All"
            onAction={() => (most.data?.length ? navigate('Songs', { title: 'Most Played', source: 'most' }) : onSeeAll('Songs'))}
            style={[styles.pad, { marginTop: 28 }]}
          />
          <FlatList
            horizontal
            data={mostList}
            keyExtractor={(t) => String(t.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
            renderItem={({ item, index }) => <Card track={item} onPress={() => play(mostList, index, { title: 'Most played' })} />}
          />
        </>
      )}
    </ScrollView>
  );
}

function Card({ track, onPress }: { track: Track; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width: 140, gap: 8 }, pressed && { opacity: 0.8 }]} accessibilityLabel={`Play ${track.title}`}>
      <Artwork seed={track.remote_id ?? track.id} coverFile={track.cover_file} size={140} radius={22} />
      <Text style={[type.bodyMedium, { fontSize: 13 }]} numberOfLines={2}>
        {track.title}
        <Text style={type.caption}>{` - ${displayArtist(track)}`}</Text>
      </Text>
    </Pressable>
  );
}

// ---------- Songs ----------

function Songs() {
  const [mode, setMode] = useState<SortMode>('title');
  useEffect(() => {
    kvGet('songs_sort').then((v) => v && setMode(v as SortMode));
  }, []);
  const tracks = useLibrary(() => getAllTracks(mode), [mode]);
  const { songMenu, choose } = useActions();
  const { current, isPlaying } = useNowPlaying();
  const tap = useTapToPlay(tracks.data, 'All songs');

  async function sort() {
    const m = await choose<SortMode>({
      title: 'Sort by',
      selected: mode,
      options: (Object.keys(SORT_LABELS) as SortMode[]).filter((k) => k !== 'custom').map((value) => ({ value, label: SORT_LABELS[value] })),
    });
    if (m) {
      setMode(m);
      kvSet('songs_sort', m);
    }
  }

  return (
    <FlatList
      data={tracks.data}
      keyExtractor={(t) => String(t.id)}
      contentContainerStyle={{ paddingBottom: BOTTOM_SPACE }}
      ListHeaderComponent={<CountHeader count={tracks.data?.length ?? 0} noun="songs" sortLabel={SORT_LABELS[mode]} onSort={sort} />}
      ListEmptyComponent={tracks.loading ? null : <Empty icon={<Music size={28} color={colors.brand} />} title="No songs yet" />}
      renderItem={({ item, index }) => (
        <SongRow track={item} isCurrent={item.id === current} isPlaying={isPlaying} onPress={() => tap(index)} onMore={() => songMenu(item)} />
      )}
      initialNumToRender={14}
      windowSize={9}
    />
  );
}

export function CountHeader({ count, noun, sortLabel, onSort }: { count: number; noun: string; sortLabel?: string; onSort?: () => void }) {
  return (
    <View style={styles.countHeader}>
      <Text style={type.h3}>
        {count} {noun}
      </Text>
      {onSort && (
        <Pressable onPress={onSort} style={styles.sortBtn} hitSlop={8} accessibilityLabel={`Sort: ${sortLabel}`}>
          <Text style={type.link}>{sortLabel}</Text>
          <ArrowDownUp size={14} color={colors.brand} />
        </Pressable>
      )}
    </View>
  );
}

// ---------- Artists ----------

function Artists() {
  const artists = useLibrary(() => getArtists(), []);
  return (
    <FlatList
      data={artists.data}
      keyExtractor={(a) => a.name}
      contentContainerStyle={{ paddingBottom: BOTTOM_SPACE }}
      ListHeaderComponent={<CountHeader count={artists.data?.length ?? 0} noun="artists" />}
      renderItem={({ item }) => (
        <Pressable style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surface }]} onPress={() => navigate('Collection', { kind: 'artist', name: item.name })}>
          <Artwork seed={item.name} coverFile={item.cover_file} size={56} kind="artist" />
          <View style={{ flex: 1 }}>
            <Text style={type.h3} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={type.caption}>
              {item.albums} Album{item.albums === 1 ? '' : 's'}  |  {item.songs} Song{item.songs === 1 ? '' : 's'}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

// ---------- Albums ----------

function Albums() {
  const albums = useLibrary(() => getAlbums(), []);
  const size = (width - 20 * 2 - 16) / 2;
  return (
    <FlatList
      data={albums.data}
      keyExtractor={(a) => a.name}
      numColumns={2}
      columnWrapperStyle={{ gap: 16, paddingHorizontal: 20 }}
      contentContainerStyle={{ paddingBottom: BOTTOM_SPACE, gap: 18 }}
      ListHeaderComponent={<CountHeader count={albums.data?.length ?? 0} noun="albums" />}
      ListEmptyComponent={albums.loading ? null : <Empty icon={<Music size={28} color={colors.brand} />} title="No albums" body="Albums appear when songs have album info." />}
      renderItem={({ item }) => (
        <Pressable style={{ width: size, gap: 6 }} onPress={() => navigate('Collection', { kind: 'album', name: item.name })}>
          <Artwork seed={item.name} coverFile={item.cover_file} size={size} radius={22} />
          <Text style={type.h3} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={type.caption} numberOfLines={1}>
            {item.artist || 'Various'}  |  {item.songs} songs
          </Text>
        </Pressable>
      )}
    />
  );
}

// ---------- Folders ----------

export function Folders() {
  const folders = useLibrary(() => getFolders(null), []);
  const { folderMenu, newFolder } = useActions();
  return (
    <FlatList
      data={folders.data}
      keyExtractor={(f) => String(f.id)}
      contentContainerStyle={{ paddingBottom: BOTTOM_SPACE }}
      ListHeaderComponent={
        <View style={styles.countHeader}>
          <Text style={type.h3}>{folders.data?.length ?? 0} folders</Text>
          <Pressable onPress={() => newFolder(null)} style={styles.sortBtn} hitSlop={8}>
            <FolderPlus size={16} color={colors.brand} />
            <Text style={type.link}>New folder</Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        folders.loading ? null : (
          <Empty
            icon={<FolderPlus size={28} color={colors.brand} />}
            title="No folders yet"
            body="Folders keep your music organised. Everything inside plays in order and downloads automatically."
            action={<Button title="Create a folder" onPress={() => newFolder(null)} style={{ marginTop: 12 }} />}
          />
        )
      }
      renderItem={({ item }) => <FolderRow folder={item} onPress={() => navigate('Folder', { id: item.id })} onMore={() => folderMenu(item)} />}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabs: { flexGrow: 0 },
  tabsContent: { paddingHorizontal: 12, gap: 4 },
  tab: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 10 },
  tabText: { fontFamily: font.medium, fontSize: 14, color: colors.faint },
  underline: { position: 'absolute', left: 10, right: 10, bottom: 0, height: 2.5, borderRadius: 2, backgroundColor: colors.brand },
  tabsLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  pad: { paddingHorizontal: 20 },
  hList: { paddingHorizontal: 20, gap: 14 },
  countHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 9 },
});

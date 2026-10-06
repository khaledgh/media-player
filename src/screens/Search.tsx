import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Search as SearchIcon, X } from 'lucide-react-native';
import SongRow from '../components/SongRow';
import FolderRow from '../components/FolderRow';
import Artwork from '../components/Artwork';
import FloatingDock from '../components/FloatingDock';
import { IconButton, SectionHeader } from '../components/ui';
import { useActions } from '../hooks/useActions';
import { usePlayer } from '../services/PlayerService';
import { search } from '../data/library';
import type { Artist, Folder, Track } from '../data/library';
import { kvGet, kvSet } from '../data/db';
import { navigate } from '../navigation/ref';
import { colors, font, radius, type } from '../theme';

type Row =
  | { kind: 'header'; title: string }
  | { kind: 'track'; track: Track; index: number }
  | { kind: 'folder'; folder: Folder }
  | { kind: 'artist'; artist: Artist };

export default function Search() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const a = useActions();
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [res, setRes] = useState<{ tracks: Track[]; folders: Folder[]; artists: Artist[] } | null>(null);

  useEffect(() => {
    kvGet('recent_searches').then((v) => v && setRecent(JSON.parse(v)));
  }, []);

  useEffect(() => {
    if (!q.trim()) return setRes(null);
    const t = setTimeout(() => search(q).then(setRes), 150);
    return () => clearTimeout(t);
  }, [q]);

  const saveRecent = (term: string) => {
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 10);
    setRecent(next);
    kvSet('recent_searches', JSON.stringify(next));
  };
  const removeRecent = (term: string) => {
    const next = recent.filter((r) => r !== term);
    setRecent(next);
    kvSet('recent_searches', JSON.stringify(next));
  };

  const rows = useMemo<Row[]>(() => {
    if (!res) return [];
    const out: Row[] = [];
    if (res.artists.length) out.push({ kind: 'header', title: 'Artists' }, ...res.artists.map((artist): Row => ({ kind: 'artist', artist })));
    if (res.folders.length) out.push({ kind: 'header', title: 'Folders' }, ...res.folders.map((folder): Row => ({ kind: 'folder', folder })));
    if (res.tracks.length) out.push({ kind: 'header', title: 'Songs' }, ...res.tracks.map((track, index): Row => ({ kind: 'track', track, index })));
    return out;
  }, [res]);

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <IconButton label="Back" onPress={() => nav.goBack()} style={{ marginLeft: -8 }}>
          <ArrowLeft size={24} color={colors.text} />
        </IconButton>
        <View style={styles.inputWrap}>
          <SearchIcon size={18} color={colors.brand} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="Songs, artists, folders"
            placeholderTextColor={colors.faint}
            style={styles.input}
            selectionColor={colors.brand}
            returnKeyType="search"
            onSubmitEditing={() => q.trim() && saveRecent(q.trim())}
          />
          {!!q && (
            <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear">
              <X size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {!q.trim() ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          {recent.length > 0 && (
            <>
              <SectionHeader title="Recent Searches" action="Clear All" onAction={() => (setRecent([]), kvSet('recent_searches', '[]'))} />
              {recent.map((r) => (
                <View key={r} style={styles.recentRow}>
                  <Pressable style={{ flex: 1 }} onPress={() => setQ(r)}>
                    <Text style={[type.body, { color: colors.muted }]}>{r}</Text>
                  </Pressable>
                  <Pressable hitSlop={10} onPress={() => removeRecent(r)} accessibilityLabel={`Remove ${r}`}>
                    <X size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(r, i) => (r.kind === 'track' ? `t${r.track.id}` : r.kind === 'folder' ? `f${r.folder.id}` : r.kind === 'artist' ? `a${r.artist.name}` : `h${i}`)}
          contentContainerStyle={{ paddingBottom: 170 }}
          ListEmptyComponent={res ? <Text style={[type.caption, { textAlign: 'center', marginTop: 40 }]}>No results for “{q}”</Text> : null}
          renderItem={({ item }) => {
            if (item.kind === 'header') return <Text style={[type.h3, { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 }]}>{item.title}</Text>;
            if (item.kind === 'folder')
              return <FolderRow folder={item.folder} onPress={() => (saveRecent(q.trim()), navigate('Folder', { id: item.folder.id }))} />;
            if (item.kind === 'artist')
              return (
                <Pressable
                  style={styles.artistRow}
                  onPress={() => {
                    saveRecent(q.trim());
                    navigate('Collection', { kind: 'artist', name: item.artist.name });
                  }}
                >
                  <Artwork seed={item.artist.name} coverFile={item.artist.cover_file} size={48} kind="artist" />
                  <View>
                    <Text style={type.h3}>{item.artist.name}</Text>
                    <Text style={type.caption}>{item.artist.songs} songs</Text>
                  </View>
                </Pressable>
              );
            const list = res!.tracks;
            return (
              <SongRow
                track={item.track}
                isCurrent={item.track.id === current}
                isPlaying={isPlaying}
                onPress={() => {
                  saveRecent(q.trim());
                  a.play(list, item.index, { title: `Search: ${q}` });
                }}
                onMore={() => a.songMenu(item.track)}
              />
            );
          }}
        />
      )}
      <FloatingDock />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 8 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  input: { flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, height: '100%' },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 8 },
});

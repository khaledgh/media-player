import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Search, Play, Folder, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaylistStore, MediaFile, Group } from '../store/PlaylistStore';
import { getTrackGradient } from '../utils/trackColors';
import AudioPlayerService from '../services/AudioPlayerService';
import * as Haptics from 'expo-haptics';

interface SearchScreenProps {
  onShowPlayer: () => void;
}

type ResultItem =
  | { kind: 'track'; data: MediaFile }
  | { kind: 'folder'; data: Group };

const TrackArt = ({ track }: { track: MediaFile }) => {
  const [c1, c2] = getTrackGradient(track.id);
  return (
    <LinearGradient colors={[c1, c2]} style={styles.art}>
      <Text style={styles.artText}>{track.name.slice(0, 2).toUpperCase()}</Text>
    </LinearGradient>
  );
};

const FolderArt = ({ group }: { group: Group }) => {
  const [c1, c2] = getTrackGradient(group.id + 1000);
  return (
    <LinearGradient colors={[c1, c2]} style={styles.art}>
      <Folder color="#fff" size={22} />
    </LinearGradient>
  );
};

const SearchScreen: React.FC<SearchScreenProps> = ({ onShowPlayer }) => {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { currentPlaylist, availableGroups, setCurrentTrack, addToRecentlyPlayed } = usePlaylistStore();

  const results = useMemo<ResultItem[]>(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const tracks: ResultItem[] = currentPlaylist
      .filter(t => !t.missing && t.name.toLowerCase().includes(q))
      .map(t => ({ kind: 'track', data: t }));
    const folders: ResultItem[] = availableGroups
      .filter(g => g.name.toLowerCase().includes(q))
      .map(g => ({ kind: 'folder', data: g }));
    return [...tracks, ...folders];
  }, [query, currentPlaylist, availableGroups]);

  const playTrack = async (track: MediaFile) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const list = currentPlaylist.filter(t => !t.missing);
    const idx = list.findIndex(t => t.id === track.id);
    await AudioPlayerService.loadPlaylist(
      list.map(t => ({ id: String(t.id), url: t.local_uri, title: t.name, artist: 'My Library' })),
      Math.max(idx, 0)
    );
    setCurrentTrack(track);
    addToRecentlyPlayed(track);
    onShowPlayer();
  };

  const renderItem = ({ item }: { item: ResultItem }) => {
    if (item.kind === 'track') {
      const track = item.data;
      return (
        <TouchableOpacity style={styles.row} onPress={() => playTrack(track)} activeOpacity={0.7}>
          <TrackArt track={track} />
          <View style={styles.rowInfo}>
            <Text style={styles.rowTitle} numberOfLines={1}>{track.name}</Text>
            <Text style={styles.rowSub}>Track</Text>
          </View>
          <Play color="#7c3aed" size={18} />
        </TouchableOpacity>
      );
    }
    const group = item.data;
    return (
      <View style={styles.row}>
        <FolderArt group={group} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>{group.name}</Text>
          <Text style={styles.rowSub}>Folder</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>Search</Text>
      </View>
      <View style={styles.inputWrap}>
        <Search color="#64748b" size={18} style={{ marginRight: 10 }} />
        <TextInput
          style={styles.input}
          placeholder="Tracks, folders…"
          placeholderTextColor="#475569"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X color="#64748b" size={16} />
          </TouchableOpacity>
        )}
      </View>

      {query.trim().length === 0 ? (
        <View style={styles.emptyState}>
          <Search color="#1e293b" size={52} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>Find your music</Text>
          <Text style={styles.emptySub}>Search tracks and folders by name</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptySub}>Try a different search term</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item =>
            item.kind === 'track' ? `t-${item.data.id}` : `f-${item.data.id}`
          }
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 160 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050510' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  heading: { fontSize: 28, color: '#fff', fontWeight: '800' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    height: 48,
  },
  input: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    gap: 12,
  },
  art: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  rowInfo: { flex: 1 },
  rowTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  rowSub: { color: '#475569', fontSize: 12, marginTop: 2 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  emptyTitle: { color: '#334155', fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptySub: { color: '#1e293b', fontSize: 13, marginTop: 6 },
});

export default SearchScreen;

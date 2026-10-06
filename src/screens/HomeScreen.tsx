import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Play, Clock, Zap, Music2 } from 'lucide-react-native';
import { usePlaylistStore, MediaFile } from '../store/PlaylistStore';
import { getTrackGradient } from '../utils/trackColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AudioPlayerService from '../services/AudioPlayerService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_W = 140;

interface HomeScreenProps {
  onShowPlayer: () => void;
}

const TrackArt = ({ track, size = 56 }: { track: MediaFile; size?: number }) => {
  const [c1, c2] = getTrackGradient(track.id);
  const initials = track.name.slice(0, 2).toUpperCase();
  return (
    <LinearGradient
      colors={[c1, c2]}
      style={[{ width: size, height: size, borderRadius: size * 0.22, alignItems: 'center', justifyContent: 'center' }]}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.34, fontWeight: '800', letterSpacing: 0.5 }}>
        {initials}
      </Text>
    </LinearGradient>
  );
};

const HomeScreen: React.FC<HomeScreenProps> = ({ onShowPlayer }) => {
  const insets = useSafeAreaInsets();
  const { currentPlaylist, recentlyPlayed, setCurrentTrack, addToRecentlyPlayed } = usePlaylistStore();

  const quickPicks = currentPlaylist.filter(t => !t.missing).slice(0, 12);
  const hasRecent = recentlyPlayed.length > 0;

  const playTrack = async (track: MediaFile, playlist?: MediaFile[]) => {
    const list = (playlist ?? currentPlaylist).filter(t => !t.missing);
    const idx = list.findIndex(t => t.id === track.id);
    await AudioPlayerService.loadPlaylist(
      list.map(t => ({ id: String(t.id), url: t.local_uri, title: t.name, artist: 'My Library' })),
      Math.max(idx, 0)
    );
    setCurrentTrack(track);
    addToRecentlyPlayed(track);
    onShowPlayer();
  };

  const playAll = async () => {
    if (quickPicks.length === 0) return;
    await playTrack(quickPicks[0], quickPicks);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 160 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good{getGreeting()},</Text>
          <Text style={styles.title}>What's playing?</Text>
        </View>
        {quickPicks.length > 0 && (
          <TouchableOpacity style={styles.playAllBtn} onPress={playAll} activeOpacity={0.8}>
            <Play color="#fff" size={16} fill="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.playAllTxt}>Play All</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recently Played */}
      {hasRecent && (
        <Section icon={<Clock color="#a78bfa" size={18} />} title="Recently Played">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {recentlyPlayed.map(track => (
              <TouchableOpacity key={track.id} style={styles.recentCard} onPress={() => playTrack(track)} activeOpacity={0.8}>
                <TrackArt track={track} size={60} />
                <Text style={styles.recentName} numberOfLines={2}>{track.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Section>
      )}

      {/* Quick Picks */}
      {quickPicks.length > 0 && (
        <Section icon={<Zap color="#f59e0b" size={18} />} title="Quick Picks">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {quickPicks.map(track => (
              <TouchableOpacity key={track.id} style={styles.pickCard} onPress={() => playTrack(track)} activeOpacity={0.8}>
                <TrackArt track={track} size={CARD_W - 24} />
                <Text style={styles.pickName} numberOfLines={2}>{track.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Section>
      )}

      {/* Empty state */}
      {currentPlaylist.length === 0 && (
        <View style={styles.empty}>
          <Music2 color="#334155" size={56} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No music yet</Text>
          <Text style={styles.emptySub}>Go to Library tab to add folders and tracks</Text>
        </View>
      )}
    </ScrollView>
  );
};

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
  </View>
);

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return ' morning';
  if (h < 18) return ' afternoon';
  return ' evening';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050510' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  greeting: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  title: { fontSize: 26, color: '#fff', fontWeight: '800', marginTop: 2 },
  playAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
  },
  playAllTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  section: { marginBottom: 28 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 16, color: '#fff', fontWeight: '700' },
  hList: { paddingHorizontal: 20, gap: 12 },
  recentCard: { alignItems: 'center', width: 74 },
  recentName: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 14,
  },
  pickCard: {
    width: CARD_W,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  pickName: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 10,
    lineHeight: 18,
  },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: '#475569', fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptySub: { color: '#334155', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});

export default HomeScreen;

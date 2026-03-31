import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, LogBox, Modal } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaylistStore } from './src/store/PlaylistStore';
import AudioPlayerService from './src/services/AudioPlayerService';
import Dashboard from './src/screens/Dashboard';
import Player from './src/screens/Player';
import * as KeepAwake from 'expo-keep-awake';

LogBox.ignoreLogs(['SafeAreaView has been deprecated']);

const App = () => {
  const insets = useSafeAreaInsets();
  const { loadInitialData, currentTrack, currentPlaylist, isLoading } = usePlaylistStore();
  const [showFullPlayer, setShowFullPlayer] = useState(false);

  useEffect(() => {
    KeepAwake.activateKeepAwakeAsync().catch(() => {});

    const initialize = async () => {
      await loadInitialData();
      await AudioPlayerService.setupPlayer();
    };
    initialize();

    const handleTrackEnded = async () => {
        const { currentPlaylist, currentTrack, setCurrentTrack } = usePlaylistStore.getState();
        if (!currentPlaylist || currentPlaylist.length <= 1 || !currentTrack) return;

        const currentIndex = currentPlaylist.findIndex(t => t.id === currentTrack.id);
        const nextIndex = (currentIndex + 1) % currentPlaylist.length;
        const nextTrack = currentPlaylist[nextIndex];

        setCurrentTrack(nextTrack);
        await AudioPlayerService.reset();
        await AudioPlayerService.loadTrack({
            id: nextTrack.id.toString(),
            url: nextTrack.local_uri,
            title: nextTrack.name,
            artist: 'Local Library'
        });
        AudioPlayerService.play();
    };

    AudioPlayerService.addEventListener('trackEnded', handleTrackEnded);

    return () => {
      KeepAwake.deactivateKeepAwake();
      AudioPlayerService.removeEventListener('trackEnded', handleTrackEnded);
    };
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Dashboard onShowPlayer={() => setShowFullPlayer(true)} />

      {currentTrack && !showFullPlayer && (
        <TouchableOpacity
          onPress={() => setShowFullPlayer(true)}
          style={[styles.miniPlayer, { paddingBottom: Math.max(insets.bottom, 16), height: 80 + insets.bottom }]}
        >
          <View style={styles.miniPlayerIcon}>
            <Text style={styles.miniPlayerEmoji}>🎵</Text>
          </View>
          <View style={styles.miniPlayerInfo}>
            <Text style={styles.miniPlayerTitle} numberOfLines={1}>{currentTrack.name}</Text>
            <Text style={styles.miniPlayerSubtitle}>Playing...</Text>
          </View>
        </TouchableOpacity>
      )}

      <Modal
        visible={showFullPlayer}
        animationType="slide"
        onRequestClose={() => setShowFullPlayer(false)}
      >
        <Player onClose={() => setShowFullPlayer(false)} />
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
  },
  miniPlayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  miniPlayerIcon: {
    width: 48,
    height: 48,
    backgroundColor: '#2563eb',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniPlayerEmoji: {
    color: '#fff',
  },
  miniPlayerInfo: {
    marginLeft: 16,
    flex: 1,
  },
  miniPlayerTitle: {
    color: '#fff',
    fontWeight: 'bold',
  },
  miniPlayerSubtitle: {
    color: '#9ca3af',
    fontSize: 12,
  },
});

export default App;

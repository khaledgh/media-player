import React, { useEffect, useState } from 'react';
import { View, StyleSheet, LogBox, Modal, Platform, PermissionsAndroid } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { usePlaylistStore } from './src/store/PlaylistStore';
import { useSettingsStore } from './src/store/SettingsStore';
import AudioPlayerService from './src/services/AudioPlayerService';
import Dashboard from './src/screens/Dashboard';
import Player from './src/screens/Player';
import GlobalDownloadBanner from './src/components/GlobalDownloadBanner';
import MiniPlayer from './src/components/MiniPlayer';
import BottomTabs from './src/components/BottomTabs';
import HomeScreen from './src/screens/HomeScreen';
import SearchScreen from './src/screens/SearchScreen';
import SettingsScreen from './src/screens/SettingsScreen';

LogBox.ignoreLogs(['SafeAreaView has been deprecated']);

const App = () => {
  const insets = useSafeAreaInsets();
  const { loadInitialData, isLoading } = usePlaylistStore();
  const { loadSettings } = useSettingsStore();
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [activeTab, setActiveTab] = useState('library');

  useEffect(() => {
    const initialize = async () => {
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
      }
      await loadSettings();
      await loadInitialData();
      await AudioPlayerService.setupPlayer();
    };
    initialize();

    return () => {};
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
      </View>
    );
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':
        return <HomeScreen onShowPlayer={() => setShowFullPlayer(true)} />;
      case 'library':
        return <Dashboard onShowPlayer={() => setShowFullPlayer(true)} />;
      case 'search':
        return <SearchScreen onShowPlayer={() => setShowFullPlayer(true)} />;
      case 'settings':
        return <SettingsScreen />;
      default:
        return <Dashboard onShowPlayer={() => setShowFullPlayer(true)} />;
    }
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Global Download Banner */}
      <View style={{ paddingTop: insets.top }}>
        <GlobalDownloadBanner />
      </View>

      {renderScreen()}

      {/* ────── Mini Player ────── */}
      <MiniPlayer 
        onShowPlayer={() => setShowFullPlayer(true)} 
        insetsBottom={60 + insets.bottom} 
      />

      {/* ────── Bottom Tabs ────── */}
      <BottomTabs activeTab={activeTab} onTabPress={setActiveTab} />

      <Modal
        visible={showFullPlayer}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowFullPlayer(false)}
      >
        <Player onClose={() => setShowFullPlayer(false)} />
      </Modal>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050510',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#050510',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;

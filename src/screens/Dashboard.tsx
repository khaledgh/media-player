import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ScrollView, TextInput,
  Alert, Modal, ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, Animated as RNAnimated, Dimensions,
} from 'react-native';
import { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { usePlaylistStore } from '../store/PlaylistStore';
import { useDownloadStore } from '../store/DownloadStore';
import * as SQLiteService from '../services/SQLiteService';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Music, Check, X, Download, Trash2, FolderPlus,
  Play, Pause, SkipForward, Youtube,
} from 'lucide-react-native';
import { extractAudioFromVideo } from '../services/MediaConverter';
import AudioPlayerService from '../services/AudioPlayerService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FolderDetail from './FolderDetail';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSettingsStore } from '../store/SettingsStore';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface DashboardProps {
  onShowPlayer: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onShowPlayer }) => {
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;

  const {
    availableGroups, selectedGroupIds, currentPlaylist, currentTrack,
    refreshGroups, toggleGroupSelection, selectGroup,
    setCurrentTrack, reorderTrack,
  } = usePlaylistStore();

  const { isDownloading, progress, itemName, startDownload, updateProgress, finishDownload, failDownload } = useDownloadStore();
  const { serverUrl: BACKEND_URL } = useSettingsStore();

  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const [showYTModal, setShowYTModal] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [ytLoading, setYtLoading] = useState(false);
  const [ytStatus, setYtStatus] = useState('');
  const [ytGroupId, setYtGroupId] = useState<number | null>(null);

  const [showGroupOptions, setShowGroupOptions] = useState<number | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<{ id: number; name: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const insets = useSafeAreaInsets();
  const addSheetAnim = useRef(new RNAnimated.Value(0)).current;

  const openAddSheet = () => {
    setNewGroupName('');
    setShowAddGroup(true);
    RNAnimated.spring(addSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeAddSheet = () => {
    RNAnimated.timing(addSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowAddGroup(false));
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await SQLiteService.addGroup(newGroupName.trim());
      setNewGroupName('');
      closeAddSheet();
      await refreshGroups();
    } catch (error) {
      Alert.alert("Error", "Group already exists or database error.");
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    const group = availableGroups.find(g => g.id === groupId);
    Alert.alert(
      "Delete Folder",
      `Delete "${group?.name}" and all its tracks?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            await SQLiteService.deleteGroup(groupId);
            await refreshGroups();
            setShowGroupOptions(null);
            if (selectedGroupIds.includes(groupId)) {
              const { refreshPlaylist } = usePlaylistStore.getState();
              await refreshPlaylist();
            }
          }
        }
      ]
    );
  };

  const handleImportMP3 = async (groupId: number) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/mpeg',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        for (const asset of result.assets) {
          const newUri = `${FileSystem.documentDirectory}${asset.name}`;
          await FileSystem.copyAsync({ from: asset.uri, to: newUri });
          await SQLiteService.addFile(asset.name, newUri, groupId);
        }
        await selectGroup(groupId);
      }
    } catch (error) {
      console.error("Import error", error);
    }
  };

  const handleDownloadYouTube = async () => {
    if (!ytUrl.trim() || !ytGroupId) return;
    setYtLoading(true);
    setYtStatus('Fetching video info...');

    try {
      const infoRes = await fetch(`${BACKEND_URL}/info?url=${encodeURIComponent(ytUrl)}`);
      if (!infoRes.ok) throw new Error('Invalid URL');
      const info = await infoRes.json();
      
      startDownload(info.title);
      setShowYTModal(false);
      setYtLoading(false);

      const fileName = `${info.title.replace(/[^\w]/g, '')}_${Date.now()}.mp3`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;

      const dr = FileSystem.createDownloadResumable(
        `${BACKEND_URL}/download?url=${encodeURIComponent(ytUrl)}`,
        fileUri,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > 0) updateProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
        }
      );

      const res = await dr.downloadAsync();
      if (res && res.status === 200) {
        await SQLiteService.addFile(`${info.title}.mp3`, res.uri, ytGroupId);
        await selectGroup(ytGroupId);
        finishDownload();
      }
    } catch (error: any) {
      setYtStatus(`Error: ${error.message}`);
      failDownload(error.message);
      setYtLoading(false);
    }
  };

  const handlePlayTrack = async (track: SQLiteService.MediaFile) => {
    setCurrentTrack(track);
    const queue = currentPlaylist.map(t => ({
      id: t.id.toString(),
      url: t.local_uri,
      title: t.name,
      artist: 'Sonic Library',
    }));
    const startIndex = currentPlaylist.findIndex(t => t.id === track.id);
    await AudioPlayerService.loadPlaylist(queue, Math.max(startIndex, 0));
    await AudioPlayerService.play();
    onShowPlayer();
  };

  if (selectedFolder) {
    return (
      <FolderDetail
        groupId={selectedFolder.id}
        groupName={selectedFolder.name}
        onBack={() => setSelectedFolder(null)}
        onShowPlayer={onShowPlayer}
      />
    );
  }

  return (
    <View style={[s.container, { paddingTop: Math.max(insets.top, 16) }]}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.avatarBox}>
            <Text style={s.avatarEmoji}>👤</Text>
          </View>
          <View style={s.headerText}>
            <Text style={s.greeting}>Hello, User</Text>
          </View>
        </View>

        {isDownloading && (
          <View style={s.headerDownloadInfo}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerDownloadLabel} numberOfLines={1}>Downloading {itemName}...</Text>
              <View style={s.headerDownloadBar}>
                <View style={[s.headerDownloadFill, { width: `${progress * 100}%` }]} />
              </View>
            </View>
            <ActivityIndicator size="small" color="#a78bfa" style={{ marginLeft: 10 }} />
          </View>
        )}

        <View style={s.headerIcons}>
          <TouchableOpacity style={s.iconBtn}>
            <Text style={s.headerIconText}>🔍</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 160 }}
        scrollEnabled={!isEditing}
      >
        <View style={s.tabScroll}>
          {['All', 'New Artists', 'Hot Tracks'].map((tab, i) => (
            <TouchableOpacity key={tab} style={[s.tabPill, i === 0 && s.tabPillActive]}>
              <Text style={[s.tabPillText, i === 0 && s.tabPillTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!isEditing && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>For you</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.forYouScroll}>
              <View style={s.forYouCard}>
                <View style={[s.forYouGradient, { backgroundColor: '#7c3aed' }]}>
                  <Text style={s.forYouTitle}>Feel the Beat</Text>
                  <Text style={s.forYouSubtitle}>Explore curated tracks for your mood.</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        )}

        {!isEditing && (
          <View style={s.section}>
            <View style={s.quickInfoSection}>
              <View style={s.infoCard}>
                <Text style={s.infoCardNumber}>{currentPlaylist.length}</Text>
                <Text style={s.infoCardLabel}>Tracks</Text>
              </View>
              <View style={[s.infoCard, s.infoCardHighlight]}>
                <Text style={s.infoCardNumber}>{availableGroups.length}</Text>
                <Text style={s.infoCardLabel}>Folders</Text>
              </View>
            </View>
          </View>
        )}

        {!isEditing && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionTitle}>Your Library</Text>
              <TouchableOpacity onPress={openAddSheet}>
                <Text style={s.showAll}>+ Add Folder</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.folderScroll}>
              {availableGroups.map((group) => (
                <TouchableOpacity
                  key={group.id}
                  onPress={() => setSelectedFolder({ id: group.id, name: group.name })}
                  onLongPress={() => setShowGroupOptions(group.id)}
                  style={s.folderItem}
                >
                  <View style={s.folderArt}>
                    <Text style={s.folderEmoji}>📁</Text>
                  </View>
                  <Text style={s.folderLabel} numberOfLines={1}>{group.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={s.section}>
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionTitle}>{isEditing ? 'Reorder' : 'Popular'}</Text>
            <TouchableOpacity onPress={() => setIsEditing(!isEditing)}>
              <Text style={s.showAll}>{isEditing ? 'Done' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>

          {isEditing ? (
            <DraggableFlatList
              data={currentPlaylist}
              onDragEnd={({ data }) => {
                const updates = data.map((t, i) => ({ id: t.id, sortOrder: i }));
                SQLiteService.updateMultipleFileSortOrders(updates);
                usePlaylistStore.setState({ currentPlaylist: data });
              }}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item, drag, isActive }) => (
                <ScaleDecorator>
                  <TouchableOpacity onLongPress={drag} disabled={isActive} style={[s.trackItem, isActive && { backgroundColor: 'rgba(124, 58, 237, 0.2)' }]}>
                    <View style={s.trackArtSmall}><Text style={s.trackEmojiSmall}>🎵</Text></View>
                    <View style={s.trackInfoSmall}><Text style={s.trackNameSmall}>{item.name}</Text></View>
                    <View style={s.dragHandle}><Text style={{ color: '#64748b' }}>≡</Text></View>
                  </TouchableOpacity>
                </ScaleDecorator>
              )}
            />
          ) : (
            currentPlaylist.map((track) => (
              <TouchableOpacity key={track.id} style={s.trackItem} onPress={() => handlePlayTrack(track)}>
                <View style={s.trackArtSmall}><Text style={s.trackEmojiSmall}>🎵</Text></View>
                <View style={s.trackInfoSmall}><Text style={s.trackNameSmall}>{track.name}</Text></View>
                {isPlaying && currentTrack?.id === track.id ? (
                    <Pause color="#fff" size={14} fill="#fff" />
                ) : (
                    <Play color="#fff" size={14} fill="#fff" />
                )}
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      {showAddGroup && (
        <View style={StyleSheet.absoluteFill}>
          <TouchableOpacity style={s.sheetOverlay} activeOpacity={1} onPress={closeAddSheet} />
          <RNAnimated.View style={[s.sheetContent, { transform: [{ translateY: addSheetAnim.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }] }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>New Folder</Text>
            <TextInput style={s.sheetInput} placeholder="Folder name" placeholderTextColor="#64748b" value={newGroupName} onChangeText={setNewGroupName} autoFocus />
            <TouchableOpacity style={s.sheetBtn} onPress={handleCreateGroup}><Text style={s.sheetBtnText}>Create</Text></TouchableOpacity>
            <View style={{ height: 40 + insets.bottom }} />
          </RNAnimated.View>
        </View>
      )}

      <Modal visible={showYTModal} transparent animationType="slide">
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => !ytLoading && setShowYTModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
            <View style={s.modalContent}>
              <Text style={s.modalTitle}>YouTube Download</Text>
              <TextInput style={s.modalInput} placeholder="URL" placeholderTextColor="#64748b" value={ytUrl} onChangeText={setYtUrl} />
              <TouchableOpacity style={s.downloadBtnActive} onPress={handleDownloadYouTube}>
                {ytLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>Download</Text>}
              </TouchableOpacity>
              <View style={{ height: insets.bottom + 20 }} />
            </View>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {showGroupOptions && (
        <Modal transparent visible animationType="fade">
            <TouchableOpacity style={s.modalOverlay} onPress={() => setShowGroupOptions(null)}>
                <View style={s.modalContent}>
                    <TouchableOpacity style={s.sheetBtn} onPress={() => { handleImportMP3(showGroupOptions); setShowGroupOptions(null); }}>
                        <Text style={s.sheetBtnText}>Import MP3s</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.sheetBtn, { marginTop: 10, backgroundColor: '#dc2626' }]} onPress={() => handleDeleteGroup(showGroupOptions)}>
                        <Text style={s.sheetBtnText}>Delete Folder</Text>
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050510' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20 },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  avatarBox: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 20 },
  headerText: { marginLeft: 12 },
  greeting: { color: '#fff', fontSize: 22, fontWeight: '800' },
  headerIcons: { flexDirection: 'row', gap: 10 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  headerIconText: { fontSize: 16 },
  tabScroll: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 25, gap: 10 },
  tabPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)' },
  tabPillActive: { backgroundColor: '#7c3aed' },
  tabPillText: { color: '#64748b', fontWeight: '600', fontSize: 13 },
  tabPillTextActive: { color: '#fff' },
  section: { marginBottom: 30, paddingHorizontal: 20 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  showAll: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  forYouScroll: { marginHorizontal: -20, paddingHorizontal: 20 },
  forYouCard: { width: SCREEN_WIDTH * 0.75, marginRight: 15 },
  forYouGradient: { borderRadius: 24, padding: 20, height: 180, justifyContent: 'center' },
  forYouTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  forYouSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 18, marginBottom: 15 },
  folderScroll: { gap: 15 },
  folderItem: { width: 80, alignItems: 'center' },
  folderArt: { width: 64, height: 64, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  folderEmoji: { fontSize: 24 },
  folderLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  trackItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 16 },
  trackArtSmall: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  trackEmojiSmall: { fontSize: 18 },
  trackInfoSmall: { flex: 1, marginLeft: 12 },
  trackNameSmall: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dragHandle: { padding: 10 },
  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'flex-end' },
  sheetContent: { backgroundColor: '#0f0f1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 12 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#1e293b', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { color: '#e2e8f0', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sheetInput: { color: '#e2e8f0', fontSize: 16, padding: 16, backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: 14, marginBottom: 16 },
  sheetBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#7c3aed', padding: 16, borderRadius: 14 },
  sheetBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  modalContent: { backgroundColor: '#0f0f1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { color: '#e2e8f0', fontSize: 18, fontWeight: '800', marginBottom: 20 },
  modalInput: { color: '#e2e8f0', fontSize: 15, padding: 16, backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: 14, marginBottom: 16 },
  downloadBtnActive: { backgroundColor: '#dc2626', padding: 16, borderRadius: 14, alignItems: 'center' },
  headerDownloadInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', marginHorizontal: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  headerDownloadLabel: { color: '#fff', fontSize: 10, fontWeight: '700', marginBottom: 4 },
  headerDownloadBar: { height: 3, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' },
  headerDownloadFill: { height: '100%', backgroundColor: '#a78bfa' },
  quickInfoSection: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  infoCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 16, alignItems: 'center' },
  infoCardHighlight: { backgroundColor: 'rgba(167, 139, 250, 0.1)' },
  infoCardNumber: { fontSize: 28, fontWeight: '900', color: '#fff', marginBottom: 4 },
  infoCardLabel: { fontSize: 11, fontWeight: '600', color: '#64748b' },
});

export default Dashboard;

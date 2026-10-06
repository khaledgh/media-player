import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { ChevronLeft, Play, Trash2, GripVertical, Youtube, Music as MusicIcon, Download, Pause, FolderPlus, MoreVertical, X, MoreHorizontal } from 'lucide-react-native';
import * as SQLiteService from '../services/SQLiteService';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AudioPlayerService from '../services/AudioPlayerService';
import { usePlaylistStore } from '../store/PlaylistStore';
import { useDownloadStore } from '../store/DownloadStore';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useSettingsStore } from '../store/SettingsStore';

const { width } = Dimensions.get('window');

interface FolderDetailProps {
  groupId: number;
  groupName: string;
  onBack: () => void;
  onShowPlayer: () => void;
}

export default function FolderDetail({ groupId, groupName, onBack, onShowPlayer }: FolderDetailProps) {
  const [files, setFiles] = useState<SQLiteService.MediaFile[]>([]);
  const [subfolders, setSubfolders] = useState<SQLiteService.Group[]>([]);
  const [loading, setLoading] = useState(true);
  const { setCurrentTrack, setIsPlaying, currentTrack, isPlaying } = usePlaylistStore();
  const { isDownloading, progress, itemName, startDownload, updateProgress, finishDownload, failDownload } = useDownloadStore();
  const { serverUrl: BACKEND_URL } = useSettingsStore();
  const insets = useSafeAreaInsets();
  
  const [showYTModal, setShowYTModal] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [ytLoading, setYtLoading] = useState(false);
  const [ytStatus, setYtStatus] = useState('');

  const [showAddSubfolder, setShowAddSubfolder] = useState(false);
  const [newSubfolderName, setNewSubfolderName] = useState('');

  const [currentFolderId, setCurrentFolderId] = useState(groupId);
  const [folderHistory, setFolderHistory] = useState<{id: number, name: string}[]>([]);
  const [currentFolderName, setCurrentFolderName] = useState(groupName);

  useEffect(() => {
    loadContent();
  }, [currentFolderId]);

  const loadContent = async () => {
    setLoading(true);
    try {
      const folderFiles = await SQLiteService.getFilesByGroupId(currentFolderId);
      const verified = await SQLiteService.verifyFilesExist(folderFiles);
      setFiles(verified);

      const subs = await SQLiteService.getGroups(currentFolderId);
      setSubfolders(subs);
    } finally {
      setLoading(false);
    }
  };

  const navigateToSubfolder = (id: number, name: string) => {
    setFolderHistory([...folderHistory, { id: currentFolderId, name: currentFolderName }]);
    setCurrentFolderId(id);
    setCurrentFolderName(name);
  };

  const handleBack = () => {
    if (folderHistory.length > 0) {
      const prev = folderHistory[folderHistory.length - 1];
      setFolderHistory(folderHistory.slice(0, -1));
      setCurrentFolderId(prev.id);
      setCurrentFolderName(prev.name);
    } else {
      onBack();
    }
  };

  const handleCreateSubfolder = async () => {
    if (!newSubfolderName.trim()) return;
    try {
      await SQLiteService.addGroup(newSubfolderName, currentFolderId);
      setNewSubfolderName('');
      setShowAddSubfolder(false);
      await loadContent();
    } catch (e) {
      Alert.alert("Error", "Folder name must be unique");
    }
  };

  const handlePlayTrack = async (track: SQLiteService.MediaFile) => {
    setCurrentTrack(track);

    const queue = files.map(t => ({
      id: t.id.toString(),
      url: t.local_uri,
      title: t.name,
      artist: 'Sonic Library',
    }));
    const startIndex = files.findIndex(t => t.id === track.id);

    await AudioPlayerService.loadPlaylist(queue, Math.max(startIndex, 0));
    await AudioPlayerService.play();
    setIsPlaying(true);
    onShowPlayer();
  };

  const handleDeleteTrack = async (track: SQLiteService.MediaFile) => {
    Alert.alert('Delete', `Delete "${track.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await SQLiteService.deleteFile(track.id);
          await loadContent();
      }},
    ]);
  };

  const handleDragEnd = async ({ data }: { data: SQLiteService.MediaFile[] }) => {
    setFiles(data);
    const updates = data.map((track, index) => ({ id: track.id, sortOrder: index }));
    await SQLiteService.updateMultipleFileSortOrders(updates);
  };

  const handleImportMP3 = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/mpeg', multiple: true });
      if (!result.canceled && result.assets) {
        for (const asset of result.assets) {
          const newUri = `${FileSystem.documentDirectory}${asset.name}`;
          await FileSystem.copyAsync({ from: asset.uri, to: newUri });
          await SQLiteService.addFile(asset.name, newUri, currentFolderId);
        }
        await loadContent();
      }
    } catch (e) { Alert.alert("Error", "Import failed"); }
  };

  const handleDownloadYouTube = async () => {
    if (!ytUrl.trim()) return;
    setYtLoading(true);
    setYtStatus('Connecting...');
    try {
      const infoRes = await fetch(`${BACKEND_URL}/info?url=${encodeURIComponent(ytUrl)}`);
      if (!infoRes.ok) throw new Error('Invalid URL');
      const info = await infoRes.json();
      startDownload(info.title);
      setShowYTModal(false);
      
      const fileName = `${info.title.replace(/[^\w]/g, '')}_${Date.now()}.mp3`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;
      const dr = FileSystem.createDownloadResumable(`${BACKEND_URL}/download?url=${encodeURIComponent(ytUrl)}`, fileUri, {}, (p) => {
        if (p.totalBytesExpectedToWrite > 0) updateProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
      });
      const res = await dr.downloadAsync();
      if (res && res.status === 200) {
        await SQLiteService.addFile(`${info.title}.mp3`, res.uri, currentFolderId);
        await loadContent();
        finishDownload();
      }
    } catch (e: any) { failDownload(e.message); }
    finally { setYtLoading(false); }
  };

  const renderTrack = ({ item, drag, isActive }: RenderItemParams<SQLiteService.MediaFile>) => {
    const isCurrent = currentTrack?.id === item.id;
    return (
      <ScaleDecorator>
        <TouchableOpacity
          onLongPress={drag}
          disabled={isActive}
          onPress={() => item.missing ? Alert.alert("Missing", "File not found") : handlePlayTrack(item)}
          style={[s.trackItem, isActive && s.trackItemActive, isCurrent && s.trackItemCurrent, item.missing && s.trackItemMissing]}
        >
          <View style={[s.trackArt, item.missing && s.trackArtMissing]}>
            <Text style={s.trackEmoji}>{item.missing ? '❓' : '🎵'}</Text>
          </View>
          <View style={s.trackInfo}>
            <View style={s.trackHeaderRow}>
              <Text style={[s.trackName, isCurrent && s.trackNameCurrent]} numberOfLines={1}>{item.name}</Text>
              {item.missing && (
                <View style={s.missingBadge}>
                  <Text style={s.missingBadgeText}>MISSING</Text>
                </View>
              )}
            </View>
            <Text style={s.trackSub}>{isCurrent && isPlaying ? 'Playing' : 'Sonic Library'}</Text>
          </View>
          <TouchableOpacity onPressIn={drag} style={s.dragHandle}>
            <GripVertical color="#64748b" size={20} />
          </TouchableOpacity>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  return (
    <View style={[s.container, { paddingTop: Math.max(insets.top, 16) }]}>
      <LinearGradient
        colors={['#050510', '#000']}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={handleBack} style={s.backBtn}>
          <ChevronLeft color="#fff" size={24} />
        </TouchableOpacity>
        <View style={s.headerTextContainer}>
          <Text style={s.headerSub}>LIBRARY / FOLDER</Text>
          <Text style={s.title}>{currentFolderName}</Text>
        </View>
        <TouchableOpacity style={s.backBtn}>
          <MoreHorizontal color="#fff" size={20} />
        </TouchableOpacity>
      </View>

      <View style={s.content}>
        {/* Quick Actions */}
        <View style={s.actionsRow}>
          <TouchableOpacity onPress={() => setShowYTModal(true)} style={s.actionPill}>
            <LinearGradient
              colors={['#ef4444', '#b91c1c']}
              style={StyleSheet.absoluteFill}
              start={{x:0, y:0}} end={{x:1, y:0}}
            />
            <Youtube color="#fff" size={18} />
            <Text style={s.actionText}>YouTube</Text>
          </TouchableOpacity>
          
          <TouchableOpacity onPress={handleImportMP3} style={s.actionPillSecondary}>
            <MusicIcon color="#a78bfa" size={18} />
            <Text style={s.actionTextSecondary}>Import</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setShowAddSubfolder(true)} style={s.actionPillSecondary}>
            <FolderPlus color="#a78bfa" size={18} />
            <Text style={s.actionTextSecondary}>Subfolder</Text>
          </TouchableOpacity>
        </View>

        {/* Subfolders Scroll */}
        {subfolders.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Subfolders</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.folderScroll}>
              {subfolders.map(folder => (
                <TouchableOpacity key={folder.id} onPress={() => navigateToSubfolder(folder.id, folder.name)} style={s.folderItem}>
                  <View style={s.folderArt}>
                    <Text style={s.folderEmoji}>📁</Text>
                  </View>
                  <Text style={s.folderLabel} numberOfLines={1}>{folder.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Tracks List */}
        <View style={[s.section, { flex: 1 }]}>
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionTitle}>Tracks ({files.length})</Text>
            {files.length > 0 && (
              <TouchableOpacity style={s.playAllBtn}>
                <Play color="#fff" size={12} fill="#fff" />
                <Text style={s.playAllText}>Play All</Text>
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <ActivityIndicator color="#7c3aed" style={{ marginTop: 40 }} />
          ) : files.length === 0 ? (
            <View style={s.emptyState}>
              <View style={s.emptyIconBox}>
                <MusicIcon color="#1e293b" size={40} />
              </View>
              <Text style={s.emptyTitle}>Empty Folder</Text>
              <Text style={s.emptySubtitle}>Start adding music via YouTube or Import</Text>
            </View>
          ) : (
            <DraggableFlatList
              data={files}
              onDragEnd={handleDragEnd}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderTrack}
              contentContainerStyle={{ paddingBottom: 150 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      {/* Modern Subfolder Modal */}
      <Modal visible={showAddSubfolder} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowAddSubfolder(false)} />
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <Text style={s.modalTitleSheet}>Create Subfolder</Text>
            <Text style={s.modalSub}>Organizing inside "{currentFolderName}"</Text>
            <TextInput
              style={s.modalInput}
              placeholder="Enter folder name..."
              placeholderTextColor="#64748b"
              value={newSubfolderName}
              onChangeText={setNewSubfolderName}
              autoFocus
            />
            <TouchableOpacity 
              onPress={handleCreateSubfolder} 
              style={[s.modalBtnAction, !newSubfolderName.trim() && { opacity: 0.5 }]}
              disabled={!newSubfolderName.trim()}
            >
              <Text style={s.modalBtnTextAction}>Create Folder</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* YT Modal */}
      <Modal visible={showYTModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowYTModal(false)} />
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <Text style={s.modalTitleSheet}>Download from YouTube</Text>
            <Text style={s.modalSub}>Audio will be added to this folder</Text>
            <TextInput
              style={s.modalInput}
              placeholder="Paste YouTube Link"
              placeholderTextColor="#64748b"
              value={ytUrl}
              onChangeText={setYtUrl}
            />
            {ytLoading && <Text style={s.ytStatus}>{ytStatus}</Text>}
            <TouchableOpacity 
              onPress={handleDownloadYouTube} 
              style={[s.modalBtnAction, (!ytUrl.trim() || ytLoading) && { opacity: 0.5 }]}
              disabled={!ytUrl.trim() || ytLoading}
            >
              {ytLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.modalBtnTextAction}>Download Now</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 70,
  },
  headerTextContainer: {
    alignItems: 'center',
  },
  headerSub: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 25,
  },
  actionPill: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 16,
    gap: 8,
    overflow: 'hidden',
  },
  actionPillSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(167, 139, 250, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.15)',
    gap: 8,
  },
  actionText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  actionTextSecondary: {
    color: '#a78bfa',
    fontWeight: '700',
    fontSize: 13,
  },
  section: {
    marginBottom: 25,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
  },
  playAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  playAllText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  folderScroll: {
    gap: 15,
  },
  folderItem: {
    width: 80,
    alignItems: 'center',
  },
  folderArt: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  folderEmoji: {
    fontSize: 26,
  },
  folderLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  trackItemActive: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  trackItemCurrent: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
  },
  trackItemMissing: {
    opacity: 0.6,
  },
  trackArt: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackArtMissing: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  trackEmoji: {
    fontSize: 20,
  },
  trackInfo: {
    flex: 1,
    marginLeft: 14,
  },
  trackHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trackName: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    flexShrink: 1,
  },
  trackNameCurrent: {
    color: '#a78bfa',
  },
  trackSub: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  missingBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  missingBadgeText: {
    color: '#ef4444',
    fontSize: 8,
    fontWeight: '900',
  },
  dragHandle: {
    padding: 10,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 60,
  },
  emptyIconBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#0f0f1e',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 25,
  },
  modalTitleSheet: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  modalSub: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 25,
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 18,
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  modalBtnAction: {
    backgroundColor: '#7c3aed',
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  modalBtnTextAction: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  ytStatus: {
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 15,
    textAlign: 'center',
  },
});


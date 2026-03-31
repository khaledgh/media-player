import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, TextInput, Alert, Modal, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { usePlaylistStore } from '../store/PlaylistStore';
import * as SQLiteService from '../services/SQLiteService';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Plus, FileVideo, Music, ChevronRight, Check, X, Download, ChevronUp, ChevronDown, Trash2 } from 'lucide-react-native';
import { extractAudioFromVideo } from '../services/MediaConverter';
import AudioPlayerService from '../services/AudioPlayerService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BACKEND_URL = "https://yt.linksbridge.top";

interface DashboardProps {
    onShowPlayer: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onShowPlayer }) => {
    const {
        availableGroups,
        selectedGroupIds,
        currentPlaylist,
        refreshGroups,
        toggleGroupSelection,
        selectGroup,
        setCurrentTrack,
        reorderTrack
    } = usePlaylistStore();

    const [newGroupName, setNewGroupName] = useState('');
    const [showAddGroup, setShowAddGroup] = useState(false);

    const [showYTModal, setShowYTModal] = useState(false);
    const [ytUrl, setYtUrl] = useState('');
    const [ytLoading, setYtLoading] = useState(false);
    const [ytStatus, setYtStatus] = useState('');
    const [ytGroupId, setYtGroupId] = useState<number | null>(null);

    const insets = useSafeAreaInsets();

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) return;
        try {
            await SQLiteService.addGroup(newGroupName);
            setNewGroupName('');
            setShowAddGroup(false);
            await refreshGroups();
        } catch (error) {
            Alert.alert("Error", "Group already exists or database error.");
        }
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
                    await FileSystem.copyAsync({
                        from: asset.uri,
                        to: newUri
                    });

                    await SQLiteService.addFile(asset.name, newUri, groupId);
                }
                await selectGroup(groupId);
            }
        } catch (error) {
            console.error("Import error", error);
        }
    };

    const handleImportVideo = async (groupId: number) => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: 'video/mp4',
                copyToCacheDirectory: true,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                const fileName = asset.name.split('.')[0];

                Alert.alert("Processing", "Extracting audio from video...");
                const mp3Uri = await extractAudioFromVideo(asset.uri, fileName);

                if (mp3Uri) {
                    await SQLiteService.addFile(`${fileName}.mp3`, mp3Uri, groupId);
                    await selectGroup(groupId);
                    Alert.alert("Success", "Audio extracted and saved to group!");
                } else {
                    Alert.alert("Error", "Extraction failed.");
                }
            }
        } catch (error) {
            console.error("Import error", error);
        }
    };

    const openYTModal = (groupId: number) => {
        setYtGroupId(groupId);
        setYtUrl('');
        setYtStatus('');
        setYtLoading(false);
        setShowYTModal(true);
    };

    const handleDownloadYouTube = async () => {
        if (!ytUrl.trim() || !ytGroupId) return;

        setYtLoading(true);
        setYtStatus('Fetching video info...');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const infoRes = await fetch(`${BACKEND_URL}/info?url=${encodeURIComponent(ytUrl)}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!infoRes.ok) {
                const errData = await infoRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Invalid URL or video not found');
            }
            const info = await infoRes.json();
            const safeTitle = info.title.replace(/[^\w\s-]/gi, '').trim();

            setYtStatus(`Downloading: ${info.title}...`);

            const fileName = `${safeTitle.slice(0, 10)}_${Date.now()}.mp3`;
            const fileUri = `${FileSystem.documentDirectory}${fileName}`;

            const downloadRes = await FileSystem.downloadAsync(
                `${BACKEND_URL}/download?url=${encodeURIComponent(ytUrl)}`,
                fileUri
            );

            if (downloadRes.status === 200) {
                await SQLiteService.addFile(`${info.title}.mp3`, downloadRes.uri, ytGroupId);
                await selectGroup(ytGroupId);

                setYtStatus('');
                setShowYTModal(false);
                Alert.alert("Success", `"${info.title}" downloaded and saved!`);
            } else {
                throw new Error('Download failed');
            }
        } catch (error: any) {
            console.error("Download error", error);
            if (error.name === 'AbortError') {
                setYtStatus('Error: Backend connection timed out. Check your IP/Firewall.');
            } else {
                setYtStatus(`Error: ${error.message || 'Could not connect to backend.'}`);
            }
        } finally {
            setYtLoading(false);
        }
    };

    const handlePlayTrack = async (track: SQLiteService.MediaFile) => {
        setCurrentTrack(track);
        await AudioPlayerService.reset();
        await AudioPlayerService.loadTrack({
            id: track.id.toString(),
            url: track.local_uri,
            title: track.name,
            artist: 'Local Library',
        });
        AudioPlayerService.play();
        onShowPlayer();
    };

    const handleDeleteTrack = async (track: SQLiteService.MediaFile) => {
        Alert.alert(
            "Delete Track",
            `Are you sure you want to delete "${track.name}"?`,
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Delete", 
                    style: "destructive",
                    onPress: async () => {
                        try {
                            // Stop if currently playing
                            const playerState = AudioPlayerService.getState();
                            if (playerState.currentTrack?.id === track.id.toString()) {
                              await AudioPlayerService.reset();
                            }

                            // Delete from DB
                            await SQLiteService.deleteFile(track.id);
                            
                            // Delete from storage if it exists (Optional/Best practice)
                            try {
                                const info = await FileSystem.getInfoAsync(track.local_uri);
                                if (info.exists) {
                                    await FileSystem.deleteAsync(track.local_uri);
                                }
                            } catch (e) {}

                            // Update store
                            const { deleteTrack } = usePlaylistStore.getState();
                            deleteTrack(track.id);

                        } catch (error) {
                            Alert.alert("Error", "Could not delete file.");
                        }
                    }
                }
            ]
        );
    };

    return (
        <View style={[s.container, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={s.header}>
                <Text style={s.headerTitle}>SonicGroup</Text>
                <TouchableOpacity
                    onPress={() => setShowAddGroup(!showAddGroup)}
                    style={s.addButton}
                >
                    <Plus color="white" size={24} />
                </TouchableOpacity>
            </View>

            {showAddGroup && (
                <View style={s.addGroupCard}>
                    <TextInput
                        placeholder="Group Name"
                        placeholderTextColor="#666"
                        style={s.addGroupInput}
                        value={newGroupName}
                        onChangeText={setNewGroupName}
                    />
                    <TouchableOpacity
                        onPress={handleCreateGroup}
                        style={s.createGroupBtn}
                    >
                        <Text style={s.createGroupBtnText}>Create Group</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Group Horizontal List */}
            <View style={s.groupSection}>
                <Text style={s.sectionLabel}>GROUPS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {availableGroups.length === 0 && (
                        <Text style={s.emptyGroupText}>No groups created yet.</Text>
                    )}
                    {availableGroups.map((group) => {
                        const isSelected = selectedGroupIds.includes(group.id);
                        return (
                            <TouchableOpacity
                                key={group.id}
                                onPress={() => toggleGroupSelection(group.id)}
                                style={[
                                    s.groupChip,
                                    isSelected ? s.groupChipSelected : s.groupChipUnselected,
                                ]}
                            >
                                {isSelected && <Check color="white" size={16} style={{ marginRight: 8 }} />}
                                <Text style={[s.groupChipText, isSelected ? s.groupChipTextSelected : s.groupChipTextUnselected]}>
                                    {group.name}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            {/* Library Queue */}
            <View style={s.librarySection}>
                <View style={s.libraryHeader}>
                    <Text style={s.sectionLabel}>LIBRARY QUEUE</Text>
                    <View style={s.libraryActions}>
                        {selectedGroupIds.length > 0 && (
                          <View style={{ flexDirection: 'row' }}>
                                <TouchableOpacity onPress={() => openYTModal(selectedGroupIds[0])} style={{ marginRight: 16 }}>
                                    <Text style={s.ytButton}>YT</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => handleImportMP3(selectedGroupIds[0])} style={{ marginRight: 16 }}>
                                    <Music color="#aaa" size={20} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => handleImportVideo(selectedGroupIds[0])}>
                                    <FileVideo color="#aaa" size={20} />
                                </TouchableOpacity>
                          </View>
                        )}
                    </View>
                </View>

                <FlatList
                    data={currentPlaylist}
                    keyExtractor={(item, index) => `${item.id}-${index}`}
                    renderItem={({ item, index }) => (
                        <View style={s.trackContainer}>
                            <TouchableOpacity
                                onPress={() => handlePlayTrack(item)}
                                style={s.trackItem}
                            >
                                <View style={s.trackIcon}>
                                    <Music color="white" size={18} />
                                </View>
                                <View style={s.trackInfo}>
                                    <Text style={s.trackName} numberOfLines={1}>{item.name}</Text>
                                    <Text style={s.trackSub}>Internal Document</Text>
                                </View>
                                <TouchableOpacity 
                                  onPress={() => handleDeleteTrack(item)}
                                  style={{ marginLeft: 16 }}
                                >
                                    <Trash2 color="#ef4444" size={20} />
                                </TouchableOpacity>
                            </TouchableOpacity>
                            <View style={s.orderButtons}>
                                <TouchableOpacity 
                                  onPress={() => reorderTrack(index, index - 1)}
                                  style={s.orderBtn}
                                  disabled={index === 0}
                                >
                                    <ChevronUp color={index === 0 ? "#222" : "#9ca3af"} size={20} />
                                </TouchableOpacity>
                                <TouchableOpacity 
                                  onPress={() => reorderTrack(index, index + 1)}
                                  style={s.orderBtn}
                                  disabled={index === currentPlaylist.length - 1}
                                >
                                    <ChevronDown color={index === currentPlaylist.length - 1 ? "#222" : "#9ca3af"} size={20} />
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                    ListEmptyComponent={
                        <View style={s.emptyList}>
                            <Text style={s.emptyListText}>Select groups to see files or import new ones.</Text>
                            <Text style={s.emptyListHint}>(Import multi-files allowed)</Text>
                        </View>
                    }
                />
            </View>

            {/* YouTube Download Modal */}
            <Modal
                visible={showYTModal}
                transparent
                animationType="slide"
                onRequestClose={() => !ytLoading && setShowYTModal(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={{ flex: 1 }}
                >
                    <View style={s.modalOverlay}>
                        <View style={[s.modalContent, { paddingBottom: Math.max(insets.bottom, 40) }]}>
                            <View style={s.modalHeader}>
                                <Text style={s.modalTitle}>YouTube Download</Text>
                                <TouchableOpacity
                                    onPress={() => !ytLoading && setShowYTModal(false)}
                                    style={s.modalClose}
                                >
                                    <X color="white" size={20} />
                                </TouchableOpacity>
                            </View>

                            <Text style={s.modalLabel}>Paste YouTube URL</Text>
                            <TextInput
                                placeholder="https://www.youtube.com/watch?v=..."
                                placeholderTextColor="#555"
                                style={s.modalInput}
                                value={ytUrl}
                                onChangeText={setYtUrl}
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!ytLoading}
                                selectTextOnFocus
                            />

                            {ytStatus !== '' && (
                                <View style={s.statusBox}>
                                    <Text style={[s.statusText, ytStatus.startsWith('Error') ? s.statusError : s.statusInfo]}>
                                        {ytStatus}
                                    </Text>
                                </View>
                            )}

                            <TouchableOpacity
                                onPress={handleDownloadYouTube}
                                disabled={ytLoading || !ytUrl.trim()}
                                style={[
                                    s.downloadBtn,
                                    (ytLoading || !ytUrl.trim()) ? s.downloadBtnDisabled : s.downloadBtnActive,
                                ]}
                            >
                                {ytLoading ? (
                                    <ActivityIndicator color="white" size="small" />
                                ) : (
                                    <>
                                        <Download color="white" size={20} />
                                        <Text style={s.downloadBtnText}>Download Audio</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
};

const s = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        paddingHorizontal: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    headerTitle: {
        fontSize: 32,
        fontWeight: '900',
        color: '#60a5fa',
        letterSpacing: -1,
    },
    addButton: {
        backgroundColor: '#3b82f6',
        padding: 10,
        borderRadius: 14,
        shadowColor: "#3b82f6",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    addGroupCard: {
        marginBottom: 24,
        backgroundColor: 'rgba(31, 41, 55, 0.4)',
        padding: 20,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: 'rgba(55, 65, 81, 0.5)',
    },
    addGroupInput: {
        color: '#fff',
        fontSize: 16,
        padding: 14,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: 'rgba(75, 85, 99, 0.5)',
    },
    createGroupBtn: {
        backgroundColor: '#3b82f6',
        padding: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    createGroupBtnText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    groupSection: {
        marginBottom: 24,
    },
    sectionLabel: {
        color: '#9ca3af',
        fontWeight: '600',
        marginBottom: 12,
    },
    emptyGroupText: {
        color: '#4b5563',
        fontStyle: 'italic',
    },
    groupChip: {
        marginRight: 10,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1.5,
    },
    groupChipSelected: {
        backgroundColor: '#3b82f6',
        borderColor: '#3b82f6',
    },
    groupChipUnselected: {
        backgroundColor: 'rgba(31, 41, 55, 0.3)',
        borderColor: 'rgba(55, 65, 81, 0.5)',
    },
    groupChipText: {
        fontWeight: '700',
        fontSize: 14,
    },
    groupChipTextSelected: {
        color: '#fff',
    },
    groupChipTextUnselected: {
        color: '#9ca3af',
    },
    librarySection: {
        flex: 1,
    },
    libraryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    libraryActions: {
        flexDirection: 'row',
    },
    ytButton: {
        color: '#ef4444',
        fontWeight: 'bold',
    },
    trackContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    trackItem: {
        backgroundColor: 'rgba(31, 41, 55, 0.3)',
        padding: 16,
        borderRadius: 20,
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(55, 65, 81, 0.4)',
    },
    orderButtons: {
        marginLeft: 12,
        padding: 4,
        backgroundColor: '#111827',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#1f2937',
    },
    orderBtn: {
        padding: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    trackIcon: {
        width: 40,
        height: 40,
        backgroundColor: '#1f2937',
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    trackInfo: {
        marginLeft: 16,
        flex: 1,
    },
    trackName: {
        color: '#fff',
        fontWeight: 'bold',
    },
    trackSub: {
        color: '#6b7280',
        fontSize: 12,
    },
    emptyList: {
        alignItems: 'center',
        marginTop: 40,
    },
    emptyListText: {
        color: '#4b5563',
    },
    emptyListHint: {
        color: '#374151',
        fontSize: 12,
        marginTop: 4,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.7)',
    },
    modalContent: {
        backgroundColor: '#111827',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        borderTopWidth: 1,
        borderTopColor: '#374151',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    modalTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
    },
    modalClose: {
        padding: 8,
        backgroundColor: '#1f2937',
        borderRadius: 999,
    },
    modalLabel: {
        color: '#9ca3af',
        fontSize: 14,
        marginBottom: 8,
    },
    modalInput: {
        color: '#fff',
        fontSize: 16,
        padding: 16,
        backgroundColor: '#000',
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#374151',
    },
    statusBox: {
        marginBottom: 16,
        padding: 12,
        backgroundColor: '#1f2937',
        borderRadius: 8,
    },
    statusText: {
        fontSize: 14,
    },
    statusError: {
        color: '#f87171',
    },
    statusInfo: {
        color: '#60a5fa',
    },
    downloadBtn: {
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    downloadBtnActive: {
        backgroundColor: '#dc2626',
    },
    downloadBtnDisabled: {
        backgroundColor: '#374151',
    },
    downloadBtnText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
        marginLeft: 8,
    },
});

export default Dashboard;

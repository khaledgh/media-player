import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowDownUp,
  CheckCheck,
  CloudDownload,
  Copy,
  EllipsisVertical,
  FolderInput,
  FolderPlus,
  GripVertical,
  Play,
  Shuffle,
  SquarePlay,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react-native';
import Header from '../components/Header';
import Artwork from '../components/Artwork';
import SongRow from '../components/SongRow';
import FolderRow from '../components/FolderRow';
import FloatingDock from '../components/FloatingDock';
import { Button, Empty, IconButton, SectionHeader } from '../components/ui';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { useLibrary } from '../hooks/useLibrary';
import { useActions } from '../hooks/useActions';
import { usePlayer } from '../services/PlayerService';
import Player from '../services/PlayerService';
import DownloadManager from '../services/DownloadManager';
import {
  copyTracks,
  getFolder,
  getFolderStats,
  getFolderTracks,
  getFolders,
  moveItems,
  removeItems,
  reorderItems,
  SORT_LABELS,
} from '../data/library';
import type { FolderTrack } from '../data/library';
import type { RootStackParams } from '../navigation/ref';
import { navigate } from '../navigation/ref';
import { colors, font, formatTime, type } from '../theme';

export default function FolderDetail() {
  const refreshControl = usePullRefresh();
  const { id } = useRoute<RouteProp<RootStackParams, 'Folder'>>().params;
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const a = useActions();
  const folder = useLibrary(() => getFolder(id), [id]);
  const f = folder.data;
  const tracks = useLibrary(() => (f ? getFolderTracks(id, f.sort_mode) : Promise.resolve([] as FolderTrack[])), [id, f?.sort_mode]);
  const subfolders = useLibrary(() => getFolders(id), [id]);
  const stats = useLibrary(() => getFolderStats(id), [id]);
  const current = usePlayer((s) => s.current?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const selecting = selected.size > 0;
  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<FolderTrack[]>([]);

  // The folder was deleted (here or on another device).
  useEffect(() => {
    if (!folder.loading && folder.data === null) nav.goBack();
  }, [folder.loading, folder.data, nav]);

  // Back button leaves selection / reorder mode first.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (selecting) return setSelected(new Set()), true;
        if (reordering) return setReordering(false), true;
        return false;
      });
      return () => sub.remove();
    }, [selecting, reordering]),
  );

  if (!f) return <View style={styles.root}><Header back /></View>;
  const own = !f.shared;
  const list = tracks.data ?? [];
  const s = stats.data;

  const toggleSelect = (itemId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });

  const tap = (i: number) => {
    if (selecting) return toggleSelect(list[i].item_id);
    if (list[i].id === current) return Player.toggle();
    a.play(list, i, { title: f.name });
  };

  const selectedItems = list.filter((t) => selected.has(t.item_id));

  async function moveSelected() {
    const target = await a.pickFolder({ title: `Move ${selected.size} song${selected.size === 1 ? '' : 's'} to`, excludeIds: [id] });
    if (!target) return;
    await moveItems([...selected], target);
    setSelected(new Set());
    a.toast('Moved');
  }

  async function copySelected() {
    const target = await a.pickFolder({ title: `Add ${selected.size} song${selected.size === 1 ? '' : 's'} to`, excludeIds: [id] });
    if (!target) return;
    const n = await copyTracks(selectedItems.map((t) => t.id), target);
    setSelected(new Set());
    a.toast(n ? `Added ${n} song${n === 1 ? '' : 's'}` : 'Already in that folder');
  }

  async function removeSelected() {
    if (!(await a.confirm({ title: `Remove ${selected.size} song${selected.size === 1 ? '' : 's'}?`, message: 'They are removed from this folder on all your devices.', confirm: 'Remove', danger: true })))
      return;
    await removeItems([...selected]);
    setSelected(new Set());
  }

  function startReorder() {
    setOrder(list);
    setReordering(true);
  }

  async function saveOrder() {
    await reorderItems(id, order.map((t) => t.item_id));
    setReordering(false);
    a.toast('Order saved');
  }

  const downloaded = s ? s.done : 0;
  const total = s ? s.total : 0;

  const header = (
    <View>
      <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.hero}>
        <Artwork seed={f.id} kind="folder" size={150} radius={36} style={styles.heroArt} />
        <Text style={[type.h1, { textAlign: 'center' }]} numberOfLines={2}>
          {f.name}
        </Text>
        <Text style={type.caption}>
          {total} Songs{s?.ms ? `  |  ${formatTime(s.ms / 1000)} mins` : ''}
        </Text>
        {!!f.shared && (
          <View style={styles.sharedBadge}>
            <Users size={12} color={colors.brand} />
            <Text style={[type.tiny, { color: colors.brand }]}>Shared with you</Text>
          </View>
        )}
        <View style={styles.heroButtons}>
          <Button title="Shuffle" icon={<Shuffle size={18} color="#fff" />} onPress={() => a.playFolder(f, true)} style={{ flex: 1 }} disabled={!total} />
          <Button title="Play" variant="secondary" icon={<Play size={18} color={colors.brand} fill={colors.brand} />} onPress={() => a.playFolder(f)} style={{ flex: 1 }} disabled={!total} />
        </View>
        {total > 0 && (
          <Pressable
            style={styles.offline}
            onPress={() => (f.auto_download ? a.folderMenu(f) : (DownloadManager.downloadFolder(f.id), a.toast('Downloading for offline')))}
            accessibilityLabel={f.auto_download ? 'Offline settings' : 'Download for offline'}
          >
            <CloudDownload size={16} color={downloaded === total ? colors.ok : colors.brand} />
            <Text style={[type.caption, { color: colors.text }]}>
              {downloaded === total ? 'All songs available offline' : f.auto_download ? `Downloaded ${downloaded} of ${total}` : 'Download for offline'}
            </Text>
            {!!f.auto_download && downloaded < total && (
              <View style={styles.progress}>
                <View style={[styles.progressFill, { width: `${(downloaded / total) * 100}%` }]} />
              </View>
            )}
          </Pressable>
        )}
      </Animated.View>

      {!!subfolders.data?.length && (
        <View style={{ marginTop: 8 }}>
          <SectionHeader title="Folders" style={styles.pad} />
          {subfolders.data.map((sf) => (
            <FolderRow key={sf.id} folder={sf} onPress={() => navigate('Folder', { id: sf.id })} onMore={() => a.folderMenu(sf)} />
          ))}
        </View>
      )}

      <View style={[styles.songsHeader, styles.pad]}>
        <Text style={type.h3}>Songs</Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          {own && f.sort_mode === 'custom' && list.length > 1 && (
            <Pressable onPress={startReorder} hitSlop={8}>
              <Text style={type.link}>Edit order</Text>
            </Pressable>
          )}
          <Pressable onPress={() => a.chooseSort(f)} style={styles.sortBtn} hitSlop={8} accessibilityLabel={`Sort: ${SORT_LABELS[f.sort_mode]}`}>
            <Text style={type.link}>{SORT_LABELS[f.sort_mode]}</Text>
            <ArrowDownUp size={14} color={colors.brand} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const empty = tracks.loading ? null : (
    <Empty
      icon={<SquarePlay size={28} color={colors.brand} />}
      title={own ? 'Add your first songs' : 'No songs here yet'}
      body={own ? 'Save from YouTube, import files from your phone, or move songs here from another folder.' : 'Your admin has not added music to this folder yet.'}
      action={
        own && (
          <View style={{ gap: 10, marginTop: 12, alignSelf: 'stretch' }}>
            <Button title="Add from YouTube" icon={<SquarePlay size={18} color="#fff" />} onPress={() => a.addFromYouTube(id)} />
            <Button title="Import from phone" variant="secondary" icon={<Upload size={18} color={colors.text} />} onPress={() => a.importFiles(id)} />
            <Button title="New subfolder" variant="ghost" icon={<FolderPlus size={18} color={colors.brand} />} onPress={() => a.newFolder(id)} />
          </View>
        )
      }
    />
  );

  return (
    <View style={styles.root}>
      {selecting ? (
        <View style={[styles.selectBar, { paddingTop: insets.top + 8 }]}>
          <IconButton label="Cancel selection" onPress={() => setSelected(new Set())}>
            <X size={22} color={colors.text} />
          </IconButton>
          <Text style={[type.h3, { flex: 1 }]}>{selected.size} selected</Text>
          <Pressable onPress={() => setSelected(new Set(list.map((t) => t.item_id)))} hitSlop={8} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <CheckCheck size={18} color={colors.brand} />
            <Text style={type.link}>All</Text>
          </Pressable>
        </View>
      ) : reordering ? (
        <View style={[styles.selectBar, { paddingTop: insets.top + 8 }]}>
          <IconButton label="Cancel" onPress={() => setReordering(false)}>
            <X size={22} color={colors.text} />
          </IconButton>
          <Text style={[type.h3, { flex: 1 }]}>Drag to reorder</Text>
          <Pressable onPress={saveOrder} hitSlop={8}>
            <Text style={[type.link, { fontSize: 15 }]}>Done</Text>
          </Pressable>
        </View>
      ) : (
        <Header
          back
          right={
            <IconButton label="Folder options" onPress={() => a.folderMenu(f, { onDeleted: () => nav.goBack() })}>
              <EllipsisVertical size={22} color={colors.text} />
            </IconButton>
          }
        />
      )}

      {reordering ? (
        <DraggableFlatList
          data={order}
          keyExtractor={(t) => String(t.item_id)}
          onDragEnd={({ data }) => setOrder(data)}
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item, drag, isActive }) => (
            <ScaleDecorator activeScale={1.03}>
              <SongRow
                track={item}
                onPress={() => {}}
                onLongPress={drag}
                selecting={false}
                leading={
                  <Pressable onPressIn={drag} hitSlop={10} accessibilityLabel="Drag handle">
                    <GripVertical size={20} color={isActive ? colors.brand : colors.faint} />
                  </Pressable>
                }
              />
            </ScaleDecorator>
          )}
        />
      ) : (
        <FlatList
          refreshControl={refreshControl}
          data={list}
          keyExtractor={(t) => String(t.item_id)}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={{ paddingBottom: selecting ? 140 : 170 }}
          initialNumToRender={14}
          renderItem={({ item, index }) => (
            <SongRow
              track={item}
              isCurrent={item.id === current}
              isPlaying={isPlaying}
              selecting={selecting}
              selected={selected.has(item.item_id)}
              onPress={() => tap(index)}
              onLongPress={own ? () => toggleSelect(item.item_id) : undefined}
              onMore={() => a.songMenu(item, { itemId: item.item_id, folder: f })}
            />
          )}
        />
      )}

      <FloatingDock hidden={selecting || reordering} />
      {selecting && (
        <Animated.View entering={FadeInUp.springify().damping(18)} style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
          <BarAction icon={<FolderInput size={22} color={colors.text} />} label="Move" onPress={moveSelected} />
          <BarAction icon={<Copy size={22} color={colors.text} />} label="Add to" onPress={copySelected} />
          <BarAction icon={<Trash2 size={22} color={colors.danger} />} label="Remove" onPress={removeSelected} danger />
        </Animated.View>
      )}
    </View>
  );
}

function BarAction({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.barAction, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      {icon}
      <Text style={[styles.barLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 20 },
  hero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 8, gap: 6 },
  heroArt: { marginBottom: 14, shadowColor: colors.brand, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  heroButtons: { flexDirection: 'row', gap: 14, alignSelf: 'stretch', marginTop: 16 },
  sharedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brandSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 4 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch', marginTop: 14, backgroundColor: colors.surface, borderRadius: 14, padding: 12 },
  progress: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden', marginLeft: 4 },
  progressFill: { height: 4, backgroundColor: colors.brand },
  songsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 6 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8, backgroundColor: colors.bg },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  barAction: { flex: 1, alignItems: 'center', gap: 4 },
  barLabel: { fontFamily: font.medium, fontSize: 12, color: colors.text },
});

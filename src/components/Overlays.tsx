import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CloudDownload,
  CloudOff,
  Disc3,
  FolderInput,
  FolderPlus,
  Heart,
  Info,
  ListEnd,
  ListPlus,
  ListStart,
  Share2,
  Trash2,
  UserRound,
} from 'lucide-react-native';
import Artwork from './Artwork';
import { colors, font, formatBytes, formatTime, radius, type } from '../theme';
import {
  copyTracks,
  createFolder,
  displayArtist,
  getAllFolders,
  isFavorite,
  moveItems,
  removeItems,
  toggleFavorite,
} from '../data/library';
import type { Folder, Track } from '../data/library';
import Player from '../services/PlayerService';
import DownloadManager from '../services/DownloadManager';
import { navigate } from '../navigation/ref';

// ---------- generic sheet ----------

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View entering={SlideInDown.springify().damping(20).stiffness(180)} style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetItem({ icon, label, onPress, danger, right }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean; right?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surface2 }]} accessibilityRole="button">
      {icon}
      <Text style={[styles.itemText, danger && { color: colors.danger }]}>{label}</Text>
      {right}
    </Pressable>
  );
}

// ---------- context ----------

interface SongMenuContext {
  itemId?: number;
  folder?: Folder | null;
}

interface Overlays {
  toast: (msg: string) => void;
  confirm: (o: { title: string; message?: string; confirm?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (o: { title: string; placeholder?: string; initial?: string; confirm?: string; hint?: string }) => Promise<string | null>;
  pickFolder: (o: { title: string; excludeIds?: number[]; allowRoot?: boolean }) => Promise<number | null | undefined>;
  songMenu: (t: Track, ctx?: SongMenuContext) => void;
  choose: <T extends string>(o: { title: string; options: { value: T; label: string }[]; selected?: T }) => Promise<T | null>;
  actions: (o: { title: string; subtitle?: string; header?: React.ReactNode; items: ActionItem[] }) => void;
}

export interface ActionItem {
  label: string;
  icon: React.ReactNode;
  onPress: () => unknown;
  danger?: boolean;
}

const Ctx = createContext<Overlays | null>(null);

export function useOverlays() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOverlays outside provider');
  return v;
}

type Pending<T> = { resolve: (v: T) => void } | null;

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [confirmState, setConfirm] = useState<{ title: string; message?: string; confirm?: string; danger?: boolean } | null>(null);
  const confirmP = useRef<Pending<boolean>>(null);

  const [promptState, setPrompt] = useState<{ title: string; placeholder?: string; initial?: string; confirm?: string; hint?: string } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const promptP = useRef<Pending<string | null>>(null);

  const [pickState, setPick] = useState<{ title: string; excludeIds?: number[]; allowRoot?: boolean; folders: Folder[] } | null>(null);
  const pickP = useRef<Pending<number | null | undefined>>(null);

  const [menu, setMenu] = useState<{ track: Track; ctx: SongMenuContext; fav: boolean } | null>(null);
  const [details, setDetails] = useState<Track | null>(null);

  const [chooseState, setChoose] = useState<{ title: string; options: { value: string; label: string }[]; selected?: string } | null>(null);
  const chooseP = useRef<Pending<string | null>>(null);

  const [actionState, setActions] = useState<{ title: string; subtitle?: string; header?: React.ReactNode; items: ActionItem[] } | null>(null);
  const actions = useCallback<Overlays['actions']>((o) => setActions(o), []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const confirm = useCallback<Overlays['confirm']>(
    (o) =>
      new Promise((resolve) => {
        confirmP.current = { resolve };
        setConfirm(o);
      }),
    [],
  );

  const prompt = useCallback<Overlays['prompt']>(
    (o) =>
      new Promise((resolve) => {
        promptP.current = { resolve };
        setPromptValue(o.initial ?? '');
        setPrompt(o);
      }),
    [],
  );

  const pickFolder = useCallback<Overlays['pickFolder']>(
    (o) =>
      new Promise(async (resolve) => {
        pickP.current = { resolve };
        const folders = (await getAllFolders()).filter((f) => !f.shared);
        setPick({ ...o, folders });
      }),
    [],
  );

  const choose = useCallback(
    (o: { title: string; options: { value: string; label: string }[]; selected?: string }) =>
      new Promise<string | null>((resolve) => {
        chooseP.current = { resolve };
        setChoose(o);
      }),
    [],
  ) as Overlays['choose'];

  const songMenu = useCallback((track: Track, ctx: SongMenuContext = {}) => {
    isFavorite(track.id).then((fav) => setMenu({ track, ctx, fav }));
  }, []);

  const value = useMemo(() => ({ toast, confirm, prompt, pickFolder, songMenu, choose, actions }), [toast, confirm, prompt, pickFolder, songMenu, choose, actions]);

  const closeConfirm = (v: boolean) => {
    confirmP.current?.resolve(v);
    confirmP.current = null;
    setConfirm(null);
  };
  const closePrompt = (v: string | null) => {
    promptP.current?.resolve(v);
    promptP.current = null;
    setPrompt(null);
  };
  const closePick = (v: number | null | undefined) => {
    pickP.current?.resolve(v);
    pickP.current = null;
    setPick(null);
  };
  const closeChoose = (v: string | null) => {
    chooseP.current?.resolve(v);
    chooseP.current = null;
    setChoose(null);
  };

  // Folder list shown as an indented tree.
  const tree = useMemo(() => {
    if (!pickState) return [];
    const excluded = new Set(pickState.excludeIds ?? []);
    const out: { f: Folder; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      pickState.folders
        .filter((f) => f.parent_id === parent && !excluded.has(f.id))
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .forEach((f) => {
          out.push({ f, depth });
          walk(f.id, depth + 1);
        });
    };
    walk(null, 0);
    return out;
  }, [pickState]);

  const runMenu = (fn: () => Promise<unknown> | void) => async () => {
    setMenu(null);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const m = menu;
  const ownItem = !!(m?.ctx.itemId && m.ctx.folder && !m.ctx.folder.shared);

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* song actions */}
      <Sheet visible={!!m} onClose={() => setMenu(null)}>
        {m && (
          <>
            <View style={styles.menuHeader}>
              <Artwork seed={m.track.remote_id ?? m.track.id} coverFile={m.track.cover_file} size={56} radius={14} />
              <View style={{ flex: 1 }}>
                <Text style={type.h3} numberOfLines={1}>
                  {m.track.title}
                </Text>
                <Text style={type.caption} numberOfLines={1}>
                  {displayArtist(m.track)}
                  {m.track.duration_ms ? `  |  ${formatTime(m.track.duration_ms / 1000)} mins` : ''}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                accessibilityLabel={m.fav ? 'Remove from favorites' : 'Add to favorites'}
                onPress={async () => {
                  const fav = await toggleFavorite(m.track.id);
                  setMenu({ ...m, fav });
                }}
              >
                <Heart size={24} color={m.fav ? colors.brand : colors.muted} fill={m.fav ? colors.brand : 'transparent'} />
              </Pressable>
            </View>
            <View style={styles.divider} />
            <ScrollView style={{ maxHeight: 460 }}>
              <SheetItem icon={<ListStart size={20} color={colors.text} />} label="Play Next" onPress={runMenu(async () => (await Player.playNext(m.track), toast('Plays next')))} />
              <SheetItem icon={<ListEnd size={20} color={colors.text} />} label="Add to Playing Queue" onPress={runMenu(async () => (await Player.addToQueue(m.track), toast('Added to queue')))} />
              <SheetItem
                icon={<ListPlus size={20} color={colors.text} />}
                label="Add to Folder"
                onPress={runMenu(async () => {
                  const target = await pickFolder({ title: 'Add to folder' });
                  if (target) toast((await copyTracks([m.track.id], target)) ? 'Added' : 'Already in that folder');
                })}
              />
              {ownItem && (
                <SheetItem
                  icon={<FolderInput size={20} color={colors.text} />}
                  label="Move to Folder"
                  onPress={runMenu(async () => {
                    const target = await pickFolder({ title: 'Move to', excludeIds: [m.ctx.folder!.id] });
                    if (target) {
                      await moveItems([m.ctx.itemId!], target);
                      toast('Moved');
                    }
                  })}
                />
              )}
              {!!m.track.album && (
                <SheetItem icon={<Disc3 size={20} color={colors.text} />} label="Go to Album" onPress={runMenu(() => navigate('Collection', { kind: 'album', name: m.track.album }))} />
              )}
              <SheetItem
                icon={<UserRound size={20} color={colors.text} />}
                label="Go to Artist"
                onPress={runMenu(() => navigate('Collection', { kind: 'artist', name: displayArtist(m.track) }))}
              />
              {m.track.download_state === 'done' ? (
                m.track.remote_id ? (
                  <SheetItem icon={<CloudOff size={20} color={colors.text} />} label="Remove Download" onPress={runMenu(async () => (await DownloadManager.removeTrackDownload(m.track.id), toast('Download removed')))} />
                ) : null
              ) : (
                <SheetItem
                  icon={<CloudDownload size={20} color={colors.text} />}
                  label="Download"
                  onPress={runMenu(async () => {
                    toast('Downloading…');
                    await DownloadManager.downloadTrack(m.track.id);
                    toast('Downloaded');
                  })}
                />
              )}
              <SheetItem icon={<Info size={20} color={colors.text} />} label="Details" onPress={runMenu(() => setDetails(m.track))} />
              <SheetItem
                icon={<Share2 size={20} color={colors.text} />}
                label="Share"
                onPress={runMenu(() => Share.share({ message: `${m.track.title} — ${displayArtist(m.track)}` }))}
              />
              {ownItem && (
                <SheetItem
                  danger
                  icon={<Trash2 size={20} color={colors.danger} />}
                  label={`Remove from "${m.ctx.folder!.name}"`}
                  onPress={runMenu(async () => {
                    if (await confirm({ title: 'Remove song?', message: `"${m.track.title}" will be removed from this folder on all your devices.`, confirm: 'Remove', danger: true })) {
                      await removeItems([m.ctx.itemId!]);
                    }
                  })}
                />
              )}
            </ScrollView>
          </>
        )}
      </Sheet>

      {/* generic actions */}
      <Sheet visible={!!actionState} onClose={() => setActions(null)}>
        {actionState && (
          <>
            <View style={styles.menuHeader}>
              {actionState.header}
              <View style={{ flex: 1 }}>
                <Text style={type.h3} numberOfLines={1}>
                  {actionState.title}
                </Text>
                {actionState.subtitle && <Text style={type.caption}>{actionState.subtitle}</Text>}
              </View>
            </View>
            <View style={styles.divider} />
            <ScrollView style={{ maxHeight: 480 }}>
              {actionState.items.map((it) => (
                <SheetItem
                  key={it.label}
                  icon={it.icon}
                  label={it.label}
                  danger={it.danger}
                  onPress={async () => {
                    setActions(null);
                    try {
                      await it.onPress();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
              ))}
            </ScrollView>
          </>
        )}
      </Sheet>

      {/* details */}
      <Sheet visible={!!details} onClose={() => setDetails(null)}>
        {details && (
          <View style={{ paddingHorizontal: 24, gap: 12, paddingBottom: 8 }}>
            <Text style={type.h2}>Details</Text>
            {[
              ['Title', details.title],
              ['Artist', displayArtist(details)],
              ['Album', details.album || '—'],
              ['Length', details.duration_ms ? formatTime(details.duration_ms / 1000) : '—'],
              ['Size', details.size_bytes ? formatBytes(details.size_bytes) : '—'],
              ['Source', details.source === 'youtube' ? 'YouTube' : 'Upload'],
              ['On this device', details.download_state === 'done' ? 'Yes' : 'No — streams when online'],
              ['In the cloud', details.remote_id ? 'Yes' : details.upload_state === 'error' ? 'Upload failed' : 'Uploading soon'],
            ].map(([k, v]) => (
              <View key={k} style={styles.detailRow}>
                <Text style={type.caption}>{k}</Text>
                <Text style={[type.bodyMedium, { flex: 1, textAlign: 'right' }]} numberOfLines={2}>
                  {v}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Sheet>

      {/* folder picker */}
      <Sheet visible={!!pickState} onClose={() => closePick(undefined)}>
        {pickState && (
          <>
            <Text style={[type.h2, { paddingHorizontal: 24, marginBottom: 8 }]}>{pickState.title}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <SheetItem
                icon={<FolderPlus size={20} color={colors.brand} />}
                label="New folder"
                onPress={async () => {
                  const pending = pickP.current;
                  pickP.current = null;
                  setPick(null);
                  const name = await prompt({ title: 'New folder', placeholder: 'Folder name', confirm: 'Create' });
                  let id: number | undefined;
                  if (name) {
                    try {
                      id = await createFolder(name, null);
                    } catch (e) {
                      toast(e instanceof Error ? e.message : String(e));
                    }
                  }
                  pending?.resolve(id);
                }}
              />
              {pickState.allowRoot && <SheetItem icon={<FolderInput size={20} color={colors.muted} />} label="Top level" onPress={() => closePick(null)} />}
              {tree.map(({ f, depth }) => (
                <Pressable key={f.id} onPress={() => closePick(f.id)} style={({ pressed }) => [styles.item, { paddingLeft: 24 + depth * 20 }, pressed && { backgroundColor: colors.surface2 }]}>
                  <Artwork seed={f.id} kind="folder" size={32} radius={9} />
                  <Text style={styles.itemText} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={type.caption}>{f.track_count}</Text>
                </Pressable>
              ))}
              {!tree.length && <Text style={[type.caption, { paddingHorizontal: 24, paddingVertical: 12 }]}>No folders yet — create one above.</Text>}
            </ScrollView>
          </>
        )}
      </Sheet>

      {/* chooser */}
      <Sheet visible={!!chooseState} onClose={() => closeChoose(null)}>
        {chooseState && (
          <>
            <Text style={[type.h2, { paddingHorizontal: 24, marginBottom: 8 }]}>{chooseState.title}</Text>
            {chooseState.options.map((o) => (
              <Pressable key={o.value} onPress={() => closeChoose(o.value)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surface2 }]}>
                <Text style={[styles.itemText, o.value === chooseState.selected && { color: colors.brand }]}>{o.label}</Text>
                <View style={[styles.radio, o.value === chooseState.selected && { borderColor: colors.brand }]}>
                  {o.value === chooseState.selected && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            ))}
          </>
        )}
      </Sheet>

      {/* prompt */}
      <Sheet visible={!!promptState} onClose={() => closePrompt(null)}>
        {promptState && (
          <View style={{ paddingHorizontal: 24, gap: 14 }}>
            <Text style={type.h2}>{promptState.title}</Text>
            <TextInput
              autoFocus
              value={promptValue}
              onChangeText={setPromptValue}
              placeholder={promptState.placeholder}
              placeholderTextColor={colors.faint}
              style={styles.input}
              selectionColor={colors.brand}
              onSubmitEditing={() => promptValue.trim() && closePrompt(promptValue.trim())}
              returnKeyType="done"
              autoCapitalize="sentences"
            />
            {promptState.hint && <Text style={type.caption}>{promptState.hint}</Text>}
            <View style={styles.actions}>
              <ActionButton label="Cancel" onPress={() => closePrompt(null)} />
              <ActionButton label={promptState.confirm ?? 'Save'} primary disabled={!promptValue.trim()} onPress={() => closePrompt(promptValue.trim())} />
            </View>
          </View>
        )}
      </Sheet>

      {/* confirm */}
      <Sheet visible={!!confirmState} onClose={() => closeConfirm(false)}>
        {confirmState && (
          <View style={{ paddingHorizontal: 24, gap: 10 }}>
            <Text style={type.h2}>{confirmState.title}</Text>
            {confirmState.message && <Text style={[type.body, { color: colors.muted, lineHeight: 21 }]}>{confirmState.message}</Text>}
            <View style={[styles.actions, { marginTop: 8 }]}>
              <ActionButton label="Cancel" onPress={() => closeConfirm(false)} />
              <ActionButton label={confirmState.confirm ?? 'OK'} primary danger={confirmState.danger} onPress={() => closeConfirm(true)} />
            </View>
          </View>
        )}
      </Sheet>

      {toastMsg && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(200)} style={styles.toast} pointerEvents="none">
          <Text style={[type.bodyMedium, { textAlign: 'center' }]}>{toastMsg}</Text>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

function ActionButton({ label, onPress, primary, danger, disabled }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionBtn,
        primary && { backgroundColor: danger ? colors.danger : colors.brand },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.actionText, !primary && { color: colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingVertical: 13 },
  itemText: { flex: 1, fontFamily: font.medium, fontSize: 15, color: colors.text },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingBottom: 14 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: 24, marginBottom: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  input: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.brand,
    paddingHorizontal: 16,
    color: colors.text,
    fontFamily: font.regular,
    fontSize: 15,
  },
  actions: { flexDirection: 'row', gap: 12, paddingBottom: 6 },
  actionBtn: { flex: 1, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  actionText: { fontFamily: font.semibold, fontSize: 15, color: '#fff' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 150,
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
});


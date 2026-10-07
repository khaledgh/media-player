import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { CloudDownload, HardDrive, LogOut, Moon, RefreshCw, Server, Timer, UserRound, Wifi } from 'lucide-react-native';
import Header from '../components/Header';
import { useOverlays } from '../components/Overlays';
import { useLibrary } from '../hooks/useLibrary';
import { useSession } from '../store/SessionStore';
import SyncService, { useSyncStatus } from '../services/SyncService';
import DownloadManager, { useDownloadStatus } from '../services/DownloadManager';
import Player, { usePlayer } from '../services/PlayerService';
import { api } from '../services/ApiClient';
import { getStorageStats } from '../data/library';
import { colors, font, formatBytes, radius, type } from '../theme';
import { BOTTOM_SPACE } from './Home';

const SLEEP_OPTIONS = [0, 15, 30, 45, 60, 90];

export default function Settings() {
  const o = useOverlays();
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const sync = useSyncStatus();
  const wifiOnly = useDownloadStatus((s) => s.wifiOnly);
  const queued = useDownloadStatus((s) => s.queued);
  const sleepAt = usePlayer((s) => s.sleepAt);
  const storage = useLibrary(() => getStorageStats(), []);
  const st = storage.data;

  async function chooseSleep() {
    const v = await o.choose({
      title: 'Sleep timer',
      selected: sleepAt ? 'keep' : '0',
      options: SLEEP_OPTIONS.map((m) => ({ value: String(m), label: m ? `${m} minutes` : 'Off' })),
    });
    if (v !== null && v !== 'keep') {
      Player.setSleepTimer(Number(v));
      o.toast(Number(v) ? `Music stops in ${v} minutes` : 'Sleep timer off');
    }
  }

  async function clearDownloads() {
    if (
      await o.confirm({
        title: 'Remove all downloads?',
        message: 'Frees space on this device. Your music stays in the cloud and streams when online. Auto-download is turned off for every folder.',
        confirm: 'Remove',
        danger: true,
      })
    ) {
      await DownloadManager.clearAll();
      o.toast('Downloads removed');
    }
  }

  async function signOut() {
    console.log('[settings] sign out tapped');
    if (!(await o.confirm({ title: 'Sign out?', message: 'Your downloads stay on this device for when you sign in again.', confirm: 'Sign out' }))) return;
    // Signing out unmounts the overlays; let the confirm sheet finish closing first
    // or Android leaves the dismissing Modal stuck over the login screen.
    await new Promise((r) => setTimeout(r, 400));
    await logout();
  }

  const lastSync = sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'never';
  const sleepLabel = sleepAt ? `Stops at ${new Date(sleepAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Off';

  return (
    <View style={styles.root}>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_SPACE, gap: 22 }}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || user?.email || '?')[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>{user?.name || user?.email?.split('@')[0]}</Text>
            <Text style={type.caption}>{user?.email}</Text>
          </View>
        </View>

        <Group title="Sync">
          <Row icon={<RefreshCw size={20} color={colors.brand} />} label="Sync now" value={sync.syncing ? 'Syncing…' : sync.offline ? 'Offline' : `Last: ${lastSync}`} onPress={() => SyncService.run()} />
          <Row icon={<Server size={20} color={colors.brand} />} label="Server" value={api.server?.replace(/^https?:\/\//, '') ?? ''} />
          {!!sync.error && <Text style={[type.caption, { color: colors.danger, paddingHorizontal: 16, paddingBottom: 12 }]}>{sync.error}</Text>}
        </Group>

        <Group title="Downloads">
          <Row
            icon={<Wifi size={20} color={colors.brand} />}
            label="Download on Wi‑Fi only"
            right={<Switch value={wifiOnly} onValueChange={(v) => DownloadManager.setWifiOnly(v)} trackColor={{ true: colors.brand, false: colors.line }} thumbColor="#fff" />}
          />
          <Row icon={<CloudDownload size={20} color={colors.brand} />} label="Offline songs" value={st ? `${st.count} of ${st.total}${queued ? ` · ${queued} waiting` : ''}` : ''} />
          <Row icon={<HardDrive size={20} color={colors.brand} />} label="Storage used" value={st ? formatBytes(st.bytes) : ''} />
          <Row icon={<CloudDownload size={20} color={colors.danger} />} label="Remove all downloads" danger onPress={clearDownloads} />
        </Group>

        <Group title="Playback">
          <Row icon={<Timer size={20} color={colors.brand} />} label="Sleep timer" value={sleepLabel} onPress={chooseSleep} />
          <Row icon={<Moon size={20} color={colors.brand} />} label="Lock screen controls" value="On" />
        </Group>

        <Group title="Account">
          <Row icon={<UserRound size={20} color={colors.brand} />} label="Signed in as" value={user?.role === 'admin' ? 'Admin' : 'Listener'} />
          <Row icon={<LogOut size={20} color={colors.danger} />} label="Sign out" danger onPress={signOut} />
        </Group>

        <Text style={[type.tiny, { textAlign: 'center' }]}>Mume {Constants.expoConfig?.version ?? ''}</Text>
      </ScrollView>
    </View>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[type.caption, { fontFamily: font.medium, marginLeft: 4 }]}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function Row({ icon, label, value, onPress, right, danger }: { icon: React.ReactNode; label: string; value?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}>
      {icon}
      <Text style={[type.bodyMedium, { flex: 1 }, danger && { color: colors.danger }]}>{label}</Text>
      {value ? (
        <Text style={[type.caption, { maxWidth: '50%' }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.semibold, fontSize: 20, color: colors.brand },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 15 },
});

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AlertCircle, CloudDownload, CloudOff, SquarePlay, Wifi, X } from 'lucide-react-native';
import { useDownloadStatus } from '../services/DownloadManager';
import { useSyncStatus } from '../services/SyncService';
import YouTubeService, { useYouTubeJobs } from '../services/YouTubeService';
import { colors, font } from '../theme';

/** One compact line about background work: YouTube jobs, downloads, offline state. */
export default function StatusBanner() {
  const jobs = useYouTubeJobs((s) => s.jobs);
  const active = useDownloadStatus((s) => s.active);
  const queued = useDownloadStatus((s) => s.queued);
  const waitingForWifi = useDownloadStatus((s) => s.waitingForWifi);
  const offline = useSyncStatus((s) => s.offline);
  const firstSync = useSyncStatus((s) => s.firstSyncDone);
  const syncing = useSyncStatus((s) => s.syncing);

  const failed = jobs.find((j) => j.status === 'error');
  const running = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const done = jobs.find((j) => j.status === 'done');

  let content: React.ReactNode = null;
  if (failed) {
    content = (
      <Row icon={<AlertCircle size={16} color={colors.danger} />} text={`YouTube download failed: ${failed.error?.split('\n')[0] ?? 'unknown error'}`}>
        <Pressable hitSlop={10} onPress={() => YouTubeService.dismiss(failed.id)} accessibilityLabel="Dismiss">
          <X size={16} color={colors.muted} />
        </Pressable>
      </Row>
    );
  } else if (running.length) {
    content = (
      <Row icon={<ActivityIndicator size="small" color={colors.brand} />} text={`Getting ${running.length > 1 ? `${running.length} videos` : 'audio'} from YouTube…`} />
    );
  } else if (done) {
    content = <Row icon={<SquarePlay size={16} color={colors.ok} />} text={`Added to "${done.folderName}"`} />;
  } else if (!firstSync && syncing) {
    content = <Row icon={<ActivityIndicator size="small" color={colors.brand} />} text="Setting up your library…" />;
  } else if (active.length) {
    const p = active.reduce((s, a) => s + a.progress, 0) / active.length;
    content = (
      <Row icon={<CloudDownload size={16} color={colors.brand} />} text={`Downloading ${active.length + queued} song${active.length + queued === 1 ? '' : 's'} for offline`}>
        <Text style={styles.pct}>{Math.round(p * 100)}%</Text>
      </Row>
    );
  } else if (queued && waitingForWifi) {
    content = <Row icon={<Wifi size={16} color={colors.muted} />} text={`${queued} songs will download on Wi‑Fi`} />;
  } else if (offline) {
    content = <Row icon={<CloudOff size={16} color={colors.muted} />} text="Offline — your downloaded music still plays" />;
  }

  if (!content) return null;
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.wrap}>
      {content}
    </Animated.View>
  );
}

function Row({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      {icon}
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 12, marginBottom: 6, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  text: { flex: 1, fontFamily: font.medium, fontSize: 12, color: colors.text },
  pct: { fontFamily: font.semibold, fontSize: 12, color: colors.brand },
});

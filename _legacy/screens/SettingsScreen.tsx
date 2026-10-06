import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Switch, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Server, Moon, RotateCcw, ChevronRight, Check } from 'lucide-react-native';
import { useSettingsStore } from '../store/SettingsStore';
import AudioPlayerService from '../services/AudioPlayerService';
import * as Haptics from 'expo-haptics';

const SLEEP_OPTIONS = [0, 15, 30, 45, 60, 90] as const;

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { serverUrl, setServerUrl, sleepTimerMinutes, setSleepTimerMinutes } = useSettingsStore();
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [urlSaved, setUrlSaved] = useState(false);

  const handleSaveUrl = async () => {
    await setServerUrl(urlInput);
    setUrlSaved(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setUrlSaved(false), 2000);
  };

  const handleSleepTimer = async (minutes: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSleepTimerMinutes(minutes);
    if (minutes > 0) {
      AudioPlayerService.startSleepTimer(minutes);
      Alert.alert('Sleep Timer', `Playback will stop in ${minutes} minutes.`);
    } else {
      AudioPlayerService.clearSleepTimer();
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 160 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Settings</Text>

      {/* Server URL */}
      <Section title="Backend Server" icon={<Server color="#7c3aed" size={18} />}>
        <Text style={styles.label}>YouTube Download Server URL</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="https://your-server.com"
            placeholderTextColor="#475569"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity
            style={[styles.saveBtn, urlSaved && styles.saveBtnDone]}
            onPress={handleSaveUrl}
            activeOpacity={0.8}
          >
            {urlSaved
              ? <Check color="#fff" size={16} />
              : <Text style={styles.saveTxt}>Save</Text>
            }
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          Default: https://yt.linksbridge.top
        </Text>
      </Section>

      {/* Sleep Timer */}
      <Section title="Sleep Timer" icon={<Moon color="#f59e0b" size={18} />}>
        <Text style={styles.label}>Auto-pause after</Text>
        <View style={styles.sleepGrid}>
          {SLEEP_OPTIONS.map(min => (
            <TouchableOpacity
              key={min}
              style={[styles.sleepChip, sleepTimerMinutes === min && styles.sleepChipActive]}
              onPress={() => handleSleepTimer(min)}
              activeOpacity={0.7}
            >
              <Text style={[styles.sleepTxt, sleepTimerMinutes === min && styles.sleepTxtActive]}>
                {min === 0 ? 'Off' : `${min}m`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {sleepTimerMinutes > 0 && (
          <TouchableOpacity style={styles.cancelTimer} onPress={() => handleSleepTimer(0)}>
            <RotateCcw color="#ef4444" size={14} style={{ marginRight: 6 }} />
            <Text style={styles.cancelTimerTxt}>Cancel timer</Text>
          </TouchableOpacity>
        )}
      </Section>

      {/* About */}
      <Section title="About" icon={<ChevronRight color="#64748b" size={18} />}>
        <InfoRow label="App Version" value="1.0.0" />
        <InfoRow label="Platform" value={Platform.OS === 'android' ? 'Android' : 'iOS'} />
      </Section>
    </ScrollView>
  );
};

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050510' },
  heading: { fontSize: 28, color: '#fff', fontWeight: '800', marginBottom: 24, paddingHorizontal: 20 },
  section: { marginBottom: 28, marginHorizontal: 16 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 14, color: '#94a3b8', fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionBody: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 16,
    gap: 12,
  },
  label: { color: '#94a3b8', fontSize: 13, fontWeight: '500' },
  hint: { color: '#475569', fontSize: 11, marginTop: 4 },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  saveBtnDone: { backgroundColor: '#059669' },
  saveTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sleepGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sleepChip: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sleepChipActive: {
    backgroundColor: 'rgba(245,158,11,0.2)',
    borderColor: '#f59e0b',
  },
  sleepTxt: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  sleepTxtActive: { color: '#f59e0b' },
  cancelTimer: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  cancelTimerTxt: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { color: '#94a3b8', fontSize: 14 },
  infoValue: { color: '#64748b', fontSize: 14, fontWeight: '500' },
});

export default SettingsScreen;

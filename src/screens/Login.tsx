import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Eye, EyeOff, Lock, Mail, Music2, Server } from 'lucide-react-native';
import { Button } from '../components/ui';
import { api, ApiError, OfflineError } from '../services/ApiClient';
import { useSession } from '../store/SessionStore';
import { colors, font, radius, type } from '../theme';

export default function Login() {
  const insets = useSafeAreaInsets();
  const login = useSession((s) => s.login);
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.lastServer().then(setServer);
  }, []);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await login(server, email.trim(), password);
    } catch (e) {
      if (e instanceof OfflineError) setError(`Cannot reach ${server}. Check your connection or the server address.`);
      else if (e instanceof ApiError && e.status === 401) setError('Wrong email or password.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.logoRow}>
          <View style={styles.logo}>
            <Music2 size={22} color="#fff" />
          </View>
          <Text style={styles.brand}>Mume</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80)} style={{ gap: 6, marginBottom: 32 }}>
          <Text style={type.h1}>Welcome back</Text>
          <Text style={type.caption}>Sign in to get your music on this device.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160)} style={{ gap: 14 }}>
          <Field icon={<Mail size={18} color={colors.muted} />}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.faint}
              style={styles.input}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              selectionColor={colors.brand}
              returnKeyType="next"
            />
          </Field>
          <Field icon={<Lock size={18} color={colors.muted} />}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.faint}
              style={styles.input}
              secureTextEntry={!show}
              autoComplete="password"
              selectionColor={colors.brand}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Pressable onPress={() => setShow(!show)} hitSlop={10} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={18} color={colors.muted} /> : <Eye size={18} color={colors.muted} />}
            </Pressable>
          </Field>

          <Pressable onPress={() => setAdvanced(!advanced)} style={styles.advanced} hitSlop={6}>
            <Text style={type.caption}>Server</Text>
            <ChevronDown size={14} color={colors.muted} style={{ transform: [{ rotate: advanced ? '180deg' : '0deg' }] }} />
          </Pressable>
          {advanced && (
            <Field icon={<Server size={18} color={colors.muted} />}>
              <TextInput
                value={server}
                onChangeText={setServer}
                placeholder="https://music.example.com"
                placeholderTextColor={colors.faint}
                style={styles.input}
                autoCapitalize="none"
                keyboardType="url"
                selectionColor={colors.brand}
              />
            </Field>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Button title="Sign in" loading={busy} disabled={!email || !password || !server} onPress={submit} style={{ marginTop: 8 }} />
          <Text style={[type.caption, { textAlign: 'center', marginTop: 8 }]}>Accounts are created by your administrator.</Text>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      {icon}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 28 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 48 },
  logo: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: font.semibold, fontSize: 24, color: colors.text },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
  },
  input: { flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, height: '100%' },
  advanced: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  error: { fontFamily: font.medium, fontSize: 13, color: colors.danger, backgroundColor: 'rgba(240,82,90,0.1)', padding: 12, borderRadius: radius.md },
});

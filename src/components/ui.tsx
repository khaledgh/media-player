import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PressableProps, StyleProp, TextStyle, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, font, radius, type } from '../theme';

export function haptic() {
  Haptics.selectionAsync().catch(() => {});
}

export function Button({
  title,
  icon,
  variant = 'primary',
  loading,
  style,
  onPress,
  disabled,
  ...rest
}: PressableProps & { title: string; icon?: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; loading?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = variant === 'primary' ? colors.brand : variant === 'secondary' ? colors.surface2 : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      disabled={disabled || loading}
      onPress={(e) => {
        haptic();
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        variant === 'primary' && styles.glow,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : icon}
      <Text style={[styles.buttonText, variant === 'ghost' && { color: colors.brand }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ children, label, onPress, style, size = 40 }: { children: React.ReactNode; label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; size?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={type.h3}>{title}</Text>
      {action && (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text style={type.link}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>{icon}</View>
      <Text style={[type.h3, { textAlign: 'center' }]}>{title}</Text>
      {body && <Text style={[type.caption, { textAlign: 'center', maxWidth: 280, lineHeight: 18 }]}>{body}</Text>}
      {action}
    </View>
  );
}

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
      <Text style={[type.caption, { color: active ? '#fff' : colors.muted, fontFamily: font.medium }]}>{label}</Text>
    </Pressable>
  );
}

export function T({ style, children, numberOfLines, variant = 'body' }: { style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number; variant?: keyof typeof type }) {
  return (
    <Text style={[type[variant], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: radius.pill,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  glow: {
    shadowColor: colors.brand,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonText: { fontFamily: font.semibold, fontSize: 15, color: '#fff' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 10 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
});

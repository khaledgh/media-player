import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FolderOpen, Heart, House, Settings } from 'lucide-react-native';
import MiniPlayer from './MiniPlayer';
import StatusBanner from './StatusBanner';
import { haptic } from './ui';
import { colors, font } from '../theme';

const ICONS = { Home: House, Favorites: Heart, Library: FolderOpen, Settings } as const;
const LABELS = { Home: 'Home', Favorites: 'Favorites', Library: 'Folders', Settings: 'Settings' } as const;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.container}>
      <StatusBanner />
      <MiniPlayer />
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const Icon = ICONS[route.name as keyof typeof ICONS];
          const label = LABELS[route.name as keyof typeof LABELS];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !e.defaultPrevented) {
                  haptic();
                  navigation.navigate(route.name);
                }
              }}
              style={styles.tab}
            >
              <Icon size={22} color={focused ? colors.brand : colors.faint} fill={focused && route.name === 'Favorites' ? colors.brand : 'transparent'} />
              <Text style={[styles.label, { color: focused ? colors.brand : colors.faint }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontFamily: font.medium, fontSize: 11 },
});

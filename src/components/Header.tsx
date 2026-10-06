import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Music2, Search } from 'lucide-react-native';
import { IconButton } from './ui';
import { colors, font } from '../theme';
import { navigate } from '../navigation/ref';

/** App header: brand + search on tab screens, back arrow + title on pushed screens. */
export default function Header({ title, back, right }: { title?: string; back?: boolean; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      {back ? (
        <IconButton label="Back" onPress={() => nav.goBack()} style={{ marginLeft: -8 }}>
          <ArrowLeft size={24} color={colors.text} />
        </IconButton>
      ) : (
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Music2 size={16} color="#fff" />
          </View>
          <Text style={styles.brandText}>Mume</Text>
        </View>
      )}
      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={styles.right}>
        {right}
        {!back && (
          <IconButton label="Search" onPress={() => navigate('Search')}>
            <Search size={22} color={colors.text} />
          </IconButton>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, gap: 8, backgroundColor: colors.bg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: font.semibold, fontSize: 20, color: colors.text },
  title: { flex: 1, fontFamily: font.semibold, fontSize: 18, color: colors.text },
  right: { flexDirection: 'row', alignItems: 'center', marginRight: -8 },
});

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomePlaceholder() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>Discover</Text>
        <View style={s.card}>
          <Text style={s.cardText}>New releases coming soon...</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050510' },
  content: { padding: 20 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', marginBottom: 20 },
  card: { 
    height: 200, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    borderRadius: 20, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  cardText: { color: '#64748b', fontWeight: '600' }
});

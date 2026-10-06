import React, { useRef, useState } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudDownload, FolderHeart, Headphones } from 'lucide-react-native';
import { Button } from '../components/ui';
import { colors, font } from '../theme';

const { width } = Dimensions.get('window');

const SLIDES = [
  { icon: Headphones, title: 'Your music, beautifully organised', body: 'Folders you control. Sort, move and play everything in a tap.' },
  { icon: CloudDownload, title: 'Always with you, even offline', body: 'Your library downloads to every device you sign in on — automatically.' },
  { icon: FolderHeart, title: 'Listen to the best audio & music with Mume now!', body: 'Save songs from YouTube straight into any folder.' },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  const next = () => (index < SLIDES.length - 1 ? list.current?.scrollToIndex({ index: index + 1 }) : onDone());

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + 24 }]}>
      <FlatList
        ref={list}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        keyExtractor={(s) => s.title}
        renderItem={({ item, index: i }) => <Slide {...item} index={i} top={insets.top} />}
      />
      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View key={s.title} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <Button title={index === SLIDES.length - 1 ? 'Get Started' : 'Next'} onPress={next} style={{ alignSelf: 'stretch' }} />
      </View>
    </View>
  );
}

function Slide({ icon: Icon, title, body, index, top }: (typeof SLIDES)[number] & { index: number; top: number }) {
  return (
    <View style={{ width, flex: 1 }}>
      <View style={[styles.hero, { paddingTop: top + 30 }]}>
        {[
          [0.12, 0.1, 14],
          [0.82, 0.16, 10],
          [0.2, 0.62, 8],
          [0.88, 0.58, 16],
          [0.55, 0.06, 7],
        ].map(([x, y, s], i) => (
          <Animated.View
            key={i}
            entering={ZoomIn.delay(150 + i * 70)}
            style={[styles.bubble, { left: width * x, top: (top + 300) * y + top, width: s * 2, height: s * 2, borderRadius: s }]}
          />
        ))}
        <Animated.View entering={ZoomIn.springify().damping(14).delay(index * 40)}>
          <LinearGradient colors={['#FF9A3F', '#E0620A']} style={styles.circle}>
            <Icon size={96} color="#fff" strokeWidth={1.4} />
          </LinearGradient>
        </Animated.View>
      </View>
      <Animated.View entering={FadeInUp.delay(200)} style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Animated.Text entering={FadeIn.delay(350)} style={styles.body}>
          {body}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bubble: { position: 'absolute', backgroundColor: colors.brand },
  circle: { width: 230, height: 230, borderRadius: 115, alignItems: 'center', justifyContent: 'center' },
  card: { paddingHorizontal: 32, paddingTop: 24, paddingBottom: 12, gap: 12 },
  title: { fontFamily: font.semibold, fontSize: 26, lineHeight: 36, color: colors.text, textAlign: 'center' },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center' },
  footer: { paddingHorizontal: 32, gap: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotActive: { width: 22, backgroundColor: colors.brand },
});

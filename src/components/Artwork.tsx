import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Folder as FolderIcon, Music2, User } from 'lucide-react-native';
import { absPath } from '../data/db';
import { artGradient, colors } from '../theme';

interface Props {
  seed: string | number;
  coverFile?: string | null;
  size: number;
  radius?: number;
  kind?: 'track' | 'artist' | 'folder';
  style?: StyleProp<ViewStyle>;
}

/** Cover art, or a deterministic gradient placeholder when a song has none. */
function Artwork({ seed, coverFile, size, radius = 12, kind = 'track', style }: Props) {
  const r = kind === 'artist' ? size / 2 : radius;
  const uri = absPath(coverFile);
  if (kind === 'folder') {
    return (
      <View style={[{ width: size, height: size, borderRadius: r, backgroundColor: colors.brand }, styles.center, style]}>
        <FolderIcon size={size * 0.48} color="#fff" fill="rgba(255,255,255,0.9)" strokeWidth={1.5} />
      </View>
    );
  }
  if (uri) {
    return <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: r }, style as object]} contentFit="cover" transition={150} recyclingKey={uri} />;
  }
  const [a, b] = artGradient(seed);
  const Icon = kind === 'artist' ? User : Music2;
  return (
    <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ width: size, height: size, borderRadius: r }, styles.center, style]}>
      <Icon size={size * 0.38} color="rgba(255,255,255,0.85)" strokeWidth={1.75} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });

export default memo(Artwork);

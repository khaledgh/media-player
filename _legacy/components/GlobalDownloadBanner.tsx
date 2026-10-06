import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated as RNAnimated, TouchableOpacity } from 'react-native';
import { useDownloadStore } from '../store/DownloadStore';
import { Download, X } from 'lucide-react-native';

const GlobalDownloadBanner: React.FC = () => {
  const { isDownloading, progress, itemName, error, reset } = useDownloadStore();
  const animatedWidth = useRef(new RNAnimated.Value(0)).current;
  const slideAnim = useRef(new RNAnimated.Value(-80)).current;

  useEffect(() => {
    if (isDownloading) {
      RNAnimated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else if (!error) {
      // Slide out after a short delay
      const timer = setTimeout(() => {
        RNAnimated.timing(slideAnim, {
          toValue: -80,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }, progress >= 1 ? 1500 : 0);
      return () => clearTimeout(timer);
    }
  }, [isDownloading, progress, error]);

  useEffect(() => {
    RNAnimated.timing(animatedWidth, {
      toValue: progress,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  if (!isDownloading && !error && progress < 1) return null;

  const pct = Math.round(progress * 100);

  return (
    <RNAnimated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Download color="#a78bfa" size={18} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {error ? 'Download Failed' : progress >= 1 ? '✓ Downloaded!' : `Downloading ${pct}%`}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {error || itemName}
          </Text>
        </View>
        {(error || progress >= 1) && (
          <TouchableOpacity onPress={reset} style={styles.closeBtn}>
            <X color="#6b7280" size={16} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.progressTrack}>
        <RNAnimated.View
          style={[
            styles.progressFill,
            {
              width: animatedWidth.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
            error ? styles.progressError : null,
          ]}
        />
      </View>
    </RNAnimated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(17, 17, 30, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(167, 139, 250, 0.15)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#a78bfa',
    borderRadius: 2,
  },
  progressError: {
    backgroundColor: '#f87171',
  },
});

export default GlobalDownloadBanner;

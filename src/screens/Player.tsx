import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Dimensions, StyleSheet } from 'react-native';
import { usePlaylistStore } from '../store/PlaylistStore';
import AudioPlayerService from '../services/AudioPlayerService';
import { Play, Pause, SkipBack, SkipForward, X, Volume2, Repeat, Shuffle } from 'lucide-react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withRepeat,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';

interface PlayerProps {
    onClose: () => void;
}

const { width } = Dimensions.get('window');

const Music = ({ color, size }: { color: string; size: number }) => {
    return <Text style={{ color, fontSize: size }}>♪</Text>;
};

const Player: React.FC<PlayerProps> = ({ onClose }) => {
    const { currentTrack, currentPlaylist, setCurrentTrack } = usePlaylistStore();
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState({ position: 0, duration: 0 });

    const insets = useSafeAreaInsets();

    const scale = useSharedValue(0.8);
    const rotation = useSharedValue(0);
    const pulseScale = useSharedValue(1);
    const titleY = useSharedValue(0);

    useEffect(() => {
        // Animate in
        scale.value = withSpring(1, { damping: 10 });

        const handlePlaybackStateChange = (state: any) => {
            setIsPlaying(state.isPlaying);
        };

        const handleProgressUpdate = (progressData: any) => {
            setProgress(progressData);
        };

        AudioPlayerService.addEventListener('playbackStateChanged', handlePlaybackStateChange);
        AudioPlayerService.addEventListener('progressUpdate', handleProgressUpdate);

        const state = AudioPlayerService.getState();
        setIsPlaying(state.isPlaying);
        setProgress({ position: state.position, duration: state.duration });

        return () => {
            AudioPlayerService.removeEventListener('playbackStateChanged', handlePlaybackStateChange);
            AudioPlayerService.removeEventListener('progressUpdate', handleProgressUpdate);
        };
    }, []);

    useEffect(() => {
        if (isPlaying) {
            scale.value = withSpring(1, { damping: 10 });
            rotation.value = withRepeat(
                withTiming(360, { duration: 10000, easing: Easing.linear }),
                -1, false
            );
            pulseScale.value = withRepeat(
                withTiming(1.05, { duration: 1000 }),
                -1, true
            );
            titleY.value = withRepeat(
                withTiming(-5, { duration: 1500 }),
                -1, true
            );
        } else {
            scale.value = withSpring(0.9, { damping: 10 });
            rotation.value = withTiming(0, { duration: 500 });
            pulseScale.value = withTiming(1, { duration: 300 });
            titleY.value = withTiming(0, { duration: 300 });
        }
    }, [isPlaying]);

    const containerAnimStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
        opacity: scale.value,
    }));

    const discAnimStyle = useAnimatedStyle(() => ({
        transform: [
            { rotate: `${rotation.value}deg` },
            { scale: pulseScale.value },
        ],
    }));

    const titleAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: titleY.value }],
    }));

    const togglePlayback = () => {
        if (isPlaying) {
            AudioPlayerService.pause();
        } else {
            AudioPlayerService.play();
        }
    };

    const handleSkipNext = async () => {
        if (!currentTrack || currentPlaylist.length <= 1) return;
        const currentIndex = currentPlaylist.findIndex(t => t.id === currentTrack.id);
        const nextIndex = (currentIndex + 1) % currentPlaylist.length;
        const nextTrack = currentPlaylist[nextIndex];
        
        setCurrentTrack(nextTrack);
        await AudioPlayerService.reset();
        await AudioPlayerService.loadTrack({
            id: nextTrack.id.toString(),
            url: nextTrack.local_uri,
            title: nextTrack.name,
            artist: 'Local Library'
        });
        AudioPlayerService.play();
    };

    const handleSkipPrevious = async () => {
        if (!currentTrack || currentPlaylist.length <= 1) return;
        const currentIndex = currentPlaylist.findIndex(t => t.id === currentTrack.id);
        const prevIndex = (currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
        const prevTrack = currentPlaylist[prevIndex];
        
        setCurrentTrack(prevTrack);
        await AudioPlayerService.reset();
        await AudioPlayerService.loadTrack({
            id: prevTrack.id.toString(),
            url: prevTrack.local_uri,
            title: prevTrack.name,
            artist: 'Local Library'
        });
        AudioPlayerService.play();
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progressPercent = progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0;

    return (
        <View style={[st.container, { paddingTop: Math.max(insets.top, 32), paddingBottom: Math.max(insets.bottom, 32) }]}>
            <View style={st.topBar}>
                <Text style={st.nowPlaying}>NOW PLAYING</Text>
                <TouchableOpacity onPress={onClose} style={st.closeBtn}>
                    <X color="white" size={24} />
                </TouchableOpacity>
            </View>

            {/* Visualizer/Art Area */}
            <View style={st.artArea}>
                <Animated.View style={[st.artBox, containerAnimStyle]}>
                    <Animated.View style={[st.disc, discAnimStyle]}>
                        <Music color="white" size={60} />
                    </Animated.View>
                </Animated.View>
            </View>

            {/* Song Info */}
            <View style={st.songInfo}>
                <Animated.Text style={[st.songTitle, titleAnimStyle]} numberOfLines={2}>
                    {currentTrack?.name || 'Local File'}
                </Animated.Text>
                <Text style={st.songArtist}>SonicGroup Library</Text>
            </View>
            {/* Progress Bar */}
            <View style={st.progressSection}>
                <Slider
                    style={st.slider}
                    minimumValue={0}
                    maximumValue={progress.duration || 1}
                    value={progress.position}
                    onSlidingComplete={async (val) => {
                        await AudioPlayerService.seekTo(val);
                    }}
                    minimumTrackTintColor="#2563eb"
                    maximumTrackTintColor="rgba(255,255,255,0.1)"
                    thumbTintColor="#2563eb"
                />
                <View style={st.progressTimeContainer}>
                    <Text style={st.timeText}>{formatTime(progress.position)}</Text>
                    <Text style={st.timeText}>{formatTime(progress.duration)}</Text>
                </View>
            </View>

            {/* Controls */}
            <View style={st.controls}>
                <TouchableOpacity style={st.secondaryBtn}>
                    <Shuffle color="#444" size={24} />
                </TouchableOpacity>

                <View style={st.mainControls}>
                    <TouchableOpacity onPress={handleSkipPrevious} style={st.skipBtn}>
                        <SkipBack color="white" size={32} />
                    </TouchableOpacity>

                    <TouchableOpacity onPress={togglePlayback} style={st.playBtn}>
                        {isPlaying ? <Pause color="white" size={40} fill="white" /> : <Play color="white" size={40} fill="white" />}
                    </TouchableOpacity>

                    <TouchableOpacity onPress={handleSkipNext} style={st.skipBtn}>
                        <SkipForward color="white" size={32} />
                    </TouchableOpacity>
                </View>

                <TouchableOpacity style={st.secondaryBtn}>
                    <Repeat color="#444" size={24} />
                </TouchableOpacity>
            </View>

            <View style={st.footer}>
                <View style={st.footerContent}>
                    <Volume2 color="#666" size={16} />
                    <Text style={st.footerText}>HIGH FIDELITY AUDIO</Text>
                </View>
            </View>
        </View>
    );
};

const st = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        paddingHorizontal: 32,
    },
    topBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 32,
    },
    nowPlaying: {
        color: '#6b7280',
        fontWeight: 'bold',
        fontSize: 12,
        letterSpacing: 4,
    },
    closeBtn: {
        padding: 8,
        backgroundColor: '#111827',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#1f2937',
    },
    artArea: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
    },
    artBox: {
        width: '100%',
        height: width - 64,
        backgroundColor: '#111827',
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#1f2937',
    },
    disc: {
        width: 192,
        height: 192,
        backgroundColor: '#2563eb',
        borderRadius: 96,
        alignItems: 'center',
        justifyContent: 'center',
    },
    songInfo: {
        marginBottom: 32,
        alignItems: 'center',
        height: 80,
    },
    songTitle: {
        fontSize: 24,
        fontWeight: '900',
        color: '#fff',
        textAlign: 'center',
        marginBottom: 8,
    },
    songArtist: {
        color: '#3b82f6',
        fontWeight: 'bold',
        opacity: 0.75,
    },
    progressSection: {
        marginBottom: 32,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    progressTimeContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 12,
    },
    timeText: {
        color: '#6b7280',
        fontSize: 12,
        fontWeight: 'bold',
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    secondaryBtn: {
        padding: 12,
        backgroundColor: 'rgba(17,24,39,0.5)',
        borderRadius: 999,
    },
    mainControls: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    skipBtn: {
        padding: 12,
    },
    playBtn: {
        width: 80,
        height: 80,
        backgroundColor: '#2563eb',
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 4,
        borderColor: '#000',
    },
    footer: {
        marginTop: 'auto',
        alignItems: 'center',
    },
    footerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        opacity: 0.4,
    },
    footerText: {
        color: '#4b5563',
        fontSize: 10,
        marginLeft: 8,
        fontWeight: 'bold',
        letterSpacing: 4,
    },
});

export default Player;

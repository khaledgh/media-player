import React, { useEffect, useState } from 'react';
import { Platform, PermissionsAndroid, StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import { useFonts } from 'expo-font';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { OverlayProvider } from './src/components/Overlays';
import TabBar from './src/components/TabBar';
import Onboarding from './src/screens/Onboarding';
import Login from './src/screens/Login';
import Home from './src/screens/Home';
import Favorites from './src/screens/Favorites';
import Library from './src/screens/Library';
import Settings from './src/screens/Settings';
import FolderDetail from './src/screens/FolderDetail';
import Collection from './src/screens/Collection';
import SongList from './src/screens/SongList';
import Search from './src/screens/Search';
import PlayerScreen from './src/screens/PlayerScreen';
import { useSession } from './src/store/SessionStore';
import Player from './src/services/PlayerService';
import { navigationRef } from './src/navigation/ref';
import type { RootStackParams, TabParams } from './src/navigation/ref';
import { colors } from './src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator<TabParams>();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, primary: colors.brand, text: colors.text, border: colors.line },
};

function TabsScreen() {
  return (
    <Tabs.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="Home" component={Home} />
      <Tabs.Screen name="Favorites" component={Favorites} />
      <Tabs.Screen name="Library" component={Library} />
      <Tabs.Screen name="Settings" component={Settings} />
    </Tabs.Navigator>
  );
}

const ONBOARDED = 'mume.onboarded';

export default function App() {
  const [fontsLoaded] = useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold });
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      setOnboarded((await SecureStore.getItemAsync(ONBOARDED).catch(() => null)) === '1');
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
      }
      await Player.init().catch((e) => console.warn('[player] setup failed', e));
      await restore().catch((e) => {
        console.warn('[session] restore failed', e);
        useSession.setState({ status: 'signedOut' });
      });
    })();
  }, [restore]);

  const ready = fontsLoaded && onboarded !== null && status !== 'loading';
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} translucent />
      {!onboarded ? (
        <Onboarding
          onDone={() => {
            SecureStore.setItemAsync(ONBOARDED, '1').catch(() => {});
            setOnboarded(true);
          }}
        />
      ) : status !== 'ready' ? (
        <Login />
      ) : (
        <OverlayProvider>
          <NavigationContainer ref={navigationRef} theme={theme}>
            <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
              <Stack.Screen name="Tabs" component={TabsScreen} />
              <Stack.Screen name="Folder" component={FolderDetail} />
              <Stack.Screen name="Collection" component={Collection} />
              <Stack.Screen name="Songs" component={SongList} />
              <Stack.Screen name="Search" component={Search} options={{ animation: 'fade' }} />
              <Stack.Screen name="Player" component={PlayerScreen} options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', gestureEnabled: true }} />
            </Stack.Navigator>
          </NavigationContainer>
        </OverlayProvider>
      )}
    </GestureHandlerRootView>
  );
}

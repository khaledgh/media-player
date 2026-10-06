import { createNavigationContainerRef } from '@react-navigation/native';

export type RootStackParams = {
  Tabs: undefined;
  Folder: { id: number };
  Collection: { kind: 'artist' | 'album'; name: string };
  Player: undefined;
  Search: undefined;
  Recent: undefined;
  Songs: { title: string; source: 'most' | 'recent' };
};

export type TabParams = {
  Home: undefined;
  Favorites: undefined;
  Library: undefined;
  Settings: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParams>();

export function navigate<K extends keyof RootStackParams>(name: K, params?: RootStackParams[K]) {
  if (navigationRef.isReady()) (navigationRef.navigate as (n: K, p?: RootStackParams[K]) => void)(name, params);
}

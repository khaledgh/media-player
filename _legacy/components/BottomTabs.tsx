import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Home, Library, Settings, Search } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

interface BottomTabsProps {
  activeTab: string;
  onTabPress: (tab: string) => void;
}

const BottomTabs: React.FC<BottomTabsProps> = ({ activeTab, onTabPress }) => {
  const insets = useSafeAreaInsets();

  const tabs = [
    { id: 'home', label: 'Home', Icon: Home },
    { id: 'library', label: 'Library', Icon: Library },
    { id: 'search', label: 'Search', Icon: Search },
    { id: 'settings', label: 'Settings', Icon: Settings },
  ];

  return (
    <View style={[s.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={s.content}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={s.tab}
              onPress={() => onTabPress(tab.id)}
              activeOpacity={0.7}
            >
              <View style={[s.iconBox, isActive && s.iconBoxActive]}>
                <tab.Icon 
                  size={22} 
                  color={isActive ? '#fff' : '#64748b'} 
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </View>
              <Text style={[s.label, isActive && s.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#050510',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  content: {
    flexDirection: 'row',
    height: 60,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: width / 4,
  },
  iconBox: {
    width: 40,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  iconBoxActive: {
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 2,
  },
  labelActive: {
    color: '#fff',
  },
});

export default BottomTabs;

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FolderPlus, SquarePlay } from 'lucide-react-native';
import Header from '../components/Header';
import { IconButton, Pill } from '../components/ui';
import { useActions } from '../hooks/useActions';
import { colors } from '../theme';
import { Folders } from './Home';

/** Folders tab: your folders and the ones shared with you. */
export default function Library() {
  const a = useActions();
  const [shared, setShared] = useState(false);
  return (
    <View style={styles.root}>
      <Header
        title="Folders"
        right={
          <>
            <IconButton label="Add from YouTube" onPress={() => a.addFromYouTube()}>
              <SquarePlay size={22} color={colors.text} />
            </IconButton>
            <IconButton label="New folder" onPress={() => a.newFolder(null)}>
              <FolderPlus size={22} color={colors.text} />
            </IconButton>
          </>
        }
      />
      <View style={styles.pills}>
        <Pill label="My folders" active={!shared} onPress={() => setShared(false)} />
        <Pill label="Shared folders" active={shared} onPress={() => setShared(true)} />
      </View>
      <Folders shared={shared} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pills: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 6 },
});

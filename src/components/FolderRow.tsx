import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EllipsisVertical, Users } from 'lucide-react-native';
import Artwork from './Artwork';
import { colors, font } from '../theme';
import type { Folder } from '../data/library';

function FolderRow({ folder, onPress, onMore, onLongPress, active }: { folder: Folder; onPress: () => void; onMore?: () => void; onLongPress?: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      accessibilityRole="button"
      accessibilityLabel={`Folder ${folder.name}, ${folder.track_count} songs`}
      style={({ pressed }) => [styles.row, (pressed || active) && { backgroundColor: colors.surface }]}
    >
      <Artwork seed={folder.id} kind="folder" size={52} radius={14} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1}>
          {folder.name}
        </Text>
        <View style={styles.metaRow}>
          {!!folder.shared && <Users size={12} color={colors.brand} />}
          <Text style={styles.meta} numberOfLines={1}>
            {folder.track_count} songs
            {folder.folder_count ? `  |  ${folder.folder_count} folder${folder.folder_count === 1 ? '' : 's'}` : ''}
            {folder.shared ? '  |  Shared' : ''}
          </Text>
        </View>
      </View>
      {onMore && (
        <Pressable onPress={onMore} hitSlop={12} accessibilityLabel={`Options for ${folder.name}`}>
          <EllipsisVertical size={20} color={colors.muted} />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 9 },
  name: { fontFamily: font.semibold, fontSize: 15, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  meta: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
});

export default memo(FolderRow);

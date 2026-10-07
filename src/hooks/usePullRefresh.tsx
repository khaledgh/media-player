import React, { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import SyncService from '../services/SyncService';
import { colors } from '../theme';

/** Pull-to-refresh for a list: runs a sync with the server and reloads from it. */
export function usePullRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await SyncService.run();
    } catch {
      // SyncService reports its own errors; just stop the spinner
    } finally {
      setRefreshing(false);
    }
  }, []);
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} progressBackgroundColor={colors.surface2} />;
}

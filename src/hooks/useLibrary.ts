import { useCallback, useEffect, useRef, useState } from 'react';
import { libraryEvents } from '../data/db';

/**
 * Runs a local-database query and re-runs it whenever the library changes
 * (local edits, sync, downloads). Keeps the previous data while refreshing.
 */
export function useLibrary<T>(query: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(query, deps);

  const reload = useCallback(() => {
    const id = ++seq.current;
    run()
      .then((d) => id === seq.current && setData(d))
      .catch((e) => console.warn('[library] query failed', e))
      .finally(() => id === seq.current && setLoading(false));
  }, [run]);

  useEffect(() => {
    reload();
    return libraryEvents.subscribe(reload);
  }, [reload]);

  return { data, loading, reload };
}

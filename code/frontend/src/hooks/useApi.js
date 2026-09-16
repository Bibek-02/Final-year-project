import { useState, useEffect, useCallback } from 'react';

/**
 * Extracts the loading/error/useEffect pattern duplicated across every
 * data-fetching page. `fetcher` is called on mount and whenever `deps`
 * changes (or `refetch()` is called); it should return a Promise
 * resolving to whatever shape the page wants (a single value, or an
 * object of several named results).
 */
export function useApi(fetcher, deps, errorMessage = 'Failed to load data.') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadIndex, setReloadIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(errorMessage);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadIndex]);

  const refetch = useCallback(() => setReloadIndex(i => i + 1), []);

  return { data, loading, error, refetch };
}

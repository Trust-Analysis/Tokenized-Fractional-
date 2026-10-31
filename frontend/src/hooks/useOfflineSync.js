import { useState, useEffect, useCallback, useRef } from 'react';
import {
  enqueueAction,
  getQueueStats,
  flushQueue,
  clearCompletedActions,
} from '../services/offlineQueue';
import { cacheQuery, getCachedQuery } from '../services/graphqlCache';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [queueStats, setQueueStats] = useState({ pending: 0, completed: 0, failed: 0, total: 0 });
  const [syncing, setSyncing] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      await processQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) return;

    intervalRef.current = setInterval(() => {
      updateStats();
    }, 10000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isOnline]);

  const updateStats = useCallback(async () => {
    try {
      const stats = await getQueueStats();
      setQueueStats(stats);
    } catch {
      // silently fail
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const executor = async (action) => {
        const response = await fetch(action.url, {
          method: action.method || 'POST',
          headers: { 'Content-Type': 'application/json', ...action.headers },
          body: action.body ? JSON.stringify(action.body) : undefined,
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
      };
      await flushQueue(executor);
      await clearCompletedActions();
      await updateStats();
    } catch (err) {
      console.error('[OfflineSync] Queue processing failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [syncing, updateStats]);

  const queueAction = useCallback(
    async (action) => {
      const id = await enqueueAction(action);
      await updateStats();
      return id;
    },
    [updateStats],
  );

  const cacheAndQueue = useCallback(async (cacheKey, queryData, action) => {
    await cacheQuery(cacheKey, queryData);
    if (!navigator.onLine) {
      await queueAction(action);
    }
  }, []);

  const getCached = useCallback(async (key) => getCachedQuery(key), []);

  return {
    isOnline,
    queueStats,
    syncing,
    processQueue,
    queueAction,
    cacheAndQueue,
    getCached,
    updateStats,
  };
}

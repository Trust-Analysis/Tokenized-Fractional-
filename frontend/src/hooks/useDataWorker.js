import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useDataWorker Hook
 * Manages Web Worker creation, task queuing, message passing, performance 
 * monitoring, and synchronous fallback for unsupported environments.
 */
export function useDataWorker() {
  const workerRef = useRef(null);
  const taskQueueRef = useRef(new Map());
  const [isSupported] = useState(typeof window !== 'undefined' && window.Worker !== undefined);
  const [workerStatus, setWorkerStatus] = useState('idle');

  useEffect(() => {
    if (!isSupported) return;

    try {
      workerRef.current = new Worker(
        new URL('../workers/dataProcessor.worker.js', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (e) => {
        const { taskId, success, result, error } = e.data;
        const task = taskQueueRef.current.get(taskId);

        if (task) {
          taskQueueRef.current.delete(taskId);
          if (success) {
            task.resolve(result);
          } else {
            task.reject(new Error(error));
          }
        }

        if (taskQueueRef.current.size === 0) {
          setWorkerStatus('idle');
        }
      };

      workerRef.current.onerror = (err) => {
        console.error('[WebWorker] Error encountered:', err);
        setWorkerStatus('error');
      };
    } catch (err) {
      console.warn('[WebWorker] Failed to initialize worker, falling back to main thread:', err);
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [isSupported]);

  const runTask = useCallback((type, payload) => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current || !isSupported) {
        try {
          let result;
          if (type === 'PROCESS_CHART_DATA') {
            const rawData = payload.data || [];
            const windowSize = payload.options?.movingAverageWindow || 5;
            result = rawData.map((item, index, arr) => {
              let movingAvg = null;
              if (index >= windowSize - 1) {
                const slice = arr.slice(index - windowSize + 1, index + 1);
                const sum = slice.reduce((acc, curr) => acc + Number(curr.price || curr.value || 0), 0);
                movingAvg = sum / windowSize;
              }
              return { ...item, movingAverage: movingAvg ? Number(movingAvg.toFixed(4)) : null };
            });
          } else if (type === 'CALCULATE_STATISTICS') {
            const values = (payload.data || []).map(d => Number(d.price || d.value || 0));
            const min = values.length ? Math.min(...values) : 0;
            const max = values.length ? Math.max(...values) : 0;
            const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            result = { min, max, mean, count: values.length };
          } else {
            result = payload.data;
          }
          resolve(result);
        } catch (fallbackErr) {
          reject(fallbackErr);
        }
        return;
      }

      setWorkerStatus('busy');
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      taskQueueRef.current.set(taskId, { resolve, reject });

      workerRef.current.postMessage({ taskId, type, payload });
    });
  }, [isSupported]);

  return { runTask, workerStatus, isSupported };
}

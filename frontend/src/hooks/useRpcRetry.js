import { useCallback, useState } from 'react';

/**
 * Resilient RPC calls with explicit timeouts and exponential backoff
 * (Issue #790).
 */
export function useRpcRetry() {
  const [rpcError, setRpcError] = useState('');
  const [isRpcRetrying, setIsRpcRetrying] = useState(false);

  const callRpcWithRetry = useCallback(async (rpcFn, maxRetries = 3, timeoutMs = 5000) => {
    setRpcError('');
    setIsRpcRetrying(false);

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('RPC Request Timeout')), timeoutMs);
        });

        // Race the RPC call against an explicit timeout.
        // eslint-disable-next-line no-await-in-loop -- retries are sequential by design
        return await Promise.race([rpcFn(), timeoutPromise]);
      } catch (err) {
        console.warn(`RPC Call failed (Attempt ${attempt}/${maxRetries}):`, err.message);

        if (attempt === maxRetries) {
          const isNetworkError =
            err.message.includes('Timeout') ||
            err.message.includes('NetworkError') ||
            err.message.includes('Failed to fetch');

          setRpcError(
            isNetworkError
              ? 'NETWORK_OUTAGE: The Soroban RPC endpoint is unresponsive or timing out. Please try again later.'
              : `CONTRACT_ERROR: ${err.message}`,
          );
          throw err;
        }

        setIsRpcRetrying(true);
        // Exponential backoff (500ms, 1000ms, 2000ms...).
        const backoffDelay = 2 ** (attempt - 1) * 500;
        // eslint-disable-next-line no-await-in-loop -- back off before the next attempt
        await new Promise((resolve) => {
          setTimeout(resolve, backoffDelay);
        });
      }
    }

    return undefined;
  }, []);

  const retryRpc = useCallback(async () => {
    try {
      await callRpcWithRetry(async () => true);
    } catch {
      // The error is surfaced through rpcError.
    }
  }, [callRpcWithRetry]);

  return { rpcError, isRpcRetrying, retryRpc };
}

export default useRpcRetry;

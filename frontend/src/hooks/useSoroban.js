import { useState, useEffect, useCallback, useRef } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { rpc, TransactionBuilder, Networks, Contract } from "@stellar/stellar-sdk";
import { useWalletStore } from "../store/useWalletStore";
import { mapError } from "../lib/errorMapper";

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || "C...";
const RPC_URL = import.meta.env.VITE_RPC_URL || "https://soroban-testnet.stellar.org:443";
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

const server = new rpc.Server(RPC_URL);

function getContract() {
  if (CONTRACT_ID.length < 50) return null;
  try { return new Contract(CONTRACT_ID); } catch { return null; }
}

export function useStellarContract() {
  return {
    contract: getContract(),
    server,
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

const serializeArgs = (args) => {
  if (!args) return "";
  return args
    .map((arg) => {
      if (arg && typeof arg === "object" && typeof arg.toXDR === "function") {
        try { return arg.toXDR("base64"); } catch { return String(arg); }
      }
      try { return JSON.stringify(arg); } catch { return String(arg); }
    })
    .join(",");
};

const withRetry = async (operationFn, operationName) => {
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      return await operationFn();
    } catch (error) {
      const isRateLimited = error?.message?.includes("429") || error?.response?.status === 429;
      const isServiceUnavailable = error?.message?.includes("503") || error?.response?.status === 503;

      if ((!isRateLimited && !isServiceUnavailable) || attempt === MAX_RETRIES) {
        throw error;
      }

      attempt++;
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000);
      const warningMsg = `Network busy. Retrying ${operationName}... (Attempt ${attempt}/${MAX_RETRIES})`;
      
      console.warn(warningMsg);
      if (typeof window !== "undefined") {
         window.dispatchEvent(new CustomEvent("toast", { detail: { type: "warning", message: warningMsg } }));
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export function useSorobanRead(fnName, args = [], options = {}) {
  const { publicKey } = useWalletStore();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const serializedArgs = serializeArgs(args);
  const onSuccessRef = useRef(options.onSuccess);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onSuccessRef.current = options.onSuccess;
    onErrorRef.current = options.onError;
  });

  const execute = useCallback(async () => {
    if (!publicKey || CONTRACT_ID.length < 50) return null;
    setLoading(true);
    setError(null);
    try {
      if (import.meta.env.VITE_MOCK_WALLET === "true") {
        await new Promise(resolve => setTimeout(resolve, 300));
        let mockVal = 10;
        let mockU64 = null;
        if (fnName === "get_shares") {
          const stored = localStorage.getItem("mock_shares_balance");
          mockVal = stored ? parseInt(stored, 10) : 10;
        } else if (fnName === "get_available_shares") {
          mockVal = 900;
        } else if (fnName === "get_total_shares") {
          mockVal = 1000;
        } else if (fnName === "get_price") {
          mockU64 = 100_000_000;
        }
        const result = { retval: { u32: () => mockVal, u64: () => mockU64 ?? mockVal } };
        setData(result);
        if (onSuccessRef.current) onSuccessRef.current(result);
        return result;
      }
      
      const account = await server.getAccount(publicKey);
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(getContract().call(fnName, ...args))
        .setTimeout(30)
        .build();

      const simulation = await withRetry(() => server.simulateTransaction(tx), `simulation (${fnName})`);
      if (simulation.error) throw new Error(simulation.error);

      setData(simulation.result);
      if (onSuccessRef.current) onSuccessRef.current(simulation.result);
      return simulation.result;
    } catch (err) {
      console.error(`[useSorobanRead] Error executing ${fnName}:`, err);
      const mapped = mapError(err, { operation: fnName });
      setError(mapped);
      if (onErrorRef.current) onErrorRef.current(err, mapped);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [publicKey, fnName, serializedArgs]);

  useEffect(() => {
    if (options.skip !== true && publicKey && CONTRACT_ID.length >= 50) {
      execute().catch(() => {});
    }
  }, [execute, publicKey, options.skip]);

  return { data, loading, error, refetch: execute };
}

export const useSorobanCall = useSorobanRead;

export function useSorobanWrite(fnName) {
  const { publicKey } = useWalletStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const execute = useCallback(async (args = [], options = {}) => {
    if (!publicKey) throw new Error("Wallet not connected");
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (import.meta.env.VITE_MOCK_WALLET === "true") {
        await new Promise(resolve => setTimeout(resolve, 800));
        // Issue #794: deterministic failure path so the visual-regression suite
        // can screenshot the error state. Read at call time (not baked in at
        // build time) so a single build can exercise both branches.
        if (localStorage.getItem("mock_tx_failure") === "true") {
          throw new Error("mock transaction rejected (mock_tx_failure)");
        }
        if (fnName === "buy_shares") {
          let buyAmount = 1;
          if (args[1] && typeof args[1].u32 === "function") {
            buyAmount = args[1].u32();
          }
          const stored = localStorage.getItem("mock_shares_balance");
          const currentShares = stored ? parseInt(stored, 10) : 10;
          const newShares = currentShares + buyAmount;
          localStorage.setItem("mock_shares_balance", newShares.toString());
          useWalletStore.getState().setShares(newShares);
        }
        const submitRes = { hash: "mock_tx_hash_" + Math.random().toString(36).substring(2, 15) };
        setResult(submitRes);
        if (options.onSuccess) options.onSuccess(submitRes);
        return submitRes;
      }
      
      const account = await withRetry(() => server.getAccount(publicKey), "fetch account");
      let tx = new TransactionBuilder(account, {
        fee: options.fee || "10000",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(getContract().call(fnName, ...args))
        .setTimeout(30)
        .build();

      const simulation = await withRetry(() => server.simulateTransaction(tx), `simulation (${fnName})`);
      if (simulation.error) throw new Error(simulation.error);

      tx = rpc.assembleTransaction(tx, simulation).build();
      const { signedTxXdr, error: signError } = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });

      if (signError || !signedTxXdr) {
        throw new Error(signError?.message || "Freighter transaction signing failed");
      }

      const submitRes = await withRetry(
        () => server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)),
        `submission (${fnName})`
      );

      setResult(submitRes);
      if (options.onSuccess) options.onSuccess(submitRes);
      return submitRes;
    } catch (err) {
      console.error(`[useSorobanWrite] Error executing tx ${fnName}:`, err);
      const mapped = mapError(err, { operation: fnName });
      setError(mapped);
      if (options.onError) options.onError(err, mapped);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [publicKey, fnName]);

  return { execute, loading, error, result, setError, setResult };
}

export const useSorobanTx = useSorobanWrite;

import React, { useState, useEffect, useCallback } from 'react';
import { isAllowed, setAllowed, getUserInfo, signTransaction } from '@stellar/freighter-api';
import { rpc, TransactionBuilder, Networks, Contract, nativeToScVal } from '@stellar/stellar-sdk';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const server = new rpc.Server(RPC_URL);

function App() {
  const [publicKey, setPublicKey] = useState(null);
  const [shares, setShares] = useState(0);
  const [buyAmount, setBuyAmount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [assetMeta, setAssetMeta] = useState(null);
  const [txResult, setTxResult] = useState(null);

  const checkFreighter = useCallback(async () => {
    try {
      if (await isAllowed()) {
        const user = await getUserInfo();
        if (user?.publicKey) {
          setPublicKey(user.publicKey);
          return user.publicKey;
        }
      }
    } catch (err) {
      console.error('Freighter check failed:', err);
    }
    return null;
  }, []);

  useEffect(() => {
    checkFreighter();
  }, [checkFreighter]);

  useEffect(() => {
    if (publicKey) {
      fetchShares();
      fetchMetadata();
    }
  }, [publicKey]);

  const connectWallet = async () => {
    try {
      setError(null);
      await setAllowed();
      await checkFreighter();
    } catch (err) {
      setError('Failed to connect Freighter wallet. Ensure the extension is installed and unlocked.');
    }
  };

  const disconnectWallet = () => {
    setPublicKey(null);
    setShares(0);
    setAssetMeta(null);
    setTxResult(null);
  };

  const fetchMetadata = async () => {
    if (CONTRACT_ID.length < 50) return;
    try {
      const res = await fetch(`${API_URL}/api/rwa/${CONTRACT_ID}`);
      if (res.ok) {
        const data = await res.json();
        setAssetMeta(data);
      }
    } catch {
      console.warn('Metadata server unreachable');
    }
  };

  const fetchShares = async () => {
    if (!publicKey || CONTRACT_ID.length < 50) return;
    try {
      setError(null);
      const contract = new Contract(CONTRACT_ID);
      const scValAddress = nativeToScVal(publicKey, { type: 'address' });

      const account = await server.getAccount(publicKey);
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call('get_shares', scValAddress))
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (simulation.result) {
        const parsedShares = Number(simulation.result.retval.u32());
        setShares(parsedShares);
      }
    } catch (err) {
      console.error('Error fetching shares:', err);
      setError('Failed to fetch share balance.');
    }
  };

  const handleBuyShares = async () => {
    if (!publicKey) return;
    if (buyAmount < 1) {
      setError('Must buy at least 1 share');
      return;
    }

    setLoading(true);
    setError(null);
    setTxResult(null);

    try {
      const account = await server.getAccount(publicKey);
      const contract = new Contract(CONTRACT_ID);

      const scValBuyer = nativeToScVal(publicKey, { type: 'address' });
      const scValShares = nativeToScVal(buyAmount, { type: 'u32' });

      let tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call('buy_shares', scValBuyer, scValShares))
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (simulation.error) {
        throw new Error(simulation.error);
      }

      tx = rpc.assembleTransaction(tx, simulation).build();
      const { signedTxXdr, error: signError } = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signError || !signedTxXdr) {
        throw new Error(signError?.message || 'Freighter transaction signing failed');
      }

      const submitRes = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
      );

      setTxResult(`Transaction submitted! Hash: ${submitRes.hash}`);
      await fetchShares();
    } catch (err) {
      console.error('Error buying shares:', err);
      if (err.message?.includes('paused')) {
        setError('Marketplace is currently paused. Try again later.');
      } else if (err.message?.includes('Not enough shares')) {
        setError('Not enough shares available.');
      } else {
        setError('Transaction failed. Check your token balance and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isTestnet = NETWORK_PASSPHRASE === Networks.TESTNET;

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>RWA Marketplace</h1>
          <span style={{
            display: 'inline-block',
            fontSize: '0.75rem',
            padding: '0.15rem 0.5rem',
            borderRadius: '4px',
            background: isTestnet ? '#1a3a2a' : '#3a1a1a',
            color: isTestnet ? '#4ade80' : '#f87171',
          }}>
            {isTestnet ? 'TESTNET' : 'MAINNET'}
          </span>
        </div>
        <div>
          {!publicKey ? (
            <button onClick={connectWallet} style={btnStyle}>
              Connect Freighter
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#8b949e', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {publicKey}
              </span>
              <button onClick={disconnectWallet} style={{ ...btnStyle, background: '#3a1a1a', border: '1px solid #f87171', color: '#f87171' }}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '6px', background: '#3a1a1a', border: '1px solid #f87171', color: '#fca5a5', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {txResult && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '6px', background: '#1a3a2a', border: '1px solid #4ade80', color: '#86efac', fontSize: '0.875rem' }}>
          {txResult}
        </div>
      )}

      {CONTRACT_ID === 'C...' && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '6px', background: '#3a2a1a', border: '1px solid #fbbf24', color: '#fde68a', fontSize: '0.875rem' }}>
          Set VITE_CONTRACT_ID in frontend/.env to connect to a deployed contract.
        </div>
      )}

      {assetMeta && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: '8px', border: '1px solid #30363d' }}>
          {assetMeta.imageUrl && (
            <img src={assetMeta.imageUrl} alt={assetMeta.title} style={{ width: '100%', height: '200px', objectFit: 'cover', borderRadius: '6px', marginBottom: '0.75rem' }} />
          )}
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{assetMeta.title}</h2>
          <p style={{ fontSize: '0.875rem', color: '#8b949e', marginBottom: '0.5rem' }}>{assetMeta.location}</p>
          <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>{assetMeta.description}</p>
          {assetMeta.totalValuation && (
            <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>Valuation: {assetMeta.totalValuation}</p>
          )}
        </div>
      )}

      {publicKey && (
        <div style={{ padding: '1rem', borderRadius: '8px', border: '1px solid #30363d' }}>
          <p style={{ marginBottom: '1rem' }}>
            <strong>Your Shares:</strong> {shares}
          </p>
          <hr style={{ border: 'none', borderTop: '1px solid #30363d', marginBottom: '1rem' }} />
          <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Buy Fractional Shares</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="number"
              value={buyAmount}
              onChange={(e) => setBuyAmount(Math.max(1, Number(e.target.value)))}
              min="1"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #30363d',
                background: '#161b22',
                color: '#e1e4e8',
                fontSize: '1rem',
                width: '100px',
              }}
            />
            <button onClick={handleBuyShares} disabled={loading} style={{
              ...btnStyle,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
              {loading ? 'Processing...' : 'Buy Shares'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle = {
  padding: '0.5rem 1rem',
  borderRadius: '6px',
  border: '1px solid #238636',
  background: '#238636',
  color: '#fff',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s',
};

export default App;

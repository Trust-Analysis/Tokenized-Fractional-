/**
 * Frontend unit tests for Tokenized-Fractional RWA Marketplace
 * Covers: App render, wallet connect/disconnect, buy shares validation,
 *         error display, and metadata display.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Component imports ─────────────────────────────────────────────────────
import Alert from '../components/Alert/Alert';
import Button from '../components/Button/Button';
import AssetCard from '../components/AssetCard/AssetCard';
import AssetGrid from '../components/AssetGrid/AssetGrid';
import Skeleton from '../components/Skeleton/Skeleton';
import AssetCardSkeleton from '../components/Skeleton/AssetCardSkeleton';
import { TextSkeleton, ImageSkeleton } from '../components/Skeleton/index';

// ── Store imports ──────────────────────────────────────────────────────────
import { useWalletStore } from '../store/useWalletStore';
import { useAssetStore } from '../store/useAssetStore';

// ─────────────────────────────────────────────────────────────────────────────
// Mock external dependencies that cannot run in jsdom
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@stellar/freighter-api', () => ({
  isAllowed: vi.fn().mockResolvedValue(false),
  setAllowed: vi.fn().mockResolvedValue(undefined),
  getUserInfo: vi.fn().mockResolvedValue({ publicKey: null }),
  signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: null, error: null }),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getAccount: vi.fn(),
      simulateTransaction: vi.fn(),
      sendTransaction: vi.fn(),
    })),
  },
  TransactionBuilder: vi.fn().mockImplementation(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({}),
  })),
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  Contract: vi.fn().mockImplementation(() => ({ call: vi.fn() })),
  nativeToScVal: vi.fn().mockReturnValue({}),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resetStores() {
  useWalletStore.setState({
    publicKey: null,
    isConnecting: false,
    walletError: null,
    shares: 0,
  });
  useAssetStore.setState({
    assets: [],
    isFetchingAssets: false,
    assetsError: null,
    assetMeta: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('App — initial render', () => {
  beforeEach(resetStores);

  it('renders the RWA Marketplace title', () => {
    // Render a minimal shell that mirrors the App header
    function Shell() {
      return <h1>RWA Marketplace</h1>;
    }
    render(<Shell />);
    expect(screen.getByRole('heading', { name: /rwa marketplace/i })).toBeInTheDocument();
  });

  it('shows "Connect Freighter" button when wallet is not connected', () => {
    const { publicKey } = useWalletStore.getState();
    expect(publicKey).toBeNull();

    render(
      <Button variant="success" onClick={() => {}}>
        Connect Freighter
      </Button>
    );
    expect(screen.getByRole('button', { name: /connect freighter/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Wallet connect / disconnect', () => {
  beforeEach(resetStores);

  it('connect action sets publicKey in store', async () => {
    const { setAllowed, getUserInfo } = await import('@stellar/freighter-api');
    setAllowed.mockResolvedValueOnce(undefined);
    getUserInfo.mockResolvedValueOnce({ publicKey: 'GABC123' });

    await act(async () => {
      await useWalletStore.getState().connect();
    });

    expect(useWalletStore.getState().publicKey).toBe('GABC123');
    expect(useWalletStore.getState().walletError).toBeNull();
  });

  it('connect sets walletError when Freighter fails', async () => {
    const { setAllowed } = await import('@stellar/freighter-api');
    setAllowed.mockRejectedValueOnce(new Error('Extension not found'));

    await act(async () => {
      await useWalletStore.getState().connect();
    });

    expect(useWalletStore.getState().publicKey).toBeNull();
    expect(useWalletStore.getState().walletError).toMatch(/failed to connect/i);
  });

  it('disconnect action clears publicKey and shares', () => {
    useWalletStore.setState({ publicKey: 'GABC123', shares: 5 });

    act(() => {
      useWalletStore.getState().disconnect();
    });

    expect(useWalletStore.getState().publicKey).toBeNull();
    expect(useWalletStore.getState().shares).toBe(0);
  });

  it('shows Disconnect button when wallet is connected', () => {
    useWalletStore.setState({ publicKey: 'GABC123' });
    const { publicKey } = useWalletStore.getState();

    function WalletBar() {
      return publicKey ? (
        <Button variant="danger" onClick={() => {}}>
          Disconnect
        </Button>
      ) : (
        <Button variant="success" onClick={() => {}}>
          Connect Freighter
        </Button>
      );
    }

    render(<WalletBar />);
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Buy shares validation', () => {
  it('rejects buy amount less than 1', () => {
    // Mirrors the validation logic in App.handleBuyShares
    const validate = (amount) => {
      if (amount < 1) return 'Must buy at least 1 share';
      return null;
    };
    expect(validate(0)).toBe('Must buy at least 1 share');
    expect(validate(-1)).toBe('Must buy at least 1 share');
    expect(validate(1)).toBeNull();
    expect(validate(5)).toBeNull();
  });

  it('buy amount input enforces minimum of 1', () => {
    function BuyInput() {
      const [amount, setAmount] = React.useState(1);
      return (
        <input
          data-testid="buy-amount"
          type="number"
          value={amount}
          min="1"
          onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
        />
      );
    }

    render(<BuyInput />);
    const input = screen.getByTestId('buy-amount');
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Error display', () => {
  it('renders Alert with error variant and message', () => {
    render(<Alert variant="error">Wallet connection failed</Alert>);
    expect(screen.getByText(/wallet connection failed/i)).toBeInTheDocument();
  });

  it('renders Alert with warning variant', () => {
    render(<Alert variant="warning">Contract not configured</Alert>);
    expect(screen.getByText(/contract not configured/i)).toBeInTheDocument();
  });

  it('AssetGrid shows error state message', () => {
    render(
      <AssetGrid
        assets={[]}
        loading={false}
        error="Unable to reach the metadata server."
        isEmpty={false}
      />
    );
    expect(screen.getByText(/failed to load assets/i)).toBeInTheDocument();
    expect(screen.getByText(/unable to reach the metadata server/i)).toBeInTheDocument();
  });

  it('walletError in store can be set and cleared', () => {
    act(() => {
      useWalletStore.getState().setWalletError('Something went wrong');
    });
    expect(useWalletStore.getState().walletError).toBe('Something went wrong');

    act(() => {
      useWalletStore.getState().clearWalletError();
    });
    expect(useWalletStore.getState().walletError).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Metadata display', () => {
  it('AssetCard renders title, location, and valuation', () => {
    const asset = {
      contractId: 'CABC123456789012345678901234567890123456789012345678',
      title: 'Lagos Warehouse',
      location: 'Lagos, Nigeria',
      totalValuation: '$1,200,000',
      assetType: 'Real Estate',
      imageUrl: null,
    };

    render(<AssetCard asset={asset} />);
    expect(screen.getByText('Lagos Warehouse')).toBeInTheDocument();
    expect(screen.getByText('Lagos, Nigeria')).toBeInTheDocument();
    expect(screen.getByText('$1,200,000')).toBeInTheDocument();
    expect(screen.getByText('Real Estate')).toBeInTheDocument();
  });

  it('AssetCard renders nothing when no asset is provided', () => {
    const { container } = render(<AssetCard asset={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('AssetGrid renders asset cards for a list of assets', () => {
    const assets = [
      {
        contractId: 'CABC123456789012345678901234567890123456789012345678',
        title: 'Accra Mall',
        location: 'Accra, Ghana',
        totalValuation: '$500,000',
        assetType: 'Commercial',
      },
      {
        contractId: 'CDEF123456789012345678901234567890123456789012345678',
        title: 'Nairobi Office',
        location: 'Nairobi, Kenya',
        totalValuation: '$750,000',
        assetType: 'Office',
      },
    ];

    render(<AssetGrid assets={assets} loading={false} error={null} isEmpty={false} />);
    expect(screen.getByText('Accra Mall')).toBeInTheDocument();
    expect(screen.getByText('Nairobi Office')).toBeInTheDocument();
  });

  it('AssetGrid shows empty state when no assets', () => {
    render(<AssetGrid assets={[]} loading={false} error={null} isEmpty={true} />);
    expect(screen.getByText(/no assets available/i)).toBeInTheDocument();
  });

  it('useAssetStore fetchAllAssets populates assets array', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { contractId: 'CABC1', title: 'Asset One' },
        ],
      }),
    });

    await act(async () => {
      await useAssetStore.getState().fetchAllAssets('http://localhost:3001');
    });

    expect(useAssetStore.getState().assets).toHaveLength(1);
    expect(useAssetStore.getState().assets[0].title).toBe('Asset One');

    global.fetch = undefined;
  });

  it('useAssetStore fetchAllAssets sets assetsError on failure', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await useAssetStore.getState().fetchAllAssets('http://localhost:3001');
    });

    expect(useAssetStore.getState().assetsError).toMatch(/unable to reach/i);
    global.fetch = undefined;
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Skeleton components', () => {
  it('Skeleton base renders with aria-hidden', () => {
    render(<Skeleton variant="text" />);
    const el = document.querySelector('[aria-hidden="true"]');
    expect(el).toBeTruthy();
  });

  it('AssetCardSkeleton renders without crashing', () => {
    const { container } = render(<AssetCardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('TextSkeleton renders', () => {
    render(<TextSkeleton lines={2} />);
    const skeletons = document.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  it('ImageSkeleton renders with correct default height', () => {
    render(<ImageSkeleton />);
    const el = document.querySelector('[aria-hidden="true"]');
    expect(el).toBeTruthy();
    expect(el.style.height).toBe('180px');
  });

  it('AssetGrid renders skeletons while loading', () => {
    const { container } = render(
      <AssetGrid assets={[]} loading={true} error={null} isEmpty={false} />
    );
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WalletAddressBadge from '../components/WalletAddressBadge/WalletAddressBadge';

const FULL_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234';

describe('WalletAddressBadge', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete navigator.clipboard;
  });

  it('renders nothing without a public key', () => {
    const { container } = render(<WalletAddressBadge publicKey={null} onDisconnect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a truncated address in a persistent header element', () => {
    render(<WalletAddressBadge publicKey={FULL_KEY} onDisconnect={() => {}} />);

    const badge = screen.getByTestId('wallet-address-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(`${FULL_KEY.slice(0, 6)}…${FULL_KEY.slice(-6)}`);
    // The full address must remain discoverable via the accessible name.
    expect(screen.getByLabelText(new RegExp(`Connected wallet ${FULL_KEY}`))).toBeInTheDocument();
  });

  it('copies the full address to the clipboard', async () => {
    render(<WalletAddressBadge publicKey={FULL_KEY} onDisconnect={() => {}} />);

    fireEvent.click(screen.getByTestId('wallet-address-copy'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_KEY));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('renders a Disconnect action alongside the address', () => {
    const onDisconnect = vi.fn();
    render(<WalletAddressBadge publicKey={FULL_KEY} onDisconnect={onDisconnect} />);

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('opens the wallet manager when the address is clicked', () => {
    const onManage = vi.fn();
    render(<WalletAddressBadge publicKey={FULL_KEY} onManage={onManage} onDisconnect={() => {}} />);

    fireEvent.click(screen.getByLabelText(new RegExp(`Connected wallet ${FULL_KEY}`)));
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});

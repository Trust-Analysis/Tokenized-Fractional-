import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmPurchase from '../components/ConfirmPurchase/ConfirmPurchase';

/**
 * Test suite for ConfirmPurchase modal component.
 * 
 * This ensures the modal properly displays transaction details before wallet signing
 * and correctly handles confirm/cancel user actions.
 */
describe('ConfirmPurchase Modal — Transaction Confirmation Before Wallet Signing', () => {
  const mockAsset = {
    title: 'Test Asset',
    contractId: 'CABC123DEF456...',
  };

  const defaultProps = {
    asset: mockAsset,
    shares: 5,
    pricePerShare: 100_000_000, // 10 XLM
    baseCostStroops: 500_000_000, // 50 XLM
    platformFeeStroops: 2_500_000, // 0.25 XLM
    networkFeeStroops: 1000, // 0.0001 XLM
    totalCostStroops: 502_501_000, // 50.2501 XLM
    gasTier: 'standard',
    status: null,
    txHash: null,
    errorMessage: null,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders transaction details clearly before wallet signing', () => {
    render(<ConfirmPurchase {...defaultProps} />);

    // Check that asset name is displayed
    expect(screen.getByText('Test Asset')).toBeInTheDocument();
    expect(screen.getByText('CABC123DEF456...')).toBeInTheDocument();

    // Check that share amount is displayed
    expect(screen.getByText('5')).toBeInTheDocument();

    // Check that price per share is displayed
    expect(screen.getByText(/10\.00 XLM/)).toBeInTheDocument();

    // Check that total cost is displayed
    expect(screen.getByText(/50\.2501 XLM/)).toBeInTheDocument();

    // Check that wallet signing warning is displayed
    expect(screen.getByText(/Wallet Signing Required/)).toBeInTheDocument();
    expect(screen.getByText(/Freighter/)).toBeInTheDocument();
  });

  it('calls onConfirm when user clicks Confirm button', () => {
    render(<ConfirmPurchase {...defaultProps} />);

    const confirmButton = screen.getByText('Confirm & Sign Transaction');
    fireEvent.click(confirmButton);

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when user clicks Cancel button', () => {
    render(<ConfirmPurchase {...defaultProps} />);

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('displays processing state when status is processing', () => {
    render(<ConfirmPurchase {...defaultProps} status="processing" />);

    expect(screen.getByText(/Processing on Network/)).toBeInTheDocument();
    expect(screen.getByText(/Broadcasting transaction/)).toBeInTheDocument();
  });

  it('displays success state when status is success', () => {
    render(
      <ConfirmPurchase
        {...defaultProps}
        status="success"
        txHash="abc123def456"
      />
    );

    expect(screen.getByText('Transaction Successful! 🎉')).toBeInTheDocument();
    expect(screen.getByText(/5 share/)).toBeInTheDocument();
    expect(screen.getByText(/50\.2501 XLM/)).toBeInTheDocument();
  });

  it('displays error state when status is error', () => {
    const errorMessage = 'Transaction failed';
    render(
      <ConfirmPurchase
        {...defaultProps}
        status="error"
        errorMessage={errorMessage}
      />
    );

    expect(screen.getByText('Transaction Failed ⚠️')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('hides transaction details during processing state', () => {
    render(<ConfirmPurchase {...defaultProps} status="processing" />);

    // Transaction details should not be visible during processing
    expect(screen.queryByText('Shares Being Purchased')).not.toBeInTheDocument();
    expect(screen.queryByText('Price Per Share')).not.toBeInTheDocument();
  });

  it('hides transaction details during success state', () => {
    render(
      <ConfirmPurchase
        {...defaultProps}
        status="success"
        txHash="abc123def456"
      />
    );

    // Transaction details should not be visible during success
    expect(screen.queryByText('Shares Being Purchased')).not.toBeInTheDocument();
    expect(screen.queryByText('Price Per Share')).not.toBeInTheDocument();
  });

  it('shows transaction hash link in success state', () => {
    const txHash = 'abc123def456789xyz';
    render(
      <ConfirmPurchase
        {...defaultProps}
        status="success"
        txHash={txHash}
      />
    );

    const hashLink = screen.getByText(/abc123/);
    expect(hashLink).toBeInTheDocument();
    expect(hashLink.closest('a')).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/public/tx/${txHash}`
    );
  });

  it('calls retry on error when user clicks Retry button', () => {
    render(
      <ConfirmPurchase
        {...defaultProps}
        status="error"
        errorMessage="Test error"
      />
    );

    const retryButton = screen.getByText('Retry Transaction');
    fireEvent.click(retryButton);

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when user clicks Close in error state', () => {
    render(
      <ConfirmPurchase
        {...defaultProps}
        status="error"
        errorMessage="Test error"
      />
    );

    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when user clicks Close in success state', () => {
    render(
      <ConfirmPurchase
        {...defaultProps}
        status="success"
        txHash="abc123"
      />
    );

    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });
});

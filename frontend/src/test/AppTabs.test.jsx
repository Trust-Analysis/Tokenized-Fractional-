import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppTabs from '../components/AppTabs/AppTabs';

const translate = (key) => key;

describe('AppTabs', () => {
  it('hides the wallet-only transactions tab when disconnected', () => {
    render(<AppTabs view="marketplace" publicKey={null} onChangeView={() => {}} t={translate} />);

    expect(screen.queryByRole('button', { name: 'Transactions' })).not.toBeInTheDocument();
  });

  it('shows every tab once a wallet is connected', () => {
    render(<AppTabs view="portfolio" publicKey="GABC" onChangeView={() => {}} t={translate} />);

    expect(screen.getByRole('button', { name: 'Transactions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nav.portfolio' })).toBeInTheDocument();
  });

  it('reports view changes and preference-panel opens', async () => {
    const onChangeView = vi.fn();
    const onOpenPreferences = vi.fn();

    render(
      <AppTabs
        view="marketplace"
        publicKey="GABC"
        onChangeView={onChangeView}
        onOpenPreferences={onOpenPreferences}
        t={translate}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'nav.portfolio' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preferences' }));

    expect(onChangeView).toHaveBeenCalledWith('portfolio');
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketplaceSearch from '../components/MarketplaceSearch/MarketplaceSearch';

describe('MarketplaceSearch', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('filters the catalogue by name and writes the query to the URL', async () => {
    render(<MarketplaceSearch />);

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search assets by name or location' }),
      'Manhattan',
    );

    expect(screen.getByText('Luxury Manhattan Condo Unit 12B')).toBeInTheDocument();
    expect(screen.queryByText('Solar Farm Infrastructure Alpha')).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain('search=Manhattan'));
  });

  it('filters by asset type and writes the type to the URL', async () => {
    render(<MarketplaceSearch />);

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by asset type' }),
      'energy',
    );

    expect(screen.getByText('Solar Farm Infrastructure Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Luxury Manhattan Condo Unit 12B')).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain('type=energy'));
  });

  it('reads the initial filters from the URL', () => {
    window.history.replaceState({}, '', '/?search=Silicon&sort=valuation-asc');

    render(<MarketplaceSearch />);

    expect(screen.getByRole('textbox', { name: 'Search assets by name or location' })).toHaveValue(
      'Silicon',
    );
    expect(screen.getByRole('combobox', { name: 'Sort assets' })).toHaveValue('valuation-asc');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import FavoritesPage from '../components/FavoritesPage/FavoritesPage';
import { getStorageKey, useFavoritesStore, DEFAULT_CATEGORIES } from '../store/useFavoritesStore';

const WALLET = 'GABCDEFWALLETONE';
const OTHER_WALLET = 'GZYXWVWALLETTWO';
const asset = (id, extra = {}) => ({ contractId: id, title: `Asset ${id}`, ...extra });
const stored = (wallet) => JSON.parse(window.localStorage.getItem(getStorageKey(wallet)) || 'null');
const titles = () => useFavoritesStore.getState().favorites.map((f) => f.title);

describe('Anonymous vs. wallet favorites (#905)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFavoritesStore.setState({
      walletAddress: null, favorites: [], categories: DEFAULT_CATEGORIES, notifications: [],
    });
  });

  it('lets an anonymous visitor favorite assets, persisted under the guest key', () => {
    useFavoritesStore.getState().toggleFavorite(asset('C1'));
    expect(stored(null).favorites.map((f) => f.contractId)).toEqual(['C1']);
  });

  it('merges guest favorites into the wallet list on connect, wallet entries winning', () => {
    // Wallet already has C1 (in a custom category) and C2 from an earlier session.
    window.localStorage.setItem(getStorageKey(WALLET), JSON.stringify({
      favorites: [asset('C1', { categories: ['high-yield'] }), asset('C2')],
      categories: DEFAULT_CATEGORIES,
      notifications: [],
    }));

    const store = useFavoritesStore.getState();
    store.toggleFavorite(asset('C1')); // duplicate of a saved wallet favorite
    store.toggleFavorite(asset('C3')); // guest-only

    useFavoritesStore.getState().setActiveWallet(WALLET);

    expect(titles()).toEqual(['Asset C1', 'Asset C2', 'Asset C3']);
    const c1 = useFavoritesStore.getState().favorites.find((f) => f.contractId === 'C1');
    expect(c1.categories).toEqual(['high-yield']);
    expect(stored(WALLET).favorites).toHaveLength(3);
    expect(stored(null)).toBeNull(); // guest list consumed
  });

  it('keeps the wallet list on disconnect and shows an empty guest list', () => {
    useFavoritesStore.getState().toggleFavorite(asset('C1'));
    useFavoritesStore.getState().setActiveWallet(WALLET);
    useFavoritesStore.getState().setActiveWallet(null);

    expect(titles()).toEqual([]);
    expect(stored(WALLET).favorites.map((f) => f.contractId)).toEqual(['C1']);

    useFavoritesStore.getState().setActiveWallet(WALLET);
    expect(titles()).toEqual(['Asset C1']);
  });

  it('does not merge one wallet into another when switching wallets', () => {
    useFavoritesStore.getState().setActiveWallet(WALLET);
    useFavoritesStore.getState().toggleFavorite(asset('C1'));
    useFavoritesStore.getState().setActiveWallet(OTHER_WALLET);

    expect(titles()).toEqual([]);
    expect(stored(OTHER_WALLET)?.favorites ?? []).toEqual([]);
  });

  it('never merges the same guest list into a second wallet', () => {
    useFavoritesStore.getState().toggleFavorite(asset('C1'));
    useFavoritesStore.getState().setActiveWallet(WALLET);
    useFavoritesStore.getState().setActiveWallet(null);
    useFavoritesStore.getState().setActiveWallet(OTHER_WALLET);

    expect(titles()).toEqual([]);
  });

  it('end to end: favorites added anonymously appear on FavoritesPage after connecting', () => {
    useFavoritesStore.getState().toggleFavorite(asset('C9'));
    useFavoritesStore.getState().setActiveWallet(WALLET);

    render(<FavoritesPage />);
    expect(screen.getByText('Asset C9')).toBeInTheDocument();
    expect(screen.getByText('1 asset')).toBeInTheDocument();
  });
});

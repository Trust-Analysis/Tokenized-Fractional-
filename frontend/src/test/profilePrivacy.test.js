import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hasAnalyticsConsent, setAnalyticsConsent, trackPurchaseInitiated } from '../lib/analytics';
import { profileStorageKey } from '../lib/profilePrivacy';
import { readJson, readString, STORAGE_KEYS, writeJson, writeString } from '../lib/storage';
import { getStorageKey, useFavoritesStore } from '../store/useFavoritesStore';
import { useWalletStore } from '../store/useWalletStore';

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  useWalletStore.setState({ publicKey: null });
  useFavoritesStore.getState().setActiveWallet(null);
  vi.unstubAllGlobals();
});

it('requires explicit consent before reading or writing an analytics identifier', () => {
  writeString(STORAGE_KEYS.ANALYTICS_ID, 'anon_legacy');
  trackPurchaseInitiated('asset', 1, 'XLM');
  expect(fetch).not.toHaveBeenCalled();

  setAnalyticsConsent(true);
  expect(readString(STORAGE_KEYS.ANALYTICS_ID)).toBe('');
  trackPurchaseInitiated('asset', 1, 'XLM');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(readString(STORAGE_KEYS.ANALYTICS_ID)).toMatch(/^anon_/);

  setAnalyticsConsent(false);
  trackPurchaseInitiated('asset', 1, 'XLM');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(readString(STORAGE_KEYS.ANALYTICS_ID)).toBe('');
});

it('removes outgoing wallet data and resets in-memory favorites on disconnect', () => {
  const wallet = 'GTESTWALLET';
  const otherWallet = 'GOTHERWALLET';
  useWalletStore.setState({ publicKey: wallet });
  useFavoritesStore.getState().setActiveWallet(wallet);
  useFavoritesStore.getState().toggleFavorite({ contractId: 'asset' });
  writeJson(profileStorageKey(wallet), { displayName: 'Alice' });
  writeJson(profileStorageKey(otherWallet), { displayName: 'Bob' });
  writeJson(STORAGE_KEYS.PRICE_ALERTS, [{ contractId: 'asset' }]);
  setAnalyticsConsent(true);
  trackPurchaseInitiated('asset', 1, 'XLM');

  useWalletStore.getState().disconnect();

  expect(useWalletStore.getState().publicKey).toBeNull();
  expect(useFavoritesStore.getState().favorites).toEqual([]);
  expect(window.localStorage.getItem(getStorageKey(wallet))).toBeNull();
  expect(readJson(profileStorageKey(wallet))).toBeNull();
  expect(readJson(profileStorageKey(otherWallet))).toEqual({ displayName: 'Bob' });
  expect(readJson(STORAGE_KEYS.PRICE_ALERTS)).toBeNull();
  expect(readString(STORAGE_KEYS.ANALYTICS_ID)).toBe('');
  expect(hasAnalyticsConsent()).toBe(false);
});

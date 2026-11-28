import { removeItem, STORAGE_KEYS } from './storage';

export const LOCAL_DATA_CLEARED = 'rwa:local-data-cleared';
export const profileStorageKey = (publicKey) => `userProfile_${publicKey}`;

export function clearProfileStorage(publicKey) {
  if (publicKey) removeItem(profileStorageKey(publicKey));
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    if (name.startsWith('PROFILE_')) removeItem(key);
  }
  removeItem(STORAGE_KEYS.PRICE_ALERTS);
  removeItem(STORAGE_KEYS.ANALYTICS_ID);
  removeItem(STORAGE_KEYS.ANALYTICS_CONSENT);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_DATA_CLEARED));
}

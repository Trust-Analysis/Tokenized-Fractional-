/**
 * In-memory access-token holder (Issue #1047).
 *
 * Access tokens must never be written to `localStorage` or `sessionStorage`:
 * any script injected into the page can read them. This module keeps the token
 * in a module-scoped variable that is cleared on every page load, which is the
 * same lifetime the UI needs (the backend session cookie is the durable part of
 * authentication and is `HttpOnly`).
 *
 * `purgeLegacyCredentialStorage()` removes tokens persisted by older versions
 * of the app. It is idempotent and safe to call on every boot and disconnect.
 */

/** Legacy keys written by earlier versions. They are read once and deleted. */
export const LEGACY_CREDENTIAL_KEYS = Object.freeze([
  'auth_token',
  'jwt',
  'access_token',
  'refresh_token',
]);

/** Token kept in memory only; never serialized. @type {string | null} */
let accessToken = null;

/** @returns {string | null} The current in-memory access token, if any. */
export function getAuthToken() {
  return accessToken;
}

/**
 * Replace the in-memory access token.
 *
 * @param {string | null | undefined} token A non-empty string, or null to clear.
 */
export function setAuthToken(token) {
  accessToken = typeof token === 'string' && token.length > 0 ? token : null;
}

/** Clear the in-memory access token (does not touch storage). */
export function clearAuthToken() {
  accessToken = null;
}

function safelyRemove(storage, key) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be disabled; nothing to clean up in that case.
  }
}

/**
 * Delete tokens persisted by older app versions from both web storages.
 * Call on boot and on wallet disconnect.
 */
export function purgeLegacyCredentialStorage() {
  const storages = [];
  try {
    if (typeof globalThis !== 'undefined') {
      storages.push(globalThis.localStorage, globalThis.sessionStorage);
    }
  } catch {
    // Accessing the storages can throw when cookies are blocked.
  }
  storages.forEach((storage) => {
    LEGACY_CREDENTIAL_KEYS.forEach((key) => safelyRemove(storage, key));
  });
}

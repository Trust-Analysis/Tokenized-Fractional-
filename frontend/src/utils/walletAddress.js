/**
 * Wallet address presentation helpers (Issue #791).
 *
 * Pure functions so the truncation and clipboard behaviour can be unit tested
 * without a DOM or a real wallet.
 */

/**
 * Shorten a Stellar public key for display, e.g. `GABCDE…WXYZ12`.
 *
 * @param {string} address
 * @param {number} [head] characters to keep at the start
 * @param {number} [tail] characters to keep at the end
 */
export function truncateAddress(address, head = 6, tail = 6) {
  if (typeof address !== 'string' || address.length === 0) return '';
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/**
 * Copy text to the clipboard, preferring the async Clipboard API and falling
 * back to a temporary textarea for insecure contexts / older browsers.
 *
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export async function copyTextToClipboard(text, { navigatorRef, documentRef } = {}) {
  if (!text) return false;

  const nav = navigatorRef || (typeof navigator !== 'undefined' ? navigator : undefined);
  const doc = documentRef || (typeof document !== 'undefined' ? document : undefined);

  const clipboard = nav && nav.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path below
    }
  }

  if (doc && doc.body && typeof doc.createElement === 'function') {
    const textarea = doc.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    doc.body.appendChild(textarea);
    textarea.select();
    let succeeded = false;
    try {
      succeeded = doc.execCommand('copy');
    } catch {
      succeeded = false;
    }
    doc.body.removeChild(textarea);
    return succeeded;
  }

  return false;
}

/**
 * Social Sharing Utility Functions
 * 
 * Helper functions to generate share URLs for different social platforms
 */

/**
 * Generate Twitter share URL
 * @param {string} url - URL to share
 * @param {string} text - Tweet text
 * @param {string} hashtags - Comma-separated hashtags
 * @returns {string} Twitter share URL
 */
export function getTwitterShareUrl(url, text, hashtags = '') {
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('text', text);
  if (hashtags) params.set('hashtags', hashtags);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

/**
 * Generate LinkedIn share URL
 * @param {string} url - URL to share
 * @param {string} title - Share title
 * @param {string} summary - Share summary/description
 * @returns {string} LinkedIn share URL
 */
export function getLinkedInShareUrl(url, title = '', summary = '') {
  const params = new URLSearchParams();
  params.set('url', url);
  if (title) params.set('title', title);
  if (summary) params.set('summary', summary);
  params.set('source', 'RWA Marketplace');
  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
}

/**
 * Generate Facebook share URL
 * @param {string} url - URL to share
 * @param {string} hashtag - Optional hashtag
 * @returns {string} Facebook share URL
 */
export function getFacebookShareUrl(url, hashtag = '') {
  const params = new URLSearchParams();
  params.set('u', url);
  if (hashtag) params.set('hashtag', `#${hashtag.replace(/^#/, '')}`);
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

/**
 * Generate Email share URL
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 * @returns {string} mailto: URL
 */
export function getEmailShareUrl(subject, body) {
  const params = new URLSearchParams();
  params.set('subject', subject);
  params.set('body', body);
  return `mailto:?${params.toString()}`;
}

/**
 * Generate WhatsApp share URL
 * @param {string} text - Message text
 * @returns {string} WhatsApp share URL
 */
export function getWhatsAppShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Generate Telegram share URL
 * @param {string} url - URL to share
 * @param {string} text - Message text
 * @returns {string} Telegram share URL
 */
export function getTelegramShareUrl(url, text = '') {
  const fullText = text ? `${text}\n${url}` : url;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/**
 * Copy text to clipboard with fallback support
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if successful
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for insecure contexts or older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * Format share message for a specific platform
 * @param {string} assetTitle - Title of the asset
 * @param {string} assetLocation - Location of the asset
 * @param {string} assetType - Type of asset
 * @param {string} platform - 'twitter', 'linkedin', 'facebook', 'email', 'whatsapp'
 * @returns {string} Formatted message
 */
export function formatShareMessage(assetTitle, assetLocation, assetType, platform = 'twitter') {
  const baseMessage = `Check out this ${assetType}: "${assetTitle}" in ${assetLocation}`;
  
  switch (platform) {
    case 'twitter':
      return `${baseMessage} on RWA Marketplace! 🏢 #RealWorldAssets #DeFi #Blockchain`;
    case 'linkedin':
      return `Interesting investment opportunity: ${baseMessage} on the RWA Marketplace`;
    case 'facebook':
      return `Check out this real-world asset opportunity: ${baseMessage}`;
    case 'email':
      return baseMessage;
    case 'whatsapp':
      return `${baseMessage} 🏢\n\nCheck it out on RWA Marketplace!`;
    default:
      return baseMessage;
  }
}

/**
 * Open share URL in a new window
 * @param {string} url - URL to open
 * @param {string} platform - Platform name for window title
 * @returns {Window|null} The opened window
 */
export function openShareWindow(url, platform = 'Share') {
  const width = 600;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  
  return window.open(
    url,
    `Share on ${platform}`,
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

export default {
  getTwitterShareUrl,
  getLinkedInShareUrl,
  getFacebookShareUrl,
  getEmailShareUrl,
  getWhatsAppShareUrl,
  getTelegramShareUrl,
  copyToClipboard,
  formatShareMessage,
  openShareWindow,
};

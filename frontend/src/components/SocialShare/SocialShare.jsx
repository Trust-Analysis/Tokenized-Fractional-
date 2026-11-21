import React, { useState } from 'react';
import {
  getTwitterShareUrl,
  getLinkedInShareUrl,
  getFacebookShareUrl,
  getEmailShareUrl,
  getWhatsAppShareUrl,
  formatShareMessage,
  openShareWindow,
  copyToClipboard,
} from '../../utils/socialShare';
import styles from './SocialShare.module.css';

/**
 * Build a canonical, public share URL from the current page location.
 *
 * Only the origin and pathname are kept; any query parameters or hash that
 * may be present in the page URL (preview tokens, draft flags, session or
 * referral identifiers) are deliberately dropped so they cannot leak into a
 * publicly posted share link. The public asset identifier is then attached
 * explicitly when available.
 *
 * @param {string} contractId - canonical public asset identifier
 * @returns {string} canonical share URL
 */
export function buildCanonicalShareUrl(contractId) {
  if (typeof window === 'undefined') {
    return contractId ? `?asset=${encodeURIComponent(contractId)}` : '';
  }
  const base = `${window.location.origin}${window.location.pathname}`;
  return contractId ? `${base}?asset=${encodeURIComponent(contractId)}` : base;
}

/**
 * SocialShare Component
 * 
 * Displays social sharing buttons for Twitter, LinkedIn, Facebook, Email, and WhatsApp
 * with copy-to-clipboard functionality
 */
export default function SocialShare({
  asset = {},
  url = null,
  compact = false,
  showLabel = true,
  onShare = null,
}) {
  const [copied, setCopied] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);

  const {
    title = 'Investment Opportunity',
    location = 'Global',
    assetType = 'Real-World Asset',
    contractId = '',
  } = asset;

  // Build the share URL from only the canonical, public asset identifier.
  // An explicit `url` prop (already canonicalized by the caller) wins;
  // otherwise reconstruct from origin + pathname, never reusing the raw
  // page URL as-is.
  const shareUrl = url || buildCanonicalShareUrl(contractId);

  // Generate share messages for each platform
  const twitterMessage = formatShareMessage(title, location, assetType, 'twitter');
  const linkedinMessage = formatShareMessage(title, location, assetType, 'linkedin');
  const facebookMessage = formatShareMessage(title, location, assetType, 'facebook');
  const emailSubject = `Check out: ${title}`;
  const emailBody = `${formatShareMessage(title, location, assetType, 'email')}\n\n${shareUrl}`;
  const whatsappMessage = `${formatShareMessage(title, location, assetType, 'whatsapp')}\n\n${shareUrl}`;

  // Handle share button clicks
  const handleShare = (platform, shareUrl, message) => {
    if (onShare) {
      onShare(platform, shareUrl);
    }
    openShareWindow(shareUrl, platform);
  };

  // Handle copy to clipboard
  const handleCopyLink = async () => {
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareButtons = [
    {
      id: 'twitter',
      name: 'Twitter',
      icon: '𝕏',
      label: 'X',
      onClick: () => handleShare('Twitter', getTwitterShareUrl(shareUrl, twitterMessage, 'RealWorldAssets,DeFi')),
      color: '#000000',
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      icon: 'in',
      label: 'LinkedIn',
      onClick: () => handleShare('LinkedIn', getLinkedInShareUrl(shareUrl, title, twitterMessage)),
      color: '#0A66C2',
    },
    {
      id: 'facebook',
      name: 'Facebook',
      icon: 'f',
      label: 'Facebook',
      onClick: () => handleShare('Facebook', getFacebookShareUrl(shareUrl, 'RealWorldAssets')),
      color: '#1877F2',
    },
    {
      id: 'email',
      name: 'Email',
      icon: '✉',
      label: 'Email',
      onClick: () => handleShare('Email', getEmailShareUrl(emailSubject, emailBody)),
      color: '#EA4335',
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      icon: '💬',
      label: 'WhatsApp',
      onClick: () => handleShare('WhatsApp', getWhatsAppShareUrl(whatsappMessage)),
      color: '#25D366',
    },
  ];

  if (compact) {
    return (
      <div className={styles.container}>
        <div className={styles.compactButtonGroup}>
          {shareButtons.map((btn) => (
            <button
              key={btn.id}
              className={styles.compactButton}
              onClick={btn.onClick}
              title={`Share on ${btn.name}`}
              aria-label={`Share on ${btn.name}`}
              style={{ '--share-color': btn.color }}
            >
              {btn.icon}
            </button>
          ))}
          <button
            className={`${styles.compactButton} ${styles.copyButton}`}
            onClick={handleCopyLink}
            title="Copy share link"
            aria-label="Copy share link"
          >
            {copied ? '✓' : '🔗'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Share This Investment</h3>
        <p className={styles.subtitle}>Help others discover this opportunity</p>
      </div>

      <div className={styles.shareGrid}>
        {shareButtons.map((btn) => (
          <button
            key={btn.id}
            className={styles.shareButton}
            onClick={btn.onClick}
            title={`Share on ${btn.name}`}
            aria-label={`Share on ${btn.name}`}
            style={{ '--share-color': btn.color }}
          >
            <span className={styles.icon}>{btn.icon}</span>
            <span className={styles.label}>{btn.label}</span>
          </button>
        ))}
      </div>

      <div className={styles.copySection}>
        <div className={styles.copyHeader}>
          <label htmlFor="share-link" className={styles.copyLabel}>
            📋 Or copy the link:
          </label>
        </div>
        <div className={styles.copyContainer}>
          <input
            id="share-link"
            type="text"
            className={styles.copyInput}
            value={shareUrl}
            readOnly
            onClick={(e) => e.target.select()}
          />
          <button
            className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
            onClick={handleCopyLink}
            title="Copy to clipboard"
            aria-label="Copy share link to clipboard"
          >
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        <p className={styles.footerText}>
          Share your investment interest and help build a more transparent financial ecosystem.
        </p>
      </div>
    </div>
  );
}

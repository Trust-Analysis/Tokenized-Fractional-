/**
 * Email Service Configuration
 * 
 * Configuration for SMTP and email notifications.
 * Load environment variables and validate email settings.
 */

/**
 * Email configuration object
 */
export const emailConfig = {
  // SMTP Server Configuration
  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
  },

  // Email Addresses
  from: process.env.SMTP_FROM || 'noreply@rwa-marketplace.com',
  replyTo: process.env.SMTP_REPLY_TO || 'support@rwa-marketplace.com',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@rwa-marketplace.com',

  // Notification Recipients
  notifyOwner: process.env.EMAIL_NOTIFY_OWNER === 'true',
  notifyBuyer: process.env.EMAIL_NOTIFY_BUYER === 'true',
  notifyAdmin: process.env.EMAIL_NOTIFY_ADMIN === 'true',

  // Feature Flags
  enabled: process.env.EMAIL_ENABLED !== 'false',
  sendAsync: process.env.EMAIL_SEND_ASYNC !== 'false',
  verifyOnStartup: process.env.EMAIL_VERIFY_ON_STARTUP === 'true',

  // Queue Configuration
  maxQueueSize: parseInt(process.env.EMAIL_MAX_QUEUE_SIZE || '1000'),
  maxRetries: parseInt(process.env.EMAIL_MAX_RETRIES || '3'),
  retryDelayMs: parseInt(process.env.EMAIL_RETRY_DELAY_MS || '5000'),

  // Dashboard URL for email links
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:5173',
};

/**
 * Validate email configuration
 */
export function validateEmailConfig() {
  const errors = [];

  if (emailConfig.enabled) {
    if (!emailConfig.smtp.host) {
      errors.push('SMTP_HOST is required when email is enabled');
    }
    if (!emailConfig.smtp.user) {
      errors.push('SMTP_USER is required when email is enabled');
    }
    if (!emailConfig.smtp.password) {
      errors.push('SMTP_PASSWORD is required when email is enabled');
    }
    if (!emailConfig.from) {
      errors.push('SMTP_FROM is required when email is enabled');
    }
  }

  return errors;
}

/**
 * Get email configuration summary (safe for logging)
 */
export function getEmailConfigSummary() {
  return {
    enabled: emailConfig.enabled,
    smtpHost: emailConfig.smtp.host,
    smtpPort: emailConfig.smtp.port,
    smtpSecure: emailConfig.smtp.secure,
    from: emailConfig.from,
    replyTo: emailConfig.replyTo,
    adminEmail: emailConfig.adminEmail,
    notifyOwner: emailConfig.notifyOwner,
    notifyBuyer: emailConfig.notifyBuyer,
    notifyAdmin: emailConfig.notifyAdmin,
    dashboardUrl: emailConfig.dashboardUrl,
  };
}

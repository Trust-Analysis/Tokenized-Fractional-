# Email Notification System

## Overview

The RWA Marketplace includes a comprehensive email notification system for sending automated emails about marketplace events to users, asset owners, and administrators. Built with Nodemailer, MJML templates, and Handlebars rendering.

**Features:**
- ✅ Multiple email templates for different events
- ✅ Asynchronous email queue for reliability
- ✅ MJML template rendering for responsive emails
- ✅ Handlebars variable interpolation
- ✅ Error handling and retry logic
- ✅ SMTP configuration flexibility
- ✅ Admin alerts
- ✅ Environment-based feature flags

## Architecture

### Components

**EmailService** (`backend/email.js`)
- Manages SMTP connection via Nodemailer
- Handles email queuing and batch processing
- Renders MJML templates to HTML
- Sends emails asynchronously
- Tracks statistics and errors

**Configuration** (`backend/emailConfig.js`)
- Loads SMTP settings from environment variables
- Validates configuration on startup
- Provides safe configuration summary
- Feature flags for selective notifications

**Email Templates** (in `backend/email.js`)
- 6 pre-built MJML templates
- Handlebars variable support
- Responsive design
- Color-coded by event type

## Installation

### 1. Install Dependencies

```bash
cd backend
npm install
```

This installs:
- `nodemailer@^6.9.13` - SMTP client
- `mjml@^4.15.3` - Email template language
- `handlebars@^4.7.8` - Template variables

### 2. Configure Environment Variables

Create or update `.env`:

```bash
# SMTP Configuration
SMTP_HOST=smtp.gmail.com              # SMTP server hostname
SMTP_PORT=587                          # SMTP port (587 or 465)
SMTP_SECURE=false                      # Use TLS (false for port 587, true for 465)
SMTP_USER=your-email@gmail.com         # SMTP username
SMTP_PASSWORD=your-app-password        # SMTP password (use app password for Gmail)

# Email Configuration
SMTP_FROM=noreply@rwa-marketplace.com  # Sender email address
SMTP_REPLY_TO=support@rwa-marketplace.com  # Reply-to address
ADMIN_EMAIL=admin@rwa-marketplace.com  # Admin alert recipient

# Notification Flags
EMAIL_ENABLED=true                     # Enable/disable email system
EMAIL_NOTIFY_OWNER=true                # Notify asset owners
EMAIL_NOTIFY_BUYER=true                # Notify share buyers
EMAIL_NOTIFY_ADMIN=true                # Send admin alerts

# Feature Options
EMAIL_SEND_ASYNC=true                  # Send emails asynchronously
EMAIL_VERIFY_ON_STARTUP=true           # Verify SMTP on startup
EMAIL_MAX_QUEUE_SIZE=1000              # Maximum queue size

# Dashboard
DASHBOARD_URL=http://localhost:5173    # Frontend URL for email links
```

### 3. Initialize Email Service

In `backend/index.js`, add initialization:

```javascript
import { emailService } from './email.js';
import { emailConfig, validateEmailConfig } from './emailConfig.js';

// On startup:
if (emailConfig.enabled) {
  const errors = validateEmailConfig();
  if (errors.length > 0) {
    logger.error({ errors }, 'Email configuration invalid');
  } else {
    if (emailConfig.verifyOnStartup) {
      const verified = await emailService.verify();
      logger.info({ verified }, 'Email service initialized');
    }
  }
}
```

## Email Templates

### 1. Asset Listed

Sent when a new asset is listed on the marketplace.

**Template Name:** `assetListed`

**Recipients:** Registered users

**Variables:**
- `recipientName` - User's name
- `assetTitle` - Asset name
- `assetLocation` - Geographic location
- `assetType` - Asset category
- `assetDescription` - Asset description
- `availableShares` - Shares for purchase
- `pricePerShare` - Price per share
- `contractId` - Stellar contract ID
- `dashboardUrl` - Link to dashboard

**Example:**
```javascript
await emailNotifications.notifyAssetListed(
  'user@example.com',
  {
    title: 'Downtown Office Building',
    location: 'New York, NY',
    assetType: 'Commercial Real Estate',
    description: 'Modern 20-story office building',
    availableShares: 1000,
    pricePerShare: 10000000,
    contractId: 'CAQK...',
    ownerName: 'John Doe',
  },
  'http://localhost:5173'
);
```

### 2. Share Purchased

Confirmation email after share purchase.

**Template Name:** `sharePurchased`

**Recipients:** Share buyer

**Variables:**
- `recipientName` - Buyer's name
- `assetTitle` - Asset purchased
- `sharesPurchased` - Number of shares
- `totalCost` - Total cost in stroops
- `transactionId` - Transaction ID
- `dashboardUrl` - Link to portfolio

**Example:**
```javascript
await emailNotifications.notifySharePurchased(
  'buyer@example.com',
  {
    buyerName: 'Jane Smith',
    assetTitle: 'Downtown Office Building',
    sharesPurchased: 50,
    totalCost: 500000000,
    transactionId: 'TXN123456',
  },
  'http://localhost:5173'
);
```

### 3. Asset Approved

Sent when asset is approved for publication.

**Template Name:** `assetApproved`

**Recipients:** Asset owner

**Variables:**
- `recipientName` - Owner's name
- `assetTitle` - Asset name
- `assetLocation` - Location
- `totalShares` - Total shares
- `pricePerShare` - Price per share
- `contractId` - Contract ID
- `dashboardUrl` - Dashboard link

### 4. Asset Paused

Sent when asset trading is paused.

**Template Name:** `assetPaused`

**Recipients:** Asset owners and shareholders

**Variables:**
- `recipientName` - User name
- `assetTitle` - Asset name
- `pauseReason` - Why it was paused
- `dashboardUrl` - Dashboard link

### 5. Asset Resumed

Sent when asset trading resumes.

**Template Name:** `assetResumed`

**Recipients:** Asset owners and shareholders

**Variables:**
- `recipientName` - User name
- `assetTitle` - Asset name
- `contractId` - Contract ID
- `dashboardUrl` - Dashboard link

### 6. Admin Alert

Sent to administrators for important events.

**Template Name:** `adminAlert`

**Recipients:** Admin email (configurable)

**Variables:**
- `alertTitle` - Alert title
- `alertLevel` - Severity (INFO, WARNING, ERROR)
- `timestamp` - Event timestamp
- `alertMessage` - Alert message
- `alertDetails` - Additional details
- `dashboardUrl` - Admin dashboard link

**Example:**
```javascript
await emailNotifications.sendAdminAlert(
  'admin@rwa-marketplace.com',
  {
    title: 'High Activity Detected',
    level: 'WARNING',
    message: 'Unusual trading volume detected',
    details: 'Volume spike: 5000 shares sold in 10 minutes',
  },
  'http://localhost:5173'
);
```

## Usage

### Basic Email Sending

```javascript
import { emailService, emailNotifications } from './email.js';

// Send asset listed notification
await emailNotifications.notifyAssetListed(
  recipientEmail,
  assetData,
  dashboardUrl
);

// Send share purchase confirmation
await emailNotifications.notifySharePurchased(
  buyerEmail,
  purchaseData,
  dashboardUrl
);
```

### Async Queue Processing

Emails are automatically queued and processed:

```javascript
// Add to queue (returns immediately)
await emailNotifications.notifyAssetListed(...);
await emailNotifications.notifyAssetListed(...);
await emailNotifications.notifyAssetListed(...);

// All three are queued and processed in background
```

### Manual Sending

```javascript
import { emailService } from './email.js';

// Send custom email
await emailService.send({
  type: 'assetListed',  // Must be a defined template
  to: 'user@example.com',
  variables: {
    // Template variables
  },
});
```

### Verify SMTP Connection

```javascript
const verified = await emailService.verify();
if (verified) {
  console.log('Email service ready');
} else {
  console.log('Email service not available');
}
```

### Get Queue Statistics

```javascript
const stats = emailService.getStats();
console.log(stats);
// {
//   queueLength: 5,
//   isProcessing: true,
//   templatesAvailable: 6
// }
```

## Integration Points

### Asset Operations

Email notifications should be triggered on these events:

1. **Asset Created** → Send `assetListed` to registered users
2. **Asset Approved** → Send `assetApproved` to owner
3. **Asset Paused** → Send `assetPaused` to shareholders
4. **Asset Resumed** → Send `assetResumed` to shareholders

### Purchase Operations

1. **Share Purchased** → Send `sharePurchased` to buyer
2. **Share Purchased** (optional) → Send admin alert to admin
3. **Large Purchase** (optional) → Send alert to asset owner

### Admin Operations

1. **Anomaly Detected** → Send `adminAlert` to admin
2. **System Event** → Send `adminAlert` to admin
3. **Error Occurred** → Send `adminAlert` to admin

## SMTP Providers

### Gmail

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password  # Use 16-character app password
```

**Setup:**
1. Enable 2-factor authentication
2. Generate app password at https://myaccount.google.com/apppasswords
3. Use the generated password

### SendGrid

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASSWORD=SG.xxxxxxxxx...
```

### AWS SES

```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-ses-user
SMTP_PASSWORD=your-ses-password
```

### Mailgun

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@your-domain.com
SMTP_PASSWORD=your-password
```

## Troubleshooting

### Emails Not Sending

1. **Check if enabled:**
   ```bash
   grep EMAIL_ENABLED .env
   ```

2. **Verify SMTP config:**
   ```javascript
   const { getEmailConfigSummary } = require('./emailConfig.js');
   console.log(getEmailConfigSummary());
   ```

3. **Check logs:**
   ```bash
   grep "Email" logs/*.log
   ```

4. **Verify SMTP connection:**
   ```javascript
   const verified = await emailService.verify();
   console.log('SMTP verified:', verified);
   ```

### Template Not Found

Ensure template name is correct:
- `assetListed`
- `sharePurchased`
- `assetApproved`
- `assetPaused`
- `assetResumed`
- `adminAlert`

### Variable Rendering Issues

Check all required variables are provided:

```javascript
// Check template for required variables
const template = EMAIL_TEMPLATES[type];
// Ensure all {{variable}} placeholders are in the data
```

## Performance

- **Queue Processing:** ~100ms between emails
- **Template Rendering:** ~50ms per email
- **SMTP Send:** 1-5 seconds (depends on provider)
- **Max Queue Size:** 1000 emails (configurable)

## Security

- ✅ No sensitive data in email logs
- ✅ SMTP password not logged
- ✅ Errors captured in Sentry
- ✅ Email addresses validated
- ✅ Templates sanitized

## Testing

### Manual Test

```bash
# Set test email
SMTP_FROM=test@example.com
ADMIN_EMAIL=admin@example.com

# Send test email
npm run test:email
```

### Load Testing

```javascript
// Queue 100 emails
for (let i = 0; i < 100; i++) {
  await emailNotifications.notifyAssetListed(
    `user${i}@example.com`,
    assetData,
    dashboardUrl
  );
}

// Check stats
console.log(emailService.getStats());
```

## Future Enhancements

1. **Email Preferences** - Let users choose which emails they receive
2. **Unsubscribe Links** - Allow users to unsubscribe from certain email types
3. **Email Templates Management** - Admin UI for editing templates
4. **Analytics** - Track email open rates and clicks
5. **Scheduling** - Send emails at specific times
6. **A/B Testing** - Test different email versions
7. **Personalization** - Dynamic content based on user behavior
8. **Multi-Language** - Support different languages

## API Reference

### EmailService Class

```javascript
class EmailService {
  // Queue email for sending
  async queue(emailData)

  // Send email immediately
  async send(emailData)

  // Send email (alias for send)
  async sendSync(emailData)

  // Process queued emails
  async processQueue()

  // Get queue statistics
  getStats()

  // Verify SMTP connection
  async verify()

  // Close SMTP connection
  async close()
}
```

### Email Data Structure

```javascript
{
  type: 'assetListed',  // Template name
  to: 'user@example.com',  // Recipient email
  variables: {  // Template variables
    recipientName: 'John',
    assetTitle: 'Property',
    // ... other variables
  }
}
```

## Support

For issues or questions:
1. Check the Troubleshooting section
2. Review environment variables
3. Check application logs
4. Review SMTP provider documentation

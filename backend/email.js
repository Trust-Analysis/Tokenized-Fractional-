/**
 * Email Notification Service
 *
 * Handles email sending with templates, queuing, and error handling.
 * Supports multiple email types with MJML templates and Handlebars rendering.
 */

import nodemailer from 'nodemailer';
import { render } from 'mjml';
import Handlebars from 'handlebars';

/**
 * Email Templates - MJML with Handlebars variables
 */
const EMAIL_TEMPLATES = {
  assetListed: {
    subject: 'New Asset Listed: {{assetTitle}}',
    template: `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text font-size="20px" color="#1a1a1a" font-weight="bold">
                New Asset Available
              </mj-text>
              <mj-divider border-color="#007bff"></mj-divider>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-text>Hi {{recipientName}},</mj-text>
              <mj-text>A new real-world asset has been listed on the marketplace:</mj-text>
              <mj-text font-weight="bold" font-size="16px" color="#007bff">
                {{assetTitle}}
              </mj-text>
              <mj-text>Location: {{assetLocation}}</mj-text>
              <mj-text>Asset Type: {{assetType}}</mj-text>
              <mj-text>Available Shares: {{availableShares}}</mj-text>
              <mj-text>Price per Share: {{pricePerShare}} stroops</mj-text>
              <mj-text>{{assetDescription}}</mj-text>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-button href="{{dashboardUrl}}/asset/{{contractId}}" background-color="#007bff">
                View Asset
              </mj-button>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-text font-size="12px" color="#666666">
                You received this email because you're registered on the RWA Marketplace.
              </mj-text>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `,
  },

  sharePurchased: {
    subject: 'Purchase Confirmation: {{assetTitle}}',
    template: `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text font-size="20px" color="#1a1a1a" font-weight="bold">
                Purchase Successful
              </mj-text>
              <mj-divider border-color="#28a745"></mj-divider>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-text>Hi {{recipientName}},</mj-text>
              <mj-text>Your share purchase has been completed successfully!</mj-text>
              <mj-table cellpadding="0" border="1px solid #ddd">
                <tr style="border-bottom:1px solid #ddd;">
                  <th style="text-align:left;padding:10px;">Asset</th>
                  <td>{{assetTitle}}</td>
                </tr>
                <tr style="border-bottom:1px solid #ddd;">
                  <th style="text-align:left;padding:10px;">Shares Purchased</th>
                  <td>{{sharesPurchased}}</td>
                </tr>
                <tr style="border-bottom:1px solid #ddd;">
                  <th style="text-align:left;padding:10px;">Total Cost</th>
                  <td>{{totalCost}} stroops</td>
                </tr>
                <tr>
                  <th style="text-align:left;padding:10px;">Transaction ID</th>
                  <td>{{transactionId}}</td>
                </tr>
              </mj-table>
              <mj-text>Your NFT certificate has been minted and is ready to view in your wallet.</mj-text>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-button href="{{dashboardUrl}}/portfolio" background-color="#28a745">
                View Portfolio
              </mj-button>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `,
  },

  assetApproved: {
    subject: 'Asset Approved: {{assetTitle}}',
    template: `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text font-size="20px" color="#1a1a1a" font-weight="bold">
                Asset Approved and Published
              </mj-text>
              <mj-divider border-color="#17a2b8"></mj-divider>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-text>Hi {{recipientName}},</mj-text>
              <mj-text>Your asset has been approved and is now live on the marketplace!</mj-text>
              <mj-text font-weight="bold" font-size="16px" color="#17a2b8">
                {{assetTitle}}
              </mj-text>
              <mj-text>Location: {{assetLocation}}</mj-text>
              <mj-text>Total Shares: {{totalShares}}</mj-text>
              <mj-text>Price per Share: {{pricePerShare}} stroops</mj-text>
              <mj-text>Your asset is now available for purchase by marketplace investors.</mj-text>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-button href="{{dashboardUrl}}/asset/{{contractId}}" background-color="#17a2b8">
                View Asset
              </mj-button>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `,
  },

  assetPaused: {
    subject: 'Asset Paused: {{assetTitle}}',
    template: `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text font-size="20px" color="#1a1a1a" font-weight="bold">
                Asset Trading Paused
              </mj-text>
              <mj-divider border-color="#ffc107"></mj-divider>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-text>Hi {{recipientName}},</mj-text>
              <mj-text>Trading has been paused for the following asset:</mj-text>
              <mj-text font-weight="bold" font-size="16px" color="#ffc107">
                {{assetTitle}}
              </mj-text>
              <mj-text>Reason: {{pauseReason}}</mj-text>
              <mj-text>Shares you own in this asset are secure. Trading will resume once the issue is resolved.</mj-text>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `,
  },

  assetResumed: {
    subject: 'Asset Trading Resumed: {{assetTitle}}',
    template: `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text font-size="20px" color="#1a1a1a" font-weight="bold">
                Asset Trading Resumed
              </mj-text>
              <mj-divider border-color="#28a745"></mj-divider>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-text>Hi {{recipientName}},</mj-text>
              <mj-text>Trading has resumed for the following asset:</mj-text>
              <mj-text font-weight="bold" font-size="16px" color="#28a745">
                {{assetTitle}}
              </mj-text>
              <mj-text>You can now buy and sell shares of this asset again.</mj-text>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-button href="{{dashboardUrl}}/asset/{{contractId}}" background-color="#28a745">
                View Asset
              </mj-button>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `,
  },

  adminAlert: {
    subject: 'Admin Alert: {{alertTitle}}',
    template: `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text font-size="20px" color="#dc3545" font-weight="bold">
                {{alertTitle}}
              </mj-text>
              <mj-divider border-color="#dc3545"></mj-divider>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-text>Alert Level: {{alertLevel}}</mj-text>
              <mj-text>Time: {{timestamp}}</mj-text>
              <mj-text>{{alertMessage}}</mj-text>
              <mj-text font-style="italic" color="#666">Details: {{alertDetails}}</mj-text>
            </mj-column>
          </mj-section>
          <mj-section>
            <mj-column>
              <mj-button href="{{dashboardUrl}}/admin" background-color="#dc3545">
                Admin Dashboard
              </mj-button>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `,
  },
};

/**
 * Email Service Class
 */
export class EmailService {
  constructor(config = {}) {
    this.config = {
      host: config.host || process.env.SMTP_HOST || 'localhost',
      port: config.port || parseInt(process.env.SMTP_PORT || '587'),
      secure: config.secure || process.env.SMTP_SECURE === 'true',
      auth: config.auth || {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      from: config.from || process.env.SMTP_FROM || 'noreply@rwa-marketplace.com',
      replyTo: config.replyTo || process.env.SMTP_REPLY_TO || 'support@rwa-marketplace.com',
    };

    this.queue = [];
    this.isProcessing = false;
    this.logger = config.logger || console;
    this.sentry = config.sentry || null;

    // Initialize transporter
    this.transporter = nodemailer.createTransport(this.config);
  }

  /**
   * Queue email for sending
   */
  async queue(emailData) {
    this.queue.push(emailData);
    this.logger.debug({ emailData }, 'Email queued');
    await this.processQueue();
  }

  /**
   * Process queued emails
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const emailData = this.queue.shift();
        await this.send(emailData);
        // Small delay between sends to avoid overwhelming the SMTP server
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send email
   */
  async send(emailData) {
    try {
      const { type, to, variables = {} } = emailData;

      const template = EMAIL_TEMPLATES[type];
      if (!template) {
        throw new Error(`Email template not found: ${type}`);
      }

      // Render Handlebars template with variables
      const compiledSubject = Handlebars.compile(template.subject);
      const subject = compiledSubject(variables);

      const compiledTemplate = Handlebars.compile(template.template);
      const mjmlContent = compiledTemplate(variables);

      // Convert MJML to HTML
      const { html } = render(mjmlContent);

      // Send email
      const result = await this.transporter.sendMail({
        from: this.config.from,
        to,
        subject,
        html,
        replyTo: this.config.replyTo,
        headers: {
          'X-Mailer': 'RWA-Marketplace-Email-Service',
          'X-Email-Type': type,
        },
      });

      this.logger.info(
        { type, to, subject, messageId: result.messageId },
        'Email sent successfully',
      );

      return result;
    } catch (error) {
      this.logger.error({ error: error.message, emailData }, 'Failed to send email');

      if (this.sentry) {
        this.sentry.captureException(error, {
          contexts: { email: emailData },
        });
      }

      throw error;
    }
  }

  /**
   * Send email synchronously
   */
  async sendSync(emailData) {
    return this.send(emailData);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      templatesAvailable: Object.keys(EMAIL_TEMPLATES).length,
    };
  }

  /**
   * Verify SMTP connection
   */
  async verify() {
    try {
      await this.transporter.verify();
      this.logger.info('Email service verified successfully');
      return true;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Email service verification failed');
      if (this.sentry) {
        this.sentry.captureException(error);
      }
      return false;
    }
  }

  /**
   * Close SMTP connection
   */
  async close() {
    this.transporter.close();
  }
}

/**
 * Singleton instance
 */
export const emailService = new EmailService();

/**
 * Helper functions for common email scenarios
 */
export const emailNotifications = {
  /**
   * Notify about new listed asset
   */
  async notifyAssetListed(recipientEmail, assetData, dashboardUrl) {
    await emailService.queue({
      type: 'assetListed',
      to: recipientEmail,
      variables: {
        recipientName: assetData.ownerName || 'User',
        assetTitle: assetData.title,
        assetLocation: assetData.location,
        assetType: assetData.assetType,
        assetDescription: assetData.description,
        availableShares: assetData.availableShares,
        pricePerShare: assetData.pricePerShare,
        contractId: assetData.contractId,
        dashboardUrl,
      },
    });
  },

  /**
   * Notify about share purchase
   */
  async notifySharePurchased(recipientEmail, purchaseData, dashboardUrl) {
    await emailService.queue({
      type: 'sharePurchased',
      to: recipientEmail,
      variables: {
        recipientName: purchaseData.buyerName || 'User',
        assetTitle: purchaseData.assetTitle,
        sharesPurchased: purchaseData.sharesPurchased,
        totalCost: purchaseData.totalCost,
        transactionId: purchaseData.transactionId,
        dashboardUrl,
      },
    });
  },

  /**
   * Notify asset owner about approval
   */
  async notifyAssetApproved(ownerEmail, assetData, dashboardUrl) {
    await emailService.queue({
      type: 'assetApproved',
      to: ownerEmail,
      variables: {
        recipientName: assetData.ownerName || 'User',
        assetTitle: assetData.title,
        assetLocation: assetData.location,
        totalShares: assetData.totalShares,
        pricePerShare: assetData.pricePerShare,
        contractId: assetData.contractId,
        dashboardUrl,
      },
    });
  },

  /**
   * Notify about asset pause
   */
  async notifyAssetPaused(recipientEmail, assetData, pauseReason, dashboardUrl) {
    await emailService.queue({
      type: 'assetPaused',
      to: recipientEmail,
      variables: {
        recipientName: assetData.ownerName || 'User',
        assetTitle: assetData.title,
        pauseReason,
        dashboardUrl,
      },
    });
  },

  /**
   * Notify about asset resume
   */
  async notifyAssetResumed(recipientEmail, assetData, dashboardUrl) {
    await emailService.queue({
      type: 'assetResumed',
      to: recipientEmail,
      variables: {
        recipientName: assetData.ownerName || 'User',
        assetTitle: assetData.title,
        contractId: assetData.contractId,
        dashboardUrl,
      },
    });
  },

  /**
   * Send admin alert
   */
  async sendAdminAlert(adminEmail, alertData, dashboardUrl) {
    await emailService.queue({
      type: 'adminAlert',
      to: adminEmail,
      variables: {
        alertTitle: alertData.title,
        alertLevel: alertData.level || 'INFO',
        timestamp: new Date().toISOString(),
        alertMessage: alertData.message,
        alertDetails: alertData.details,
        dashboardUrl,
      },
    });
  },
};

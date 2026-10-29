/**
 * Email Service
 *
 * Handles all email sending functionality.
 * Supports two providers:
 * 1. Microsoft Graph API (recommended for M365 users)
 * 2. SMTP via Nodemailer (fallback)
 *
 * Microsoft Graph Environment Variables:
 * - AZURE_TENANT_ID: Azure AD tenant ID
 * - AZURE_CLIENT_ID: Azure AD application (client) ID
 * - AZURE_CLIENT_SECRET: Azure AD client secret
 * - EMAIL_FROM_ADDRESS: Sender email address (must be valid M365 mailbox)
 * - EMAIL_FROM_NAME: Sender display name
 *
 * SMTP Environment Variables (fallback):
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (default: 587)
 * - SMTP_SECURE: Use TLS (default: false for port 587, true for 465)
 * - SMTP_USER: SMTP authentication username
 * - SMTP_PASSWORD: SMTP authentication password
 * - EMAIL_FROM_ADDRESS: Default sender email address
 * - EMAIL_FROM_NAME: Default sender name (default: Oakcloud)
 */

import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { createLogger } from '@/lib/logger';

const log = createLogger('email');

// ============================================================================
// Types
// ============================================================================

export interface EmailOptions {
  to?: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

type EmailProvider = 'graph' | 'smtp' | 'none';

// ============================================================================
// Provider Detection
// ============================================================================

function hasConfiguredValue(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const placeholderPatterns = [
    /^your[-_\s]/i,
    /^example/i,
    /^admin@yourdomain\.com$/i,
    /^noreply@example\.com$/i,
    /^sk-your-/i,
  ];

  return !placeholderPatterns.some((pattern) => pattern.test(normalized));
}

function getEmailProvider(): EmailProvider {
  // Check for Microsoft Graph API (preferred)
  if (
    hasConfiguredValue(process.env.AZURE_TENANT_ID) &&
    hasConfiguredValue(process.env.AZURE_CLIENT_ID) &&
    hasConfiguredValue(process.env.AZURE_CLIENT_SECRET) &&
    hasConfiguredValue(process.env.EMAIL_FROM_ADDRESS)
  ) {
    return 'graph';
  }

  // Check for SMTP
  if (
    hasConfiguredValue(process.env.SMTP_HOST) &&
    hasConfiguredValue(process.env.SMTP_USER) &&
    hasConfiguredValue(process.env.SMTP_PASSWORD)
  ) {
    return 'smtp';
  }

  return 'none';
}

// ============================================================================
// Microsoft Graph API
// ============================================================================

let graphClient: Client | null = null;

function getGraphClient(): Client | null {
  if (graphClient) {
    return graphClient;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return null;
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });

  graphClient = Client.initWithMiddleware({ authProvider });
  return graphClient;
}

async function sendViaGraph(options: EmailOptions): Promise<SendEmailResult> {
  const client = getGraphClient();
  if (!client) {
    return { success: false, error: 'Microsoft Graph client not initialized' };
  }

  const fromAddress = options.from || process.env.EMAIL_FROM_ADDRESS;
  const fromName = process.env.EMAIL_FROM_NAME || 'Oakcloud';

  // Build recipients
  const toRecipients = options.to
    ? (Array.isArray(options.to) ? options.to : [options.to]).map((email) => ({
        emailAddress: { address: email },
      }))
    : [];

  const ccRecipients = options.cc
    ? (Array.isArray(options.cc) ? options.cc : [options.cc]).map((email) => ({
        emailAddress: { address: email },
      }))
    : undefined;

  const bccRecipients = options.bcc
    ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]).map((email) => ({
        emailAddress: { address: email },
      }))
    : undefined;

  const attachments = options.attachments?.map((attachment) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: attachment.filename,
    contentType: attachment.contentType || 'application/octet-stream',
    contentBytes: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString('base64')
      : Buffer.from(attachment.content).toString('base64'),
  }));

  const message = {
    subject: options.subject,
    body: {
      contentType: 'HTML',
      content: options.html,
    },
    from: {
      emailAddress: {
        address: fromAddress,
        name: fromName,
      },
    },
    toRecipients,
    ccRecipients,
    bccRecipients,
    replyTo: options.replyTo
      ? [{ emailAddress: { address: options.replyTo } }]
      : undefined,
    attachments,
  };

  try {
    await client.api(`/users/${fromAddress}/sendMail`).post({ message });

    return {
      success: true,
      messageId: `graph-${Date.now()}`,
    };
  } catch (error) {
    log.error('Microsoft Graph send failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Graph API error',
    };
  }
}

async function verifyGraphConnection(): Promise<boolean> {
  // For Graph API, we just verify that the client can be initialized
  // Actual permission verification happens on first send
  // (We can't read user profile without User.Read.All permission)
  const client = getGraphClient();
  return client !== null;
}

// ============================================================================
// SMTP (Nodemailer)
// ============================================================================

let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter | null {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return smtpTransporter;
}

function getFromAddress(): string {
  const fromName = process.env.EMAIL_FROM_NAME || 'Oakcloud';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER;
  return `"${fromName}" <${fromAddress}>`;
}

async function sendViaSmtp(options: EmailOptions): Promise<SendEmailResult> {
  const transport = getSmtpTransporter();
  if (!transport) {
    return { success: false, error: 'SMTP transport not initialized' };
  }

  try {
    const result = await transport.sendMail({
      from: options.from || getFromAddress(),
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc) : undefined,
      bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc) : undefined,
      replyTo: options.replyTo,
      subject: options.subject,
      html: options.html,
      text: options.text || stripHtml(options.html),
      attachments: options.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    });

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    log.error('SMTP send failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown SMTP error',
    };
  }
}

async function verifySmtpConnection(): Promise<boolean> {
  const transport = getSmtpTransporter();
  if (!transport) {
    return false;
  }

  try {
    await transport.verify();
    return true;
  } catch (error) {
    log.error('SMTP verification failed:', error);
    return false;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return getEmailProvider() !== 'none';
}

/**
 * Get the current email provider
 */
export function getActiveEmailProvider(): string {
  return getEmailProvider();
}

/**
 * Send an email using the configured provider
 */
export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  const provider = getEmailProvider();

  if (provider === 'none') {
    // Log warning in development, but don't fail
    if (process.env.NODE_ENV === 'development') {
      log.warn('No email provider configured. Email would be sent to:', options.to);
      log.warn('Subject:', options.subject);
      return {
        success: true,
        messageId: 'dev-mode-no-email',
      };
    }
    return {
      success: false,
      error: 'Email service not configured',
    };
  }

  if (provider === 'graph') {
    return sendViaGraph(options);
  }

  return sendViaSmtp(options);
}

/**
 * Verify email connection (useful for health checks)
 */
export async function verifyEmailConnection(): Promise<boolean> {
  const provider = getEmailProvider();

  if (provider === 'graph') {
    return verifyGraphConnection();
  }

  if (provider === 'smtp') {
    return verifySmtpConnection();
  }

  return false;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Simple HTML to plain text converter
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get the base URL for email links
 */
export function getAppBaseUrl(): string {
  const normalize = (value: string): string => value.trim().replace(/\/+$/, '');
  const isLocalhostUrl = (value: string): boolean =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Optional override specifically for email links.
  const emailBaseUrl = process.env.EMAIL_APP_URL;
  if (emailBaseUrl) {
    return normalize(emailBaseUrl);
  }

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appBaseUrl) {
    return 'https://service.oakcloud.app';
  }

  const normalized = normalize(appBaseUrl);
  if (!isDevelopment && isLocalhostUrl(normalized)) {
    return 'https://service.oakcloud.app';
  }

  return normalized;
}

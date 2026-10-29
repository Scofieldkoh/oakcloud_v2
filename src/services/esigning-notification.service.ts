import type { EmailAttachment } from '@/lib/email';
import { getAppBaseUrl, sendEmail } from '@/lib/email';
import { createLogger } from '@/lib/logger';
import type {
  EsigningEmailDeliveryKind,
  EsigningEmailDeliveryResult,
} from '@/services/esigning-email-delivery.service';

const log = createLogger('esigning-notifications');

// ── Brand tokens ──────────────────────────────────────────────────────────────
const BRAND   = '#294d44';
const BRAND_LT = '#e8f0ef';
const TEXT    = '#111827';
const TEXT_SEC = '#4b5563';
const TEXT_MUT = '#9ca3af';
const BORDER  = '#e5e7eb';
const BG      = '#f9fafb';
const SUCCESS = '#065f46';
const WARN    = '#92400e';
const ERROR   = '#991b1b';

// ── Shared helpers ────────────────────────────────────────────────────────────

function appName(): string {
  return process.env.EMAIL_FROM_NAME?.trim() || 'Oakcloud';
}

function subject(text: string): string {
  return `[${appName()}] ${text}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

function ctaButton(label: string, url: string, color: string = BRAND): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;border-collapse:collapse;">
      <tr>
        <td style="border-radius:8px;background:${color};mso-padding-alt:13px 28px;">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;
                    font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;
                    border-radius:8px;letter-spacing:0.01em;mso-text-raise:1px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

function fallbackLink(url: string): string {
  return `
    <p style="font-size:12px;color:${TEXT_MUT};margin:16px 0 0;line-height:1.5;">
      If the button does not work, copy and paste this link into your browser:<br>
      <a href="${escapeHtml(url)}" style="color:${BRAND};word-break:break-all;">${escapeHtml(url)}</a>
    </p>`;
}

function tag(text: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;
    font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.05em;color:${color};background:${bg};"
  >${text}</span>`;
}

function signature(): string {
  const name = appName();
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="width:100%;margin-top:32px;border-top:1px solid ${BORDER};border-collapse:collapse;">
      <tr>
        <td style="padding-top:20px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;
                    color:${TEXT_SEC};margin:0 0 2px;line-height:1.5;">
            Best regards,
          </p>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;
                    color:${TEXT};margin:0 0 1px;">
            ${escapeHtml(name)} E-Signing
          </p>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;
                    color:${TEXT_MUT};margin:0;">
            This is an automated notification — please do not reply to this email.
          </p>
        </td>
      </tr>
    </table>`;
}

/**
 * Wraps content in the shared email shell.
 * @param body   - Inner HTML content
 * @param footer - Optional extra footer text
 */
function shell(body: string, footer?: string, completion = false): string {
  const year = new Date().getFullYear();
  const name = appName();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style>
    table { border-collapse: collapse; }
    td { font-family: Arial, Helvetica, sans-serif; }
  </style>
  <![endif]-->
  <title>${escapeHtml(name)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:${BG};border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!--[if mso]>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="580" style="width:580px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td>
        <![endif]-->
        <!--[if !mso]><!-->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:580px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
        <!--<![endif]-->

          <!-- Brand accent bar -->
          <tr>
            <td style="background:${BRAND};height:4px;line-height:4px;font-size:1px;border-radius:6px 6px 0 0;">&nbsp;</td>
          </tr>

          <!-- Card body -->
          <tr>
            <td style="background:#ffffff;padding:36px 40px 28px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border:1px solid ${BORDER};border-top:none;border-radius:0 0 6px 6px;
                       padding:16px 40px 20px;font-family:Arial,Helvetica,sans-serif;">
              ${footer ?? ''}
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${TEXT_MUT};
                        margin:${footer ? '12px' : '0'} 0 0;line-height:1.6;">
                &copy; ${year} ${escapeHtml(name)} &nbsp;&middot;&nbsp; E-Signing${completion ? ' &nbsp;&middot;&nbsp; Oaktree Accounting &amp; Corporate Solutions' : ''}
              </p>
            </td>
          </tr>

        <!--[if !mso]><!-->
        </table>
        <!--<![endif]-->
        <!--[if mso]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
  </body>
</html>`.trim();
}

function completionPlainText(input: {
  recipientName: string;
  envelopeTitle: string;
  documentLinks: Array<{
    label: string;
    signedUrl: string;
    certificateUrl?: string | null;
  }>;
  hasAttachments: boolean;
}): string {
  const clean = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lines = [
    'All signatures collected',
    `Hello ${clean(input.recipientName)},`,
    `The signing workflow for "${clean(input.envelopeTitle)}" is now complete.`,
    input.hasAttachments
      ? 'Your signed copy is attached to this email.'
      : 'Signed documents are listed below.',
    '',
    ...input.documentLinks.map((document) => clean(document.label)),
    '',
    `© ${new Date().getFullYear()} ${appName()} · E-Signing · Oaktree Accounting & Corporate Solutions`,
  ];

  return lines.join('\n');
}

async function safeSendEmail(
  kind: EsigningEmailDeliveryKind,
  input: Parameters<typeof sendEmail>[0]
): Promise<EsigningEmailDeliveryResult> {
  const attemptedAt = new Date().toISOString();
  const result = await sendEmail(input);
  if (!result.success) {
    log.error('Failed to send e-signing email', {
      recipientType: input.to ? 'to' : 'bcc',
      subject: input.subject,
      error: result.error,
    });
  }
  const recipientLabel = input.to
    ? (Array.isArray(input.to) ? input.to.join(', ') : input.to)
    : 'Undisclosed recipient';
  return {
    ok: result.success,
    kind,
    to: recipientLabel,
    subject: input.subject,
    attemptedAt,
    error: result.success ? undefined : result.error,
    providerMessageId: result.success ? result.messageId : null,
  };
}

// ── Email templates ───────────────────────────────────────────────────────────

export async function sendEsigningRequestEmail(input: {
  to: string;
  recipientName: string;
  senderName: string;
  envelopeTitle: string;
  emailSubject?: string | null;
  message?: string | null;
  signingUrl: string;
  accessMode: 'EMAIL_LINK' | 'EMAIL_WITH_CODE' | 'MANUAL_LINK';
  expiresAt?: Date | null;
  kind?: 'request' | 'reminder';
}): Promise<EsigningEmailDeliveryResult> {
  const isReminder = input.kind === 'reminder';
  const expiresText = formatDateTime(input.expiresAt ?? null);

  const body = `
    ${isReminder
      ? `<p style="margin:0 0 4px;">${tag('REMINDER', WARN, '#fef3c7')}</p>`
      : ''}

    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;
               color:${TEXT};margin:${isReminder ? '12px' : '0'} 0 6px;line-height:1.3;">
      ${escapeHtml(isReminder ? `Still waiting for your signature` : `You have a document to sign`)}
    </h1>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};margin:0 0 6px;line-height:1.6;">
      Hello <strong>${escapeHtml(input.recipientName)}</strong>,
    </p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 20px;line-height:1.6;">
      ${isReminder
        ? `<strong style="color:${TEXT};">${escapeHtml(input.senderName)}</strong> is following up — your signature on the document below is still needed.`
        : `<strong style="color:${TEXT};">${escapeHtml(input.senderName)}</strong> has requested your electronic signature on the following document:`
      }
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:${BRAND_LT};border-radius:8px;margin-bottom:20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;
                    letter-spacing:0.08em;color:${BRAND};margin:0 0 4px;text-transform:uppercase;">
            Document
          </p>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;
                    color:${TEXT};margin:0;">
            ${escapeHtml(input.envelopeTitle)}
          </p>
          ${expiresText
            ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${WARN};margin:8px 0 0;">
                 &#9679; Expires ${escapeHtml(expiresText)}
               </p>`
            : ''}
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0;line-height:1.6;">
      ${isReminder
        ? `Please review and sign at your earliest convenience.`
        : `Click the button below to review and add your electronic signature. The process takes just a few minutes.`
      }
    </p>

    ${input.message
      ? `<blockquote style="border-left:3px solid ${BORDER};margin:20px 0 0;padding:10px 16px;
                            font-family:Arial,Helvetica,sans-serif;font-size:13px;
                            color:${TEXT_SEC};line-height:1.6;white-space:pre-wrap;"
          >${escapeHtml(input.message)}</blockquote>`
      : ''}

    ${ctaButton('Review and Sign', input.signingUrl)}
    ${fallbackLink(input.signingUrl)}
    ${signature()}`;

  const subjectLabel = input.emailSubject?.trim() || input.envelopeTitle;
  const emailSubject = isReminder
    ? subject(`Reminder: "${subjectLabel}" awaits your signature`)
    : subject(`"${subjectLabel}" — signature requested by ${input.senderName}`);

  return safeSendEmail(isReminder ? 'reminder' : 'request', {
    to: input.to,
    subject: emailSubject,
    html: shell(body),
  });
}

export async function sendEsigningCompletionEmail(input: {
  to?: string;
  bcc?: string;
  recipientName: string;
  envelopeTitle: string;
  certificateId: string;
  documentLinks: Array<{
    label: string;
    signedUrl: string;
    certificateUrl?: string | null;
  }>;
  attachments?: EmailAttachment[];
  actorType?: 'recipient' | 'sender';
}): Promise<EsigningEmailDeliveryResult> {
  const hasAttachments = Boolean(input.attachments?.length);

  const docRows = input.documentLinks.map((dl) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
          <tr>
            <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT};
                       font-weight:bold;padding-right:12px;">
              &#128196; ${escapeHtml(dl.label)}
            </td>

          </tr>
        </table>
      </td>
    </tr>`).join('');

  const body = `
    <p style="margin:0 0 4px;">${tag('COMPLETED', SUCCESS, '#d1fae5')}</p>

    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;
               color:${TEXT};margin:12px 0 6px;line-height:1.3;">
      All signatures collected
    </h1>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};margin:0 0 6px;line-height:1.6;">
      Hello <strong>${escapeHtml(input.recipientName)}</strong>,
    </p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 20px;line-height:1.6;">
      The signing workflow for <strong style="color:${TEXT};">${escapeHtml(input.envelopeTitle)}</strong> is now complete.
      ${hasAttachments ? 'Your signed copy is attached to this email.' : 'Signed documents are listed below.'}
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;
              color:${TEXT};margin:0 0 4px;">
      ${hasAttachments ? 'Signed documents (attached):' : 'Signed documents:'}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="width:100%;margin-bottom:24px;border-collapse:collapse;">
      ${docRows}
    </table>

    ${signature()}`;

  return safeSendEmail('completion', {
    to: input.to,
    bcc: input.bcc,
    subject: subject(`Completed: "${input.envelopeTitle}"`),
    attachments: input.attachments,
    text: completionPlainText({
      recipientName: input.recipientName,
      envelopeTitle: input.envelopeTitle,
      documentLinks: input.documentLinks,
      hasAttachments,
    }),
    html: shell(body, undefined, true),
  });
}

export async function sendEsigningDeclinedEmailToSender(input: {
  to: string;
  senderName: string;
  envelopeTitle: string;
  recipientName: string;
  declineReason?: string | null;
}): Promise<EsigningEmailDeliveryResult> {
  const body = `
    <p style="margin:0 0 4px;">${tag('DECLINED', ERROR, '#fee2e2')}</p>

    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;
               color:${TEXT};margin:12px 0 6px;line-height:1.3;">
      Signature declined
    </h1>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 20px;line-height:1.6;">
      Hello <strong style="color:${TEXT};">${escapeHtml(input.senderName)}</strong>,
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:#fef2f2;border-left:4px solid #fca5a5;border-radius:0 6px 6px 0;margin-bottom:20px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};margin:0;line-height:1.6;">
            <strong>${escapeHtml(input.recipientName)}</strong> declined to sign
            <strong>${escapeHtml(input.envelopeTitle)}</strong>.
          </p>
          ${input.declineReason
            ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT_SEC};
                         margin:10px 0 0;line-height:1.5;">
                 <strong>Reason:</strong> ${escapeHtml(input.declineReason)}
               </p>`
            : ''}
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT_SEC};margin:0;line-height:1.6;">
      You may void the envelope or contact the recipient directly to resolve this.
    </p>
    ${signature()}`;

  return safeSendEmail('declined', {
    to: input.to,
    subject: subject(`Declined: "${input.envelopeTitle}"`),
    html: shell(body),
  });
}

export async function sendEsigningPdfFailureEmailToSender(input: {
  to: string;
  senderName: string;
  envelopeTitle: string;
  errorMessage: string;
}): Promise<EsigningEmailDeliveryResult> {
  const body = `
    <p style="margin:0 0 4px;">${tag('ACTION REQUIRED', ERROR, '#fee2e2')}</p>

    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;
               color:${TEXT};margin:12px 0 6px;line-height:1.3;">
      Signed documents could not be prepared
    </h1>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 20px;line-height:1.6;">
      Hello <strong style="color:${TEXT};">${escapeHtml(input.senderName)}</strong>,
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 16px;line-height:1.6;">
      All signatures for <strong style="color:${TEXT};">${escapeHtml(input.envelopeTitle)}</strong> were captured,
      but Oakcloud could not finish preparing the signed PDF package.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:#fef2f2;border-left:4px solid #fca5a5;border-radius:0 6px 6px 0;margin-bottom:20px;">
      <tr>
        <td style="padding:12px 16px;">
          <p style="font-family:'Courier New',Courier,monospace;font-size:12px;
                    color:${ERROR};margin:0;word-break:break-all;line-height:1.5;">
            ${escapeHtml(input.errorMessage)}
          </p>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT_SEC};margin:0;line-height:1.6;">
      Please contact support if this issue persists.
    </p>
    ${signature()}`;

  return safeSendEmail('pdf_failure', {
    to: input.to,
    subject: subject(`Action required: signed documents could not be prepared`),
    html: shell(body),
  });
}

export async function sendEsigningReminderEmail(input: {
  to: string;
  recipientName: string;
  senderName: string;
  envelopeTitle: string;
  emailSubject?: string | null;
  message?: string | null;
  signingUrl: string;
  accessMode: 'EMAIL_LINK' | 'EMAIL_WITH_CODE' | 'MANUAL_LINK';
  expiresAt?: Date | null;
}): Promise<EsigningEmailDeliveryResult> {
  return sendEsigningRequestEmail({ ...input, kind: 'reminder' });
}

export async function sendEsigningExpiryWarningEmailToSender(input: {
  to: string;
  senderName: string;
  envelopeTitle: string;
  daysUntilExpiry: number;
  pendingRecipients: Array<{ name: string; email: string }>;
  envelopeId: string;
}): Promise<EsigningEmailDeliveryResult> {
  const envelopeUrl = `${getAppBaseUrl()}/esigning/${encodeURIComponent(input.envelopeId)}`;
  const dayLabel = `${input.daysUntilExpiry} day${input.daysUntilExpiry === 1 ? '' : 's'}`;

  const pendingRows = input.pendingRecipients.map((r) => `
    <tr>
      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT};
                 padding:7px 0;border-bottom:1px solid ${BORDER};">
        ${escapeHtml(r.name)}
        <span style="color:${TEXT_MUT};margin-left:6px;">${escapeHtml(r.email)}</span>
      </td>
    </tr>`).join('');

  const body = `
    <p style="margin:0 0 4px;">${tag('EXPIRY WARNING', WARN, '#fef3c7')}</p>

    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;
               color:${TEXT};margin:12px 0 6px;line-height:1.3;">
      Envelope expires in ${escapeHtml(dayLabel)}
    </h1>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 20px;line-height:1.6;">
      Hello <strong style="color:${TEXT};">${escapeHtml(input.senderName)}</strong>,
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:#fffbeb;border-left:4px solid #fbbf24;border-radius:0 6px 6px 0;margin-bottom:20px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};margin:0;line-height:1.6;">
            <strong>${escapeHtml(input.envelopeTitle)}</strong> is due to expire in
            <strong>${escapeHtml(dayLabel)}</strong>.
          </p>
        </td>
      </tr>
    </table>

    ${input.pendingRecipients.length > 0
      ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;
                   color:${TEXT};margin:0 0 8px;">
           Still pending (${input.pendingRecipients.length}):
         </p>
         <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                style="margin-bottom:20px;">
           ${pendingRows}
         </table>`
      : ''}

    ${ctaButton('Open Envelope', envelopeUrl)}
    ${signature()}`;

  return safeSendEmail('expiry_warning', {
    to: input.to,
    subject: subject(`Expiry warning: "${input.envelopeTitle}" expires in ${dayLabel}`),
    html: shell(body),
  });
}

export async function sendEsigningExpiredEmailToSender(input: {
  to: string;
  senderName: string;
  envelopeTitle: string;
  expiredAt: Date;
  pendingRecipients: Array<{ name: string; email: string }>;
  envelopeId: string;
}): Promise<EsigningEmailDeliveryResult> {
  const envelopeUrl = `${getAppBaseUrl()}/esigning/${encodeURIComponent(input.envelopeId)}`;
  const expiredText = formatDateTime(input.expiredAt);

  const pendingRows = input.pendingRecipients.map((r) => `
    <tr>
      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT};
                 padding:7px 0;border-bottom:1px solid ${BORDER};">
        ${escapeHtml(r.name)}
        <span style="color:${TEXT_MUT};margin-left:6px;">${escapeHtml(r.email)}</span>
      </td>
    </tr>`).join('');

  const body = `
    <p style="margin:0 0 4px;">${tag('EXPIRED', ERROR, '#fee2e2')}</p>

    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;
               color:${TEXT};margin:12px 0 6px;line-height:1.3;">
      Envelope has expired
    </h1>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 20px;line-height:1.6;">
      Hello <strong style="color:${TEXT};">${escapeHtml(input.senderName)}</strong>,
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:#fef2f2;border-left:4px solid #fca5a5;border-radius:0 6px 6px 0;margin-bottom:20px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};margin:0;line-height:1.6;">
            <strong>${escapeHtml(input.envelopeTitle)}</strong> expired
            ${expiredText ? `on <strong>${escapeHtml(expiredText)}</strong>` : ''}
            before all signatures were collected.
          </p>
        </td>
      </tr>
    </table>

    ${input.pendingRecipients.length > 0
      ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;
                   color:${TEXT};margin:0 0 8px;">
           Pending recipients at expiry (${input.pendingRecipients.length}):
         </p>
         <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                style="margin-bottom:20px;">
           ${pendingRows}
         </table>`
      : ''}

    ${ctaButton('Review Envelope', envelopeUrl)}
    ${signature()}`;

  return safeSendEmail('expired', {
    to: input.to,
    subject: subject(`Expired: "${input.envelopeTitle}"`),
    html: shell(body),
  });
}

export async function sendEsigningVoidedEmailToRecipient(input: {
  to: string;
  recipientName: string;
  envelopeTitle: string;
  senderName: string;
  reason?: string | null;
}): Promise<EsigningEmailDeliveryResult> {
  const body = `
    <p style="margin:0 0 4px;">${tag('CANCELLED', TEXT_SEC, '#f3f4f6')}</p>

    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;
               color:${TEXT};margin:12px 0 6px;line-height:1.3;">
      Signing request cancelled
    </h1>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT_SEC};margin:0 0 20px;line-height:1.6;">
      Hello <strong style="color:${TEXT};">${escapeHtml(input.recipientName)}</strong>,
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:#f9fafb;border-left:4px solid #d1d5db;border-radius:0 6px 6px 0;margin-bottom:20px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};margin:0;line-height:1.6;">
            <strong>${escapeHtml(input.senderName)}</strong> has cancelled the signing request for
            <strong>${escapeHtml(input.envelopeTitle)}</strong>.
          </p>
          ${input.reason
            ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT_SEC};
                         margin:10px 0 0;line-height:1.5;">
                 <strong>Reason:</strong> ${escapeHtml(input.reason)}
               </p>`
            : ''}
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT_SEC};margin:0;line-height:1.6;">
      You can ignore any previous signing link for this envelope. No further action is required.
    </p>
    ${signature()}`;

  return safeSendEmail('voided', {
    to: input.to,
    subject: subject(`Cancelled: "${input.envelopeTitle}"`),
    html: shell(body),
  });
}

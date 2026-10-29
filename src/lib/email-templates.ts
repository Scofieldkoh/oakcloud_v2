/**
 * Email Templates
 *
 * Professional email templates for all system notifications.
 * All templates follow a consistent design language.
 */

import { getAppBaseUrl } from './email';

// ============================================================================
// Base Template
// ============================================================================

interface BaseTemplateOptions {
  title: string;
  preheader?: string;
  content: string;
  footerText?: string;
}

/**
 * Base email template wrapper with consistent styling
 */
function baseTemplate({ title, preheader, content, footerText }: BaseTemplateOptions): string {
  const baseUrl = getAppBaseUrl();
  const currentYear = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset styles */
    body, table, td, p, a, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100%; }

    /* Base styles */
    .email-wrapper { background-color: #edf2f0; padding: 40px 20px; }
    .email-container { max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #d6e4de; box-shadow: 0 10px 26px rgba(18, 40, 33, 0.08); }
    .email-header { background: linear-gradient(135deg, #173a32 0%, #2c6154 100%); padding: 28px 40px; text-align: center; }
    .email-header h1 { color: #ffffff; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 30px; font-weight: 700; letter-spacing: 0.4px; margin: 0; }
    .email-header p { color: #d5e8e1; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 8px 0 0 0; }
    .email-body { padding: 40px; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.65; color: #2a3540; }
    .email-body h2 { color: #17222d; font-size: 24px; font-weight: 700; margin: 0 0 14px 0; }
    .email-body p { margin: 0 0 16px 0; }
    .email-body .greeting { font-size: 16px; margin-bottom: 20px; }
    .email-body .message { margin-bottom: 24px; }
    .email-body a { color: #1a5a4c; }
    .invite-badge { display: inline-block; margin: 0 0 14px 0; padding: 6px 12px; background-color: #e7f2ee; border: 1px solid #c2ddd4; border-radius: 999px; color: #1a5549; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
    .section-heading { color: #17222d; font-size: 15px; font-weight: 700; margin: 0 0 10px 0; }
    .secondary-text { color: #5b6672; font-size: 13px; margin: 0 0 10px 0; }
    .steps { margin: 0 0 24px 20px; padding: 0; color: #2a3540; }
    .steps li { margin: 0 0 8px 0; }

    /* Button styles */
    .btn-container { text-align: center; margin: 30px 0 20px 0; }
    .btn { display: inline-block; background-color: #1a4f43; border: 1px solid #143a32; color: #ffffff !important; font-size: 15px; font-weight: 700; text-decoration: none !important; padding: 14px 32px; border-radius: 8px; line-height: 1; }
    .btn span { color: #ffffff !important; text-decoration: none !important; }

    /* Info box */
    .info-box { background-color: #f8fbfa; border: 1px solid #d9e6e2; border-radius: 8px; padding: 18px; margin: 14px 0 24px 0; }
    .info-box p { margin: 0; }
    .info-box .label { font-size: 12px; color: #5c6370; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .info-box .value { font-size: 14px; color: #1b2732; font-weight: 500; word-break: break-all; line-height: 1.5; }

    /* Credentials box */
    .credentials-box { background-color: #f2faf7; border: 1px solid #c8e3d8; border-radius: 8px; padding: 20px; margin: 24px 0; }
    .credentials-box .item { margin-bottom: 14px; }
    .credentials-box .item:last-child { margin-bottom: 0; }
    .credentials-box .label { font-size: 11px; color: #4d5d68; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin-bottom: 6px; }
    .credentials-box .value { font-size: 15px; color: #1a1d23; font-weight: 600; font-family: 'SF Mono', Monaco, 'Courier New', monospace; background-color: #ffffff; border: 1px solid #d5e5df; border-radius: 6px; padding: 10px 12px; }
    .credentials-box .panel-title { color: #17222d; font-size: 14px; font-weight: 700; margin: 0 0 14px 0; }

    /* Warning box */
    .warning-box { background-color: #fff7db; border: 1px solid #f1d27a; border-radius: 8px; padding: 16px; margin: 24px 0; font-size: 13px; color: #6c5117; line-height: 1.6; }

    /* Footer styles */
    .email-footer { background-color: #f6faf8; border-top: 1px solid #dce8e3; padding: 24px 40px; text-align: center; }
    .email-footer p { font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 13px; color: #6f7a85; margin: 0 0 8px 0; }
    .email-footer a { color: #1a5a4c; text-decoration: none; }
    .email-footer .security-note { font-size: 12px; color: #a0a5b0; margin-top: 16px; }

    /* Preheader - hidden text for email clients */
    .preheader { display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; mso-hide: all; }

    /* Responsive */
    @media only screen and (max-width: 620px) {
      .email-wrapper { padding: 20px 10px; }
      .email-header, .email-body, .email-footer { padding-left: 24px; padding-right: 24px; }
      .email-header h1 { font-size: 26px; }
      .email-body h2 { font-size: 21px; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: #edf2f0;">
  ${preheader ? `<span class="preheader" style="display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; max-height: 0; max-width: 0; overflow: hidden; mso-hide: all;">${preheader}</span>` : ''}
  <div class="email-wrapper" style="background-color: #edf2f0; padding: 40px 20px;">
    <div class="email-container" style="max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #d6e4de; box-shadow: 0 10px 26px rgba(18, 40, 33, 0.08);">
      <div class="email-header" style="background-color: #1f4e42; background-image: linear-gradient(135deg, #173a32 0%, #2c6154 100%); padding: 28px 40px; text-align: center;">
        <h1 style="color: #ffffff; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 30px; font-weight: 700; letter-spacing: 0.4px; margin: 0;">Oakcloud</h1>
        <p style="color: #d5e8e1; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 8px 0 0 0;">Practice Management for Accounting Firms</p>
      </div>
      <div class="email-body" style="padding: 40px; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.65; color: #2a3540;">
        ${content}
      </div>
      <div class="email-footer" style="background-color: #f6faf8; border-top: 1px solid #dce8e3; padding: 24px 40px; text-align: center;">
        ${footerText ? `<p style="font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 13px; color: #6f7a85; margin: 0 0 8px 0;">${footerText}</p>` : ''}
        <p style="font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 13px; color: #6f7a85; margin: 0 0 8px 0;">&copy; ${currentYear} Oakcloud. All rights reserved.</p>
        <p class="security-note" style="font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif; font-size: 12px; color: #a0a5b0; margin-top: 16px; margin-bottom: 0;">
          This email was sent from <a href="${baseUrl}" style="color: #1a5a4c; text-decoration: none;">${baseUrl}</a><br>
          If you didn't request this email, you can safely ignore it.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ============================================================================
// Password Reset Email
// ============================================================================

export interface PasswordResetEmailParams {
  firstName: string;
  lastName: string;
  email: string;
  resetUrl: string;
  expiryHours?: number;
}

export function passwordResetEmail(params: PasswordResetEmailParams): { subject: string; html: string } {
  const { firstName, resetUrl, expiryHours = 24 } = params;
  const name = firstName || 'there';

  const content = `
    <p style="margin: 0 0 12px 0;">
      <span style="display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid #c2ddd4; background-color: #e7f2ee; color: #1a5549; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">Security action</span>
    </p>

    <h2 style="margin: 0 0 14px 0; color: #17222d; font-size: 24px; font-weight: 700; line-height: 1.3; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif;">
      Reset your password
    </h2>

    <p style="margin: 0 0 20px 0; font-size: 16px; color: #2a3540;">Hi ${name},</p>

    <p style="margin: 0 0 22px 0; color: #2a3540; line-height: 1.7;">
      We received a request to reset your Oakcloud password.
      Use the button below to create a new password.
    </p>

    <table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin: 0 auto 18px auto;">
      <tr>
        <td align="center" style="border-radius: 8px; background-color: #1a4f43; border: 1px solid #143a32;">
          <a href="${resetUrl}" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif;">Reset Password</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 10px 0; color: #5b6672; font-size: 13px;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0; border-collapse: separate; border: 1px solid #d9e6e2; border-radius: 8px; background-color: #f8fbfa;">
      <tr>
        <td style="padding: 14px 16px; font-size: 14px; line-height: 1.5; color: #1b2732; word-break: break-all;">
          ${resetUrl}
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0; border-collapse: separate; border: 1px solid #f1d27a; border-radius: 8px; background-color: #fff7db;">
      <tr>
        <td style="padding: 16px; font-size: 13px; line-height: 1.6; color: #6c5117;">
          <strong>This link will expire in ${expiryHours} hours.</strong>
          If you didn't request a password reset, please ignore this email or contact your administrator.
        </td>
      </tr>
    </table>

    <p style="margin: 0; color: #2a3540; line-height: 1.7;">
      For security reasons, this link can only be used once. If you need to reset your password again,
      request a new link from the login page.
    </p>
  `;

  return {
    subject: 'Reset your Oakcloud password',
    html: baseTemplate({
      title: 'Password Reset Request',
      preheader: `Reset your password for Oakcloud. This link expires in ${expiryHours} hours.`,
      content,
    }),
  };
}

// ============================================================================
// User Invitation Email
// ============================================================================

export interface UserInvitationEmailParams {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
  tenantName: string;
  invitedByName?: string;
  loginUrl?: string;
}

export function userInvitationEmail(params: UserInvitationEmailParams): { subject: string; html: string } {
  const { firstName, email, temporaryPassword, tenantName, invitedByName, loginUrl } = params;
  const baseUrl = getAppBaseUrl();
  const name = firstName || 'there';
  const inviter = invitedByName ? ` by ${invitedByName}` : '';
  const signInUrl = loginUrl || `${baseUrl}/login`;

  const content = `
    <p style="margin: 0 0 12px 0;">
      <span style="display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid #c2ddd4; background-color: #e7f2ee; color: #1a5549; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">New account invitation</span>
    </p>

    <h2 style="margin: 0 0 14px 0; color: #17222d; font-size: 24px; font-weight: 700; line-height: 1.3; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif;">
      Welcome to Oakcloud
    </h2>

    <p style="margin: 0 0 20px 0; font-size: 16px; color: #2a3540;">Hi ${name},</p>

    <p style="margin: 0 0 22px 0; color: #2a3540; line-height: 1.7;">
      You've been invited${inviter} to join <strong>${tenantName}</strong> on Oakcloud,
      the practice management platform for accounting firms.
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0; border-collapse: separate; border: 1px solid #c8e3d8; border-radius: 8px; background-color: #f2faf7;">
      <tr>
        <td style="padding: 18px;">
          <p style="margin: 0 0 14px 0; font-size: 14px; font-weight: 700; color: #17222d;">Your sign-in details</p>

          <p style="margin: 0 0 6px 0; font-size: 11px; color: #4d5d68; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;">Email</p>
          <p style="margin: 0 0 12px 0; font-size: 15px; color: #1a1d23; font-family: 'SF Mono', Monaco, 'Courier New', monospace; background-color: #ffffff; border: 1px solid #d5e5df; border-radius: 6px; padding: 10px 12px;">
            <a href="mailto:${email}" style="color: #183f35; text-decoration: none;">${email}</a>
          </p>

          <p style="margin: 0 0 6px 0; font-size: 11px; color: #4d5d68; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;">Temporary password</p>
          <p style="margin: 0; font-size: 15px; color: #1a1d23; font-family: 'SF Mono', Monaco, 'Courier New', monospace; background-color: #ffffff; border: 1px solid #d5e5df; border-radius: 6px; padding: 10px 12px;">
            ${temporaryPassword}
          </p>
        </td>
      </tr>
    </table>

    <table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin: 0 auto 18px auto;">
      <tr>
        <td align="center" style="border-radius: 8px; background-color: #1a4f43; border: 1px solid #143a32;">
          <a href="${signInUrl}" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif;">Log In to Oakcloud</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 10px 0; color: #5b6672; font-size: 13px;">
      If the button doesn't work, copy and paste this URL into your browser:
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0; border-collapse: separate; border: 1px solid #d9e6e2; border-radius: 8px; background-color: #f8fbfa;">
      <tr>
        <td style="padding: 14px 16px; font-size: 14px; line-height: 1.5; color: #1b2732; word-break: break-all;">
          ${signInUrl}
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0; border-collapse: separate; border: 1px solid #f1d27a; border-radius: 8px; background-color: #fff7db;">
      <tr>
        <td style="padding: 16px; font-size: 13px; line-height: 1.6; color: #6c5117;">
          <strong>Security reminder:</strong> You'll be asked to create a new password when you first sign in.
          Please choose a strong password with at least 8 characters, including uppercase, lowercase, and numbers.
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 10px 0; color: #17222d; font-size: 15px; font-weight: 700;">What to do next</p>
    <ol style="margin: 0 0 24px 20px; padding: 0; color: #2a3540;">
      <li style="margin: 0 0 8px 0;">Sign in with the email and temporary password above.</li>
      <li style="margin: 0 0 8px 0;">Create your new password and keep it private.</li>
      <li style="margin: 0;">Review your account and start working in ${tenantName}.</li>
    </ol>

    <p style="margin: 0; color: #2a3540;">
      If you have any questions, please reach out to your administrator or the person who invited you.
    </p>
  `;

  return {
    subject: `You've been invited to join ${tenantName} on Oakcloud`,
    html: baseTemplate({
      title: 'Welcome to Oakcloud',
      preheader: `${invitedByName || 'Your administrator'} invited you to join ${tenantName}. Sign in securely with your temporary password.`,
      content,
      footerText: `You received this email because you were invited to ${tenantName} on Oakcloud.`,
    }),
  };
}

// ============================================================================
// Tenant Setup Complete Email (Admin Welcome)
// ============================================================================

export interface TenantSetupEmailParams {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
  tenantName: string;
  loginUrl?: string;
}

export function tenantSetupCompleteEmail(params: TenantSetupEmailParams): { subject: string; html: string } {
  const { firstName, email, temporaryPassword, tenantName, loginUrl } = params;
  const baseUrl = getAppBaseUrl();
  const name = firstName || 'there';

  const content = `
    <h2>Your Oakcloud Account is Ready!</h2>

    <p class="greeting">Hi ${name},</p>

    <p class="message">
      Great news! Your organization <strong>${tenantName}</strong> has been set up on Oakcloud.
      You've been assigned as the Tenant Administrator.
    </p>

    <p>Here are your login credentials:</p>

    <div class="credentials-box">
      <div class="item">
        <div class="label">Email</div>
        <div class="value">${email}</div>
      </div>
      <div class="item">
        <div class="label">Temporary Password</div>
        <div class="value">${temporaryPassword}</div>
      </div>
    </div>

    <div class="btn-container">
      <a href="${loginUrl || `${baseUrl}/login`}" class="btn">Log In to Oakcloud</a>
    </div>

    <div class="warning-box">
      <strong>Security Notice:</strong> You'll be required to change your password on first login.
      Please choose a strong password with at least 8 characters, including uppercase, lowercase, and numbers.
    </div>

    <h2 style="margin-top: 32px;">Getting Started</h2>

    <p>As a Tenant Administrator, you can:</p>
    <ul style="margin: 16px 0; padding-left: 24px;">
      <li>Invite team members to your organization</li>
      <li>Create and manage companies</li>
      <li>Configure roles and permissions</li>
      <li>Upload and extract BizFile documents</li>
      <li>View audit logs and activity</li>
    </ul>

    <p>
      If you have any questions or need assistance, please contact support.
    </p>
  `;

  return {
    subject: `Welcome to Oakcloud - Your ${tenantName} account is ready`,
    html: baseTemplate({
      title: 'Account Ready',
      preheader: `Your ${tenantName} organization is now active on Oakcloud. Log in to get started.`,
      content,
    }),
  };
}

// ============================================================================
// Password Changed Confirmation Email
// ============================================================================

export interface PasswordChangedEmailParams {
  firstName: string;
  lastName: string;
  email: string;
  changedAt: Date;
}

export function passwordChangedEmail(params: PasswordChangedEmailParams): { subject: string; html: string } {
  const { firstName, email, changedAt } = params;
  const baseUrl = getAppBaseUrl();
  const name = firstName || 'there';
  const formattedDate = changedAt.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const content = `
    <h2>Password Changed Successfully</h2>

    <p class="greeting">Hi ${name},</p>

    <p class="message">
      This is a confirmation that the password for your Oakcloud account
      (<strong>${email}</strong>) was successfully changed.
    </p>

    <div class="info-box">
      <p class="label">Password Changed On</p>
      <p class="value">${formattedDate}</p>
    </div>

    <div class="warning-box">
      <strong>Didn't make this change?</strong><br>
      If you didn't change your password, your account may have been compromised.
      Please immediately:
      <ol style="margin: 8px 0 0 0; padding-left: 20px;">
        <li>Reset your password using the <a href="${baseUrl}/forgot-password">forgot password</a> page</li>
        <li>Contact your administrator</li>
      </ol>
    </div>

    <p>
      If you made this change, no further action is required. You can safely ignore this email.
    </p>
  `;

  return {
    subject: 'Your Oakcloud password was changed',
    html: baseTemplate({
      title: 'Password Changed',
      preheader: 'Your Oakcloud password was successfully changed.',
      content,
    }),
  };
}

// ============================================================================
// User Removed from Tenant Email
// ============================================================================

export interface UserRemovedEmailParams {
  firstName: string;
  lastName: string;
  email: string;
  tenantName: string;
  removedByName?: string;
}

export function userRemovedEmail(params: UserRemovedEmailParams): { subject: string; html: string } {
  const { firstName, tenantName, removedByName } = params;
  const name = firstName || 'there';
  const remover = removedByName ? ` by ${removedByName}` : '';

  const content = `
    <p style="margin: 0 0 12px 0;">
      <span style="display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid #ead3d3; background-color: #fff1f1; color: #9f2f2f; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">Access update</span>
    </p>

    <h2 style="margin: 0 0 14px 0; color: #17222d; font-size: 24px; font-weight: 700; line-height: 1.3; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif;">
      Account access removed
    </h2>

    <p style="margin: 0 0 20px 0; font-size: 16px; color: #2a3540;">Hi ${name},</p>

    <p style="margin: 0 0 20px 0; color: #2a3540; line-height: 1.7;">
      Your access to <strong>${tenantName}</strong> on Oakcloud has been removed${remover}.
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0; border-collapse: separate; border: 1px solid #f1d27a; border-radius: 8px; background-color: #fff7db;">
      <tr>
        <td style="padding: 16px; font-size: 13px; line-height: 1.6; color: #6c5117;">
          You can no longer sign in to this organization with your current account.
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 12px 0; color: #2a3540; line-height: 1.7;">
      If you believe this change was made in error, contact your organization's administrator.
    </p>

    <p style="margin: 0; color: #2a3540;">
      Thank you for using Oakcloud.
    </p>
  `;

  return {
    subject: `Your access to ${tenantName} has been removed`,
    html: baseTemplate({
      title: 'Access Removed',
      preheader: `Your access to ${tenantName} on Oakcloud has been removed.`,
      content,
    }),
  };
}

// ============================================================================
// Generic Notification Email
// ============================================================================

export interface NotificationEmailParams {
  firstName: string;
  subject: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
}

export function notificationEmail(params: NotificationEmailParams): { subject: string; html: string } {
  const { firstName, subject, title, message, actionUrl, actionText } = params;
  const name = firstName || 'there';

  const content = `
    <h2>${title}</h2>

    <p class="greeting">Hi ${name},</p>

    <div class="message">
      ${message}
    </div>

    ${actionUrl ? `
    <div class="btn-container">
      <a href="${actionUrl}" class="btn">${actionText || 'Take Action'}</a>
    </div>
    ` : ''}
  `;

  return {
    subject,
    html: baseTemplate({
      title,
      content,
    }),
  };
}

// ============================================================================
// Form Draft Email
// ============================================================================

export interface FormDraftEmailParams {
  formTitle: string;
  resumeUrl: string;
}

export function formDraftEmail(params: FormDraftEmailParams): { subject: string; html: string } {
  const { formTitle, resumeUrl } = params;

  const safeFormTitle = formTitle.replace(/[<>&"]/g, (m) =>
    m === '<' ? '&lt;' : m === '>' ? '&gt;' : m === '&' ? '&amp;' : '&quot;'
  );
  const safeResumeUrl = resumeUrl.replace(/[<>&"]/g, (m) =>
    m === '<' ? '&lt;' : m === '>' ? '&gt;' : m === '&' ? '&amp;' : '&quot;'
  );

  const content = `
    <p style="margin: 0 0 12px 0;">
      <span style="display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid #c2ddd4; background-color: #e7f2ee; color: #1a5549; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">Form draft</span>
    </p>

    <h2 style="margin: 0 0 14px 0; color: #17222d; font-size: 24px; font-weight: 700; line-height: 1.3; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif;">
      Your draft has been saved
    </h2>

    <p style="margin: 0 0 22px 0; color: #2a3540; line-height: 1.7;">
      Use the secure resume link below to continue your response for <strong>${safeFormTitle}</strong>.
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0; border-collapse: separate; border: 1px solid #c8e3d8; border-radius: 8px; background-color: #f2faf7;">
      <tr>
        <td style="padding: 18px;">
          <p style="margin: 0 0 14px 0; font-size: 14px; font-weight: 700; color: #17222d;">Your secure resume link</p>
          <p style="margin: 0 0 6px 0; font-size: 11px; color: #4d5d68; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;">Resume link</p>
          <p style="margin: 0; font-size: 13px; color: #1b2732; background-color: #ffffff; border: 1px solid #d5e5df; border-radius: 6px; padding: 10px 14px; word-break: break-all; line-height: 1.5;">
            <a href="${safeResumeUrl}" style="color: #1a5a4c; text-decoration: none;">${safeResumeUrl}</a>
          </p>
        </td>
      </tr>
    </table>

    <table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin: 0 auto 24px auto;">
      <tr>
        <td align="center" style="border-radius: 8px; background-color: #1a4f43; border: 1px solid #143a32;">
          <a href="${safeResumeUrl}" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; font-family: 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif;">Continue filling form</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0; color: #5b6672; font-size: 13px; line-height: 1.6;">
      Keep this email safe. You'll need the secure link to continue your response.
    </p>
  `;

  return {
    subject: `Your draft for: ${formTitle}`,
    html: baseTemplate({
      title: 'Form Draft Saved',
      preheader: `Use this secure link to continue filling out ${formTitle}.`,
      content,
      footerText: `You received this email because you requested a copy of your form draft.`,
    }),
  };
}

/**
 * Password Service
 *
 * Handles password reset, change, and validation logic.
 */

import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import { sendEmail, getAppBaseUrl } from '@/lib/email';
import { passwordResetEmail, passwordChangedEmail } from '@/lib/email-templates';
import crypto from 'crypto';
import {
  hashPassword,
  verifyPassword,
  hashSha256,
} from '@/lib/encryption';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_EXPIRY_HOURS,
  ENUMERATION_PROTECTION_DELAY,
} from '@/lib/constants/application';

const log = createLogger('password');

// ============================================================================
// Types
// ============================================================================

export interface RequestResetResult {
  success: boolean;
  message: string;
  // Only returned in development for testing
  resetToken?: string;
  resetUrl?: string;
}

export interface ResetPasswordResult {
  success: boolean;
  message: string;
}

export interface ChangePasswordResult {
  success: boolean;
  message: string;
}

// ============================================================================
// Password Validation
// ============================================================================

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Request Password Reset
// ============================================================================

export async function requestPasswordReset(email: string): Promise<RequestResetResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase(), deletedAt: null },
  });

  // Always return success to prevent email enumeration
  if (!user || !user.isActive) {
    // Add random delay to prevent timing-based email enumeration
    // This makes response time similar to successful requests
    const delayRange = ENUMERATION_PROTECTION_DELAY.max - ENUMERATION_PROTECTION_DELAY.min;
    const randomDelay = ENUMERATION_PROTECTION_DELAY.min + Math.random() * delayRange;
    await new Promise((resolve) => setTimeout(resolve, randomDelay));
    return {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    };
  }

  // Generate secure reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashSha256(resetToken);

  // Set expiry time
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);

  // Save token to database
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: hashedToken,
      passwordResetExpires: expiresAt,
    },
  });

  // Log the reset request
  const userName = `${user.firstName} ${user.lastName}`.trim() || user.email;
  await createAuditLog({
    tenantId: user.tenantId || undefined,
    userId: user.id,
    action: 'PASSWORD_RESET_REQUESTED',
    entityType: 'User',
    entityId: user.id,
    entityName: userName,
    summary: `Password reset requested for "${userName}"`,
    changeSource: 'MANUAL',
    metadata: { email: user.email },
  });

  const resetUrl = `${getAppBaseUrl()}/reset-password?token=${resetToken}`;

  // Send password reset email
  const emailTemplate = passwordResetEmail({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    resetUrl,
    expiryHours: PASSWORD_RESET_EXPIRY_HOURS,
  });

  const emailResult = await sendEmail({
    to: user.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });

  if (!emailResult.success && process.env.NODE_ENV !== 'development') {
    log.error('Failed to send password reset email:', emailResult.error);
    // Don't expose email sending errors to prevent enumeration
  }

  // Return token only in development for testing
  if (process.env.NODE_ENV === 'development') {
    return {
      success: true,
      message: 'Password reset link generated.',
      resetToken,
      resetUrl,
    };
  }

  return {
    success: true,
    message: 'If an account exists with this email, you will receive a password reset link.',
  };
}

// ============================================================================
// Reset Password with Token
// ============================================================================

export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  // Validate password
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return {
      success: false,
      message: validation.errors.join('. '),
    };
  }

  // Hash the provided token to compare with stored hash
  const hashedToken = hashSha256(token);

  // Find user with valid token
  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: hashedToken,
      passwordResetExpires: { gt: new Date() },
      deletedAt: null,
    },
  });

  if (!user) {
    return {
      success: false,
      message: 'Invalid or expired reset token. Please request a new password reset.',
    };
  }

  // Hash new password with Argon2id
  const passwordHash = hashPassword(newPassword);

  // Update user
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });

  // Log the password reset
  const resetUserName = `${user.firstName} ${user.lastName}`.trim() || user.email;
  await createAuditLog({
    tenantId: user.tenantId || undefined,
    userId: user.id,
    action: 'PASSWORD_RESET_COMPLETED',
    entityType: 'User',
    entityId: user.id,
    entityName: resetUserName,
    summary: `Password reset completed for "${resetUserName}"`,
    changeSource: 'MANUAL',
    metadata: { email: user.email },
  });

  // Send password changed confirmation email
  const emailTemplate = passwordChangedEmail({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    changedAt: new Date(),
  });

  await sendEmail({
    to: user.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });

  return {
    success: true,
    message: 'Password has been reset successfully. You can now log in with your new password.',
  };
}

// ============================================================================
// Change Password (for logged-in users)
// ============================================================================

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
  });

  if (!user) {
    return {
      success: false,
      message: 'User not found.',
    };
  }

  // Verify current password (supports both Argon2id and legacy bcrypt)
  const verification = await verifyPassword(currentPassword, user.passwordHash);
  if (!verification.isValid) {
    return {
      success: false,
      message: 'Current password is incorrect.',
    };
  }

  // Validate new password
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return {
      success: false,
      message: validation.errors.join('. '),
    };
  }

  // Ensure new password is different from current
  const sameCheck = await verifyPassword(newPassword, user.passwordHash);
  if (sameCheck.isValid) {
    return {
      success: false,
      message: 'New password must be different from current password.',
    };
  }

  // Hash new password with Argon2id
  const passwordHash = hashPassword(newPassword);

  // Update user
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });

  // Log the password change
  const changeUserName = `${user.firstName} ${user.lastName}`.trim() || user.email;
  await createAuditLog({
    tenantId: user.tenantId || undefined,
    userId: user.id,
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: user.id,
    entityName: changeUserName,
    summary: `User "${changeUserName}" changed password`,
    changeSource: 'MANUAL',
    metadata: { email: user.email },
  });

  // Send password changed confirmation email
  const emailTemplate = passwordChangedEmail({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    changedAt: new Date(),
  });

  await sendEmail({
    to: user.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });

  return {
    success: true,
    message: 'Password changed successfully.',
  };
}

// ============================================================================
// Force Password Change Check
// ============================================================================

export async function checkMustChangePassword(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { mustChangePassword: true },
  });

  return user?.mustChangePassword ?? false;
}

// ============================================================================
// Set Must Change Password Flag
// ============================================================================

export async function setMustChangePassword(
  userId: string,
  mustChange: boolean,
  updatedByUserId?: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
  });

  if (!user) {
    throw new Error('User not found');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { mustChangePassword: mustChange },
  });

  if (updatedByUserId) {
    const targetUserName = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const action = mustChange ? 'PASSWORD_CHANGE_REQUIRED' : 'PASSWORD_CHANGE_CLEARED';
    const summary = mustChange
      ? `Password change required for "${targetUserName}"`
      : `Password change requirement cleared for "${targetUserName}"`;
    await createAuditLog({
      tenantId: user.tenantId || undefined,
      userId: updatedByUserId,
      action,
      entityType: 'User',
      entityId: userId,
      entityName: targetUserName,
      summary,
      changeSource: 'MANUAL',
      metadata: { email: user.email, targetUserId: userId },
    });
  }
}

/** Helpers shared by the e-signing envelope modules. */

import type { Prisma } from '@/generated/prisma';
import { createLogger } from '@/lib/logger';
import { ConflictError } from '@/lib/errors';
import {
  createEsigningAccessLinkToken,
  buildEsigningSigningUrl,
  createEsigningAccessToken,
  hashEsigningAccessToken,
} from '@/lib/esigning-session';
import type { EsigningManualLinkDto } from '@/types/esigning';
import { sendEsigningReminderEmail, sendEsigningRequestEmail } from '@/services/esigning-notification.service';
import {
  recordEsigningEnvelopeEmailDeliveryResults,
  withEsigningDeliveryTarget,
  type RecordedEsigningEmailDeliveryResult,
} from '@/services/esigning-email-delivery.service';
import { formatUserName } from '@/services/esigning-envelope.lib';

export const log = createLogger('esigning-envelope');

export type NotificationRecipient = {
  id: string;
  name: string;
  email: string | null;
  accessMode: 'EMAIL_LINK' | 'EMAIL_WITH_CODE' | 'MANUAL_LINK';
};

export type PreparedRecipientNotification = {
  recipientId: string;
  recipientName: string;
  recipientEmail: string | null;
  accessMode: 'EMAIL_LINK' | 'EMAIL_WITH_CODE' | 'MANUAL_LINK';
  accessTokenHash: string | null;
  rawToken: string | null;
  signingUrl: string;
};

export function hasRecipientEmail<T extends { email: string | null }>(
  recipient: T
): recipient is T & { email: string } {
  return Boolean(recipient.email?.trim());
}

export function assertGeneratedDocumentCompanyMatchesEnvelope(
  envelopeCompanyId: string | null,
  generatedDocumentCompanyId: string | null,
): void {
  if (
    envelopeCompanyId &&
    generatedDocumentCompanyId &&
    envelopeCompanyId !== generatedDocumentCompanyId
  ) {
    throw new Error('All generated documents in an envelope must belong to the same company');
  }
}

export function buildConsentDisclosureSnapshot(): Prisma.InputJsonValue {
  return {
    title: 'Electronic Signature Disclosure',
    locale: 'en-SG',
    body: [
      'By signing electronically, you agree to use electronic records and signatures for this transaction.',
      'Oakcloud records your name, email address, IP address, browser information, and signing timestamps for audit and verification purposes.',
      'You may decline to sign before completion.',
    ],
    privacyNotice:
      'Your IP address, browser information, and signature image may appear on the completion certificate for verification purposes.',
  };
}

export function validateSigningOrderConfiguration(input: {
  envelopeSigningOrder: 'PARALLEL' | 'SEQUENTIAL' | 'MIXED';
  recipients: Array<{
    id: string;
    name: string;
    type: 'SIGNER' | 'CC';
    signingOrder: number | null;
  }>;
}): void {
  const signers = input.recipients.filter((recipient) => recipient.type === 'SIGNER');

  if (input.envelopeSigningOrder === 'PARALLEL') {
    return;
  }

  const signerOrders = signers.map((recipient) => recipient.signingOrder);
  if (signerOrders.some((order) => typeof order !== 'number')) {
    throw new Error('Every signer must have a signing order before sending');
  }

  if (input.envelopeSigningOrder === 'SEQUENTIAL') {
    const orders = [...new Set(signerOrders as number[])].sort((left, right) => left - right);

    if (orders.length !== signers.length) {
      throw new Error('Sequential signing requires a unique order for each signer');
    }

    orders.forEach((order, index) => {
      const expected = index + 1;
      if (order !== expected) {
        throw new Error(`Signing order has a gap: missing ${expected}`);
      }
    });
    return;
  }

  const orders = [...new Set(signerOrders as number[])].sort((left, right) => left - right);
  orders.forEach((order, index) => {
    const expected = index + 1;
    if (order !== expected) {
      throw new Error(`Signing order has a gap: missing ${expected}`);
    }
  });
}

export function prepareRecipientNotifications(recipients: NotificationRecipient[]): {
  updates: PreparedRecipientNotification[];
  manualLinks: EsigningManualLinkDto[];
} {
  const updates: PreparedRecipientNotification[] = [];
  const manualLinks: EsigningManualLinkDto[] = [];

  for (const recipient of recipients) {
    const rawToken = createEsigningAccessToken();
    const signingUrl = buildEsigningSigningUrl(rawToken);
    const prepared: PreparedRecipientNotification = {
      recipientId: recipient.id,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      accessMode: recipient.accessMode,
      accessTokenHash: hashEsigningAccessToken(rawToken),
      rawToken,
      signingUrl,
    };
    updates.push(prepared);

    if (recipient.accessMode === 'MANUAL_LINK') {
      manualLinks.push({
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        signingUrl,
      });
    }
  }

  return { updates, manualLinks };
}

export async function prepareReminderNotifications(
  envelopeId: string,
  recipients: Array<
    NotificationRecipient & {
      sessionVersion: number;
    }
  >
): Promise<PreparedRecipientNotification[]> {
  return Promise.all(
    recipients.map(async (recipient) => {
      const signingToken = await createEsigningAccessLinkToken({
        recipientId: recipient.id,
        envelopeId,
        sessionVersion: recipient.sessionVersion,
      });

      return {
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        accessMode: recipient.accessMode,
        accessTokenHash: null,
        rawToken: null,
        signingUrl: buildEsigningSigningUrl(signingToken),
      };
    })
  );
}

export async function deliverPreparedNotifications(input: {
  envelopeId: string;
  tenantId: string;
  senderName: string;
  envelopeTitle: string;
  emailSubject?: string | null;
  message?: string | null;
  expiresAt?: Date | null;
  notifications: PreparedRecipientNotification[];
  kind?: 'request' | 'reminder';
  reminderOccurrenceIso?: string;
}): Promise<void> {
  const deliveryResults: RecordedEsigningEmailDeliveryResult[] = [];
  for (const notification of input.notifications) {
    if (notification.accessMode === 'MANUAL_LINK' || !notification.recipientEmail) {
      continue;
    }

    const emailInput = {
      to: notification.recipientEmail,
      recipientName: notification.recipientName,
      senderName: input.senderName,
      envelopeTitle: input.envelopeTitle,
      emailSubject: input.emailSubject,
      message: input.message,
      signingUrl: notification.signingUrl,
      accessMode: notification.accessMode,
      expiresAt: input.expiresAt,
    } as const;

    if (input.kind === 'reminder') {
      const result = await sendEsigningReminderEmail(emailInput);
      deliveryResults.push(withEsigningDeliveryTarget(result, {
        tenantId: input.tenantId,
        targetKey:
          `recipient:${notification.recipientId}:reminder:${input.reminderOccurrenceIso ?? result.attemptedAt}`,
        audience: 'RECIPIENT',
        recipientId: notification.recipientId,
      }));
      continue;
    }

    const result = await sendEsigningRequestEmail(emailInput);
    deliveryResults.push(withEsigningDeliveryTarget(result, {
      tenantId: input.tenantId,
      targetKey: `recipient:${notification.recipientId}`,
      audience: 'RECIPIENT',
      recipientId: notification.recipientId,
    }));
  }

  await recordEsigningEnvelopeEmailDeliveryResults(input.envelopeId, deliveryResults);
}

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function diffInWholeDays(left: Date, right: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(left).getTime() - startOfDay(right).getTime()) / millisecondsPerDay);
}

export function getEnvelopeSenderName(input: {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  email: string;
}): string {
  return formatUserName(input.firstName, input.lastName, input.email);
}

export function getSentAtFromEvents(
  events: Array<{
    action: string;
    createdAt: Date;
  }>,
  fallback: Date
): Date {
  return events.find((event) => event.action === 'SENT')?.createdAt ?? fallback;
}

export function isExpiryWarningEvent(event: {
  action: string;
  metadata: Prisma.JsonValue | null;
}, thresholdDays: number): boolean {
  if (event.action !== 'REMINDER_SENT' || !event.metadata || Array.isArray(event.metadata)) {
    return false;
  }

  const metadata = event.metadata as Record<string, unknown>;
  return metadata.kind === 'expiry_warning' && metadata.thresholdDays === thresholdDays;
}

export function buildDuplicateEnvelopeTitle(title: string): string {
  const suffix = ' (Copy)';
  if (title.length + suffix.length <= 160) {
    return `${title}${suffix}`;
  }

  return `${title.slice(0, 160 - suffix.length).trimEnd()}${suffix}`;
}

/** A copy keeps the original's expiry only while it is still ahead; a past expiry would expire the copy as soon as it is sent. */
export function getDuplicateEnvelopeExpiry(expiresAt: Date | null, now = new Date()): Date | null {
  return expiresAt && expiresAt > now ? expiresAt : null;
}

export function buildEsigningListDateRange(
  from?: string,
  to?: string
): Prisma.DateTimeFilter | undefined {
  const range: Prisma.DateTimeFilter = {};

  if (from) {
    range.gte = new Date(`${from}T00:00:00.000Z`);
  }

  if (to) {
    const exclusiveEnd = new Date(`${to}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    range.lt = exclusiveEnd;
  }

  return Object.keys(range).length > 0 ? range : undefined;
}

/**
 * The PDF sent for signing must be the finalized revision that was checked.
 * OakDoc output names the revision it converted, so a mismatch is caught
 * before upload; the commit re-checks that the document was not unfinalized
 * or edited while the PDF was being produced.
 */
export function assertExportMatchesRevision(exported: { provenance?: { documentRevision: number } }, revision: number) {
  if (exported.provenance && exported.provenance.documentRevision !== revision) {
    throw new ConflictError('The document changed while its PDF was being prepared. Try again.');
  }
}

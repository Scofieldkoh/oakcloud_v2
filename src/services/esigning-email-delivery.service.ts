import type {
  EsigningEmailDeliveryAudience,
  EsigningEmailDeliveryKind as PrismaEsigningEmailDeliveryKind,
} from '@/generated/prisma';
import { prisma } from '@/lib/prisma';

const EMAIL_DELIVERY_FAILURE_LIMIT = 10;

export type EsigningEmailDeliveryKind =
  | 'request'
  | 'reminder'
  | 'completion'
  | 'declined'
  | 'pdf_failure'
  | 'expiry_warning'
  | 'expired'
  | 'voided';

export interface EsigningEmailDeliveryResult {
  ok: boolean;
  kind: EsigningEmailDeliveryKind;
  to: string;
  subject: string;
  attemptedAt: string;
  error?: string;
  providerMessageId?: string | null;
}

export interface RecordedEsigningEmailDeliveryResult extends EsigningEmailDeliveryResult {
  tenantId: string;
  targetKey: string;
  audience: EsigningEmailDeliveryAudience;
  recipientId?: string | null;
}

export interface EsigningEmailDeliveryFailure {
  kind: EsigningEmailDeliveryKind;
  targetKey: string;
  to: string;
  subject: string;
  error: string;
  attemptedAt: string;
}

export interface EsigningEmailDeliveryHealth {
  status: 'ok' | 'failed';
  lastFailureAt: string | null;
  failures: EsigningEmailDeliveryFailure[];
}

export interface EsigningLedgerDeliverySnapshot {
  kind: string;
  targetKey: string;
  toEmail: string;
  subject: string;
  status: string;
  lastError: string | null;
  lastAttemptedAt: Date | string | null;
}

export function withEsigningDeliveryTarget(
  result: EsigningEmailDeliveryResult,
  target: {
    tenantId: string;
    targetKey: string;
    audience: EsigningEmailDeliveryAudience;
    recipientId?: string | null;
  }
): RecordedEsigningEmailDeliveryResult {
  return {
    ...result,
    tenantId: target.tenantId,
    targetKey: target.targetKey,
    audience: target.audience,
    recipientId: target.recipientId ?? null,
  };
}

export function normalizeEsigningEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function toPrismaEsigningEmailDeliveryKind(
  kind: EsigningEmailDeliveryKind
): PrismaEsigningEmailDeliveryKind {
  switch (kind) {
    case 'request':
      return 'REQUEST';
    case 'reminder':
      return 'REMINDER';
    case 'completion':
      return 'COMPLETION';
    case 'declined':
      return 'DECLINED';
    case 'pdf_failure':
      return 'PDF_FAILURE';
    case 'expiry_warning':
      return 'EXPIRY_WARNING';
    case 'expired':
      return 'EXPIRED';
    case 'voided':
      return 'VOIDED';
  }
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function parseLegacyFailures(value: unknown): EsigningEmailDeliveryFailure[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.kind !== 'string' ||
      typeof record.to !== 'string' ||
      typeof record.subject !== 'string' ||
      typeof record.error !== 'string' ||
      typeof record.attemptedAt !== 'string'
    ) {
      return [];
    }

    const kind = record.kind as EsigningEmailDeliveryKind;
    return [{
      kind,
      targetKey:
        typeof record.targetKey === 'string'
          ? record.targetKey
          : `legacy:${kind}:${normalizeEsigningEmailAddress(record.to)}`,
      to: record.to,
      subject: record.subject,
      error: record.error,
      attemptedAt: record.attemptedAt,
    }];
  });
}

export function getLegacyEsigningEmailDeliveryHealth(
  metadata: unknown
): EsigningEmailDeliveryHealth {
  const emailDelivery = asRecord(asRecord(metadata).emailDelivery);
  const failures = parseLegacyFailures(emailDelivery.failures);

  if (emailDelivery.status === 'failed' && failures.length > 0) {
    return {
      status: 'failed',
      lastFailureAt:
        typeof emailDelivery.lastFailureAt === 'string'
          ? emailDelivery.lastFailureAt
          : failures[0]?.attemptedAt ?? null,
      failures,
    };
  }

  return {
    status: 'ok',
    lastFailureAt: null,
    failures: [],
  };
}

function deliveryIdentity(input: { kind: string; to: string }): string {
  return `${input.kind.toLowerCase()}:${normalizeEsigningEmailAddress(input.to)}`;
}

export function getEsigningEmailDeliveryHealth(
  deliveries: EsigningLedgerDeliverySnapshot[],
  legacyMetadata: unknown
): EsigningEmailDeliveryHealth {
  const ledgerRows = deliveries ?? [];
  const ledgerIdentities = new Set(
    ledgerRows.map((delivery) => deliveryIdentity({ kind: delivery.kind, to: delivery.toEmail }))
  );

  const ledgerFailures = ledgerRows.flatMap((delivery) => {
    if (delivery.status !== 'FAILED_RETRYABLE' && delivery.status !== 'FAILED_PERMANENT') {
      return [];
    }

    return [{
      kind: delivery.kind.toLowerCase() as EsigningEmailDeliveryKind,
      targetKey: delivery.targetKey,
      to: delivery.toEmail,
      subject: delivery.subject,
      error: delivery.lastError || 'Email provider did not accept the message',
      attemptedAt: toIsoString(delivery.lastAttemptedAt) ?? new Date(0).toISOString(),
    }];
  });

  const legacyFailures = getLegacyEsigningEmailDeliveryHealth(legacyMetadata).failures.filter(
    (failure) => !ledgerIdentities.has(deliveryIdentity({ kind: failure.kind, to: failure.to }))
  );

  const failures = [...ledgerFailures, ...legacyFailures]
    .sort(
      (left, right) =>
        new Date(right.attemptedAt).getTime() - new Date(left.attemptedAt).getTime()
    )
    .slice(0, EMAIL_DELIVERY_FAILURE_LIMIT);

  return {
    status: failures.length > 0 ? 'failed' : 'ok',
    lastFailureAt: failures[0]?.attemptedAt ?? null,
    failures,
  };
}

export async function recordEsigningEnvelopeEmailDeliveryResults(
  envelopeId: string,
  results: RecordedEsigningEmailDeliveryResult[]
): Promise<void> {
  if (results.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const result of results) {
      const kind = toPrismaEsigningEmailDeliveryKind(result.kind);
      const attemptedAt = new Date(result.attemptedAt);
      const failureError = result.error || 'Email provider did not accept the message';

      const delivery = await tx.esigningEmailDelivery.upsert({
        where: {
          envelopeId_kind_targetKey: {
            envelopeId,
            kind,
            targetKey: result.targetKey,
          },
        },
        create: {
          tenantId: result.tenantId,
          envelopeId,
          recipientId: result.recipientId ?? null,
          audience: result.audience,
          kind,
          targetKey: result.targetKey,
          toEmail: result.to,
          subject: result.subject,
          status: result.ok ? 'SUCCEEDED' : 'FAILED_RETRYABLE',
          attemptCount: 1,
          availableAt: attemptedAt,
          lastAttemptedAt: attemptedAt,
          sentAt: result.ok ? attemptedAt : null,
          lastError: result.ok ? null : failureError,
        },
        update: {
          toEmail: result.to,
          subject: result.subject,
          status: result.ok ? 'SUCCEEDED' : 'FAILED_RETRYABLE',
          attemptCount: { increment: 1 },
          availableAt: attemptedAt,
          lastAttemptedAt: attemptedAt,
          sentAt: result.ok ? attemptedAt : null,
          lastError: result.ok ? null : failureError,
        },
      });

      await tx.esigningEmailDeliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          toEmail: result.to,
          subject: result.subject,
          succeeded: result.ok,
          providerMessageId: result.providerMessageId ?? null,
          error: result.ok ? null : failureError,
          attemptedAt,
        },
      });
    }
  });
}

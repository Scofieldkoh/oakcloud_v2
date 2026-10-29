import { createHash } from 'node:crypto';
import { checkPublicHttpUrl, type RawUrlCheckResult } from '@/lib/public-url-checker';
import { prisma } from '@/lib/prisma';

const MAX_CHECKS_PER_RUN = 500;
const CHECK_CONCURRENCY = 5;

export type UrlHealthClassification = 'HEALTHY' | 'UNVERIFIABLE' | 'FAILED';

type ClassifiableResult = Pick<RawUrlCheckResult, 'status' | 'errorCode' | 'errorMessage'>;

type PreviousHealthState = {
  urlFingerprint: string;
  consecutiveFailures: number;
  warningActivatedAt: Date | null;
  lastSucceededAt: Date | null;
};

export function classifyUrlCheck(result: ClassifiableResult): UrlHealthClassification {
  if (result.status !== null) {
    if (result.status >= 200 && result.status < 400) return 'HEALTHY';
    if (result.status === 401 || result.status === 403 || result.status === 429) return 'UNVERIFIABLE';
  }
  return 'FAILED';
}

export function nextHealthState(
  previous: PreviousHealthState | null | undefined,
  result: RawUrlCheckResult,
  urlFingerprint: string,
  now: Date,
) {
  const classification = classifyUrlCheck(result);
  const sameUrl = previous?.urlFingerprint === urlFingerprint;
  const baselineFailures = sameUrl ? previous.consecutiveFailures : 0;
  const baselineWarning = sameUrl ? previous.warningActivatedAt : null;
  const baselineSuccess = sameUrl ? previous.lastSucceededAt : null;

  if (classification === 'HEALTHY') {
    return {
      classification,
      consecutiveFailures: 0,
      warningActivatedAt: null,
      lastSucceededAt: now,
    };
  }

  if (classification === 'UNVERIFIABLE') {
    return {
      classification,
      consecutiveFailures: baselineFailures,
      warningActivatedAt: baselineWarning,
      lastSucceededAt: baselineSuccess,
    };
  }

  const consecutiveFailures = baselineFailures + 1;
  return {
    classification,
    consecutiveFailures,
    warningActivatedAt: baselineWarning ?? (consecutiveFailures >= 2 ? now : null),
    lastSucceededAt: baselineSuccess,
  };
}

function normalizedUrl(input: string) {
  const trimmed = input.trim();
  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}

function fingerprintUrl(url: string) {
  return createHash('sha256').update(url).digest('hex');
}

function healthKey(tenantId: string, formId: string, fieldKey: string) {
  return `${tenantId}\u0000${formId}\u0000${fieldKey}`;
}

export async function reconcileFormUrlHealth(): Promise<{
  checked: number;
  healthy: number;
  unverifiable: number;
  failed: number;
  warnings: number;
}> {
  const [fields, existingRecords] = await Promise.all([
    prisma.formField.findMany({
      where: {
        type: 'PARAGRAPH',
        inputType: 'info_url',
        form: { status: { in: ['DRAFT', 'PUBLISHED'] }, deletedAt: null },
      },
      select: { tenantId: true, formId: true, key: true, placeholder: true },
      orderBy: [{ formId: 'asc' }, { position: 'asc' }],
    }),
    prisma.formUrlHealth.findMany(),
  ]);

  const activeFields = fields.filter((field) => Boolean(field.placeholder?.trim()));
  const activeKeys = new Set(activeFields.map((field) => healthKey(field.tenantId, field.formId, field.key)));
  const staleIds = existingRecords
    .filter((record) => !activeKeys.has(healthKey(record.tenantId, record.formId, record.fieldKey)))
    .map((record) => record.id);
  if (staleIds.length > 0) {
    await prisma.formUrlHealth.deleteMany({ where: { id: { in: staleIds } } });
  }

  const previousByKey = new Map(
    existingRecords.map((record) => [healthKey(record.tenantId, record.formId, record.fieldKey), record]),
  );
  const candidates = activeFields.slice(0, MAX_CHECKS_PER_RUN);
  const counts = { checked: candidates.length, healthy: 0, unverifiable: 0, failed: 0, warnings: 0 };
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < candidates.length) {
      const field = candidates[nextIndex];
      nextIndex += 1;
      const checkedUrl = normalizedUrl(field.placeholder!);
      const urlFingerprint = fingerprintUrl(checkedUrl);
      let result: RawUrlCheckResult;
      try {
        result = await checkPublicHttpUrl(checkedUrl);
      } catch (error) {
        result = {
          status: null,
          finalUrl: checkedUrl,
          errorCode: 'CHECK_ERROR',
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }

      const now = new Date();
      const key = healthKey(field.tenantId, field.formId, field.key);
      const next = nextHealthState(previousByKey.get(key), result, urlFingerprint, now);
      if (next.classification === 'HEALTHY') counts.healthy += 1;
      if (next.classification === 'UNVERIFIABLE') counts.unverifiable += 1;
      if (next.classification === 'FAILED') counts.failed += 1;
      if (next.warningActivatedAt) counts.warnings += 1;

      const state = {
        checkedUrl,
        urlFingerprint,
        classification: next.classification,
        lastHttpStatus: result.status,
        lastErrorCode: result.errorCode,
        lastErrorMessage: result.errorMessage?.slice(0, 500) ?? null,
        consecutiveFailures: next.consecutiveFailures,
        lastCheckedAt: now,
        lastSucceededAt: next.lastSucceededAt,
        warningActivatedAt: next.warningActivatedAt,
      };
      await prisma.formUrlHealth.upsert({
        where: {
          tenantId_formId_fieldKey: {
            tenantId: field.tenantId,
            formId: field.formId,
            fieldKey: field.key,
          },
        },
        create: {
          tenantId: field.tenantId,
          formId: field.formId,
          fieldKey: field.key,
          ...state,
        },
        update: state,
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, candidates.length) }, () => worker()));
  return counts;
}

export async function listFormUrlWarningSummaries(tenantId: string) {
  const summaries = await prisma.formUrlHealth.groupBy({
    by: ['formId'],
    where: { tenantId, warningActivatedAt: { not: null } },
    _count: { _all: true },
    _max: { lastCheckedAt: true },
    orderBy: { formId: 'asc' },
  });
  return summaries.map((summary) => ({
    formId: summary.formId,
    warningCount: summary._count._all,
    lastCheckedAt: summary._max.lastCheckedAt,
  }));
}

export async function getFormUrlHealthDetails(tenantId: string, formId: string) {
  return prisma.formUrlHealth.findMany({
    where: { tenantId, formId },
    orderBy: [{ warningActivatedAt: 'desc' }, { fieldKey: 'asc' }],
  });
}

import { randomUUID } from 'node:crypto';
import { createAuditLog } from '@/lib/audit';
import { metadataHasUnresolvedTemplateData } from '@/lib/document-finalization';
import { readGeneratedDocumentEngineState } from '@/lib/document-editor/document-engine';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import type { TenantAwareParams } from '@/lib/types';
import type { MarkServiceAgreementEffectiveInput } from '@/lib/validations/client-service';
import { Prisma } from '@/generated/prisma';
import type { ServiceAgreementActivationDto } from '@/services/client-service';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation';
import { createMonitoringForActivatedService } from '@/services/compliance-monitoring/coverage';
import { processScheduleReconciliationBatch } from '@/services/schedule-reconciliation/worker';
import { canonicalizeBillingSchedule, isMaterializableBillingSchedule } from '@/services/billing/schedule';
import { snapshotClientServiceFees } from '@/services/client-service/fee-summary';
import { isPostpaidTrigger, type PostpaidTrigger } from '@/services/billing/postpaid-triggers';
import { parseTieredPricing, type TieredPricing } from '@/services/billing/tiered-pricing';

const log = createLogger('service-agreement-activation');

function feeTemplateKey(description: string): string {
  return description.trim().toLowerCase();
}

type PostpaidFeeTemplate = { postpaidTrigger: PostpaidTrigger; tieredPricing: TieredPricing | null };

/** Postpaid triggers and quantity tiers of a variant's fee templates, keyed by description. */
async function postpaidFeeTemplatesFor(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceVariantId: string,
): Promise<Map<string, PostpaidFeeTemplate>> {
  const result = new Map<string, PostpaidFeeTemplate>();
  if (!tx.serviceVariantFeeTemplate?.findMany) return result;
  const templates = await tx.serviceVariantFeeTemplate.findMany({
    where: { tenantId, variantId: serviceVariantId, billingTiming: 'POSTPAID' },
    select: { description: true, postpaidTrigger: true, tieredPricing: true },
  });
  for (const template of templates ?? []) {
    if (!isPostpaidTrigger(template.postpaidTrigger)) continue;
    result.set(feeTemplateKey(template.description), {
      postpaidTrigger: template.postpaidTrigger,
      tieredPricing: parseTieredPricing(template.tieredPricing),
    });
  }
  return result;
}
const activationInclude = {
  generatedDocument: { select: { id: true, status: true, revision: true, metadata: true } },
  entities: { select: { id: true, companyId: true } },
  items: {
    include: {
      entityLinks: { include: { agreementEntity: { select: { companyId: true } } } },
      feeLines: true,
    },
    orderBy: { displayOrder: 'asc' as const },
  },
} satisfies Prisma.ServiceAgreementInclude;

type ActivationAgreement = Prisma.ServiceAgreementGetPayload<{ include: typeof activationInclude }>;
type ActivationClaim = { agreementId: string; tenantId: string; claimToken: string };
type ActivationResult =
  | { status: 'completed'; clientServiceCount: number }
  | { status: 'already-completed'; clientServiceCount: number }
  | { status: 'retryable-failure' | 'permanent-failure'; error: string }
  | { status: 'stale-worker' };

const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
const MAX_ATTEMPTS = 5;
const PUBLIC_TEMPORARY_ERROR = 'Service activation is temporarily unavailable. It will be retried automatically.';
const PUBLIC_INELIGIBLE_ERROR = 'This Service Agreement is no longer eligible for activation.';
const PUBLIC_DOCUMENT_ERROR = 'The Service Agreement document has unresolved generation issues and cannot be activated.';

class ActivationFailure extends Error {
  constructor(public readonly publicMessage: string, public readonly permanent: boolean) {
    super(publicMessage);
  }
}

class LostActivationClaimError extends Error {}

function toActivationDto(agreement: Pick<ActivationAgreement, 'id' | 'status' | 'activationStatus' | 'activationAttemptCount' | 'activationLastError'>): ServiceAgreementActivationDto {
  return { agreementId: agreement.id, status: agreement.status, activationStatus: agreement.activationStatus, activationAttemptCount: agreement.activationAttemptCount, activationLastError: agreement.activationLastError };
}

function singaporeDateOnly(value: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

export async function queueServiceAgreementActivationsForEnvelope(
  tx: Prisma.TransactionClient,
  envelopeId: string,
  completedAt: Date,
): Promise<number> {
  const documents = await tx.esigningEnvelopeDocument.findMany({ where: { envelopeId, generatedDocumentId: { not: null } }, select: { generatedDocumentId: true } });
  const generatedDocumentIds = documents.flatMap((document) => document.generatedDocumentId ? [document.generatedDocumentId] : []);
  if (generatedDocumentIds.length === 0) return 0;
  const agreements = await tx.serviceAgreement.findMany({
    where: { generatedDocumentId: { in: generatedDocumentIds }, status: 'DRAFT', activationStatus: 'NOT_READY' },
    select: { id: true, tenantId: true, effectiveDate: true },
  });
  let queued = 0;
  for (const agreement of agreements) {
    const result = await tx.serviceAgreement.updateMany({
      where: { id: agreement.id, tenantId: agreement.tenantId, status: 'DRAFT', activationStatus: 'NOT_READY' },
      data: {
        activationStatus: 'PENDING', activationSource: 'ESIGNING', signedAt: completedAt,
        effectiveDate: agreement.effectiveDate ?? singaporeDateOnly(completedAt), activationAvailableAt: new Date(),
        activationClaimedAt: null, activationLeaseExpiresAt: null, activationClaimToken: null,
        activationLastError: null, activationRequestedById: null, activationReason: null,
      },
    });
    queued += result.count;
  }
  return queued;
}

export async function requestManualServiceAgreementActivation(
  agreementId: string,
  input: MarkServiceAgreementEffectiveInput,
  params: TenantAwareParams,
): Promise<ServiceAgreementActivationDto> {
  return runSerializableTransaction(prisma, async (tx) => {
    const agreement = await tx.serviceAgreement.findFirst({ where: { id: agreementId, tenantId: params.tenantId }, include: activationInclude });
    if (!agreement) throw new NotFoundError('Service agreement not found');
    const queued = await tx.serviceAgreement.updateMany({
      where: { id: agreementId, tenantId: params.tenantId, status: 'DRAFT', activationStatus: 'NOT_READY' },
      data: {
        signedAt: new Date(input.signedAt), effectiveDate: new Date(`${input.effectiveDate}T00:00:00.000Z`),
        activationStatus: 'PENDING', activationSource: 'MANUAL', activationAvailableAt: new Date(),
        activationClaimedAt: null, activationLeaseExpiresAt: null, activationClaimToken: null,
        activationLastError: null, activationRequestedById: params.userId, activationReason: input.reason,
      },
    });
    if (queued.count !== 1) throw new ConflictError('Only a draft, not-yet-queued agreement can be marked effective');
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      companyId: agreement.primaryCompanyId,
      entityType: 'ServiceAgreement',
      entityId: agreementId,
      action: 'UPDATE',
      reason: input.reason,
      summary: 'Marked externally signed Service Agreement ready for activation',
      changes: {
        signedAt: { old: agreement.signedAt?.toISOString() ?? null, new: input.signedAt },
        effectiveDate: { old: agreement.effectiveDate?.toISOString().slice(0, 10) ?? null, new: input.effectiveDate },
        activationStatus: { old: agreement.activationStatus, new: 'PENDING' },
        activationSource: { old: agreement.activationSource, new: 'MANUAL' },
      },
    }, tx);
    return toActivationDto({ ...agreement, activationStatus: 'PENDING', activationLastError: null });
  });
}

export async function retryServiceAgreementActivation(agreementId: string, params: TenantAwareParams): Promise<ServiceAgreementActivationDto> {
  return runSerializableTransaction(prisma, async (tx) => {
    const agreement = await tx.serviceAgreement.findFirst({ where: { id: agreementId, tenantId: params.tenantId } });
    if (!agreement) throw new NotFoundError('Service agreement not found');
    if (agreement.status !== 'DRAFT' || !['FAILED_RETRYABLE', 'FAILED_PERMANENT'].includes(agreement.activationStatus)) throw new ConflictError('Agreement activation is not retryable');
    const retried = await tx.serviceAgreement.updateMany({
      where: { id: agreementId, tenantId: params.tenantId, status: 'DRAFT', activationStatus: agreement.activationStatus },
      data: { activationStatus: 'PENDING', activationAttemptCount: 0, activationAvailableAt: new Date(), activationClaimedAt: null, activationLeaseExpiresAt: null, activationClaimToken: null, activationLastError: null },
    });
    if (retried.count !== 1) throw new ConflictError('Agreement activation changed while retrying');
    await createAuditLog({ tenantId: params.tenantId, userId: params.userId, companyId: agreement.primaryCompanyId, entityType: 'ServiceAgreement', entityId: agreementId, action: 'UPDATE', summary: 'Retried Service Agreement activation' }, tx);
    return toActivationDto({ ...agreement, activationStatus: 'PENDING', activationAttemptCount: 0, activationLastError: null });
  });
}

export async function getServiceAgreementCompanyIds(agreementId: string, tenantId: string): Promise<string[]> {
  const agreement = await prisma.serviceAgreement.findFirst({ where: { id: agreementId, tenantId }, select: { entities: { select: { companyId: true } } } });
  if (!agreement) throw new NotFoundError('Service agreement not found');
  return [...new Set(agreement.entities.map((entity) => entity.companyId))];
}

async function persistActivationFailure(claim: ActivationClaim, failure: ActivationFailure): Promise<ActivationResult> {
  return runSerializableTransaction(prisma, async (tx) => {
    const current = await tx.serviceAgreement.findFirst({
      where: { id: claim.agreementId, tenantId: claim.tenantId, activationStatus: 'PROCESSING', activationClaimToken: claim.claimToken },
      select: { activationAttemptCount: true },
    });
    if (!current) return { status: 'stale-worker' as const };
    const attempt = current.activationAttemptCount + 1;
    const permanent = failure.permanent || attempt >= MAX_ATTEMPTS;
    const backoff = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
    const updated = await tx.serviceAgreement.updateMany({
      where: { id: claim.agreementId, tenantId: claim.tenantId, activationStatus: 'PROCESSING', activationClaimToken: claim.claimToken },
      data: {
        activationStatus: permanent ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE', activationAttemptCount: attempt,
        activationAvailableAt: permanent ? null : new Date(Date.now() + backoff * 60_000),
        activationClaimedAt: null, activationLeaseExpiresAt: null, activationClaimToken: null,
        activationLastError: failure.publicMessage,
      },
    });
    if (updated.count !== 1) return { status: 'stale-worker' as const };
    return { status: permanent ? 'permanent-failure' as const : 'retryable-failure' as const, error: failure.publicMessage };
  });
}

/**
 * Activation turns the agreement document into operational services, so its
 * generation evidence must be clean whether the document is still a draft or
 * already finalized. Metadata diagnostics are checked for every engine.
 */
function assertDocumentMetadataActivatable(metadata: unknown): void {
  if (
    metadataHasUnresolvedTemplateData(metadata)
    || readGeneratedDocumentEngineState(metadata) === 'INVALID'
  ) {
    throw new ActivationFailure(PUBLIC_DOCUMENT_ERROR, true);
  }
}

/**
 * OakDoc documents are also re-inspected from their stored DOCX, outside the
 * activation transaction because it reads object storage. Returns the
 * revision that was inspected so the transaction can confirm it is current.
 */
async function inspectOakDocAgreementDocument(claim: ActivationClaim): Promise<number | null> {
  const document = await prisma.generatedDocument.findFirst({
    where: { tenantId: claim.tenantId, serviceAgreement: { id: claim.agreementId } },
    select: { id: true, revision: true, metadata: true },
  });
  if (!document || readGeneratedDocumentEngineState(document.metadata) !== 'OAKDOC') return null;
  assertDocumentMetadataActivatable(document.metadata);
  const { checkGeneratedOakDocFinalization } = await import('@/services/oakdoc-generation.service');
  try {
    const check = await checkGeneratedOakDocFinalization(document.id, claim.tenantId);
    if (!check.ready) throw new ActivationFailure(PUBLIC_DOCUMENT_ERROR, true);
  } catch (error) {
    // Covers package-policy failures, which are validation errors too.
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw new ActivationFailure(PUBLIC_DOCUMENT_ERROR, true);
    }
    throw error;
  }
  return document.revision;
}

export async function processServiceAgreementActivation(claim: ActivationClaim): Promise<ActivationResult> {
  try {
    const inspectedOakDocRevision = await inspectOakDocAgreementDocument(claim);
    const activationResult = await runSerializableTransaction(prisma, async (tx) => {
      const agreement = await tx.serviceAgreement.findFirst({ where: { id: claim.agreementId, tenantId: claim.tenantId }, include: activationInclude });
      if (!agreement) throw new NotFoundError('Service agreement not found');
      if (agreement.activationStatus === 'COMPLETED') {
        const clientServiceCount = await tx.clientService.count({ where: { agreementId: claim.agreementId, tenantId: claim.tenantId, deletedAt: null } });
        return { status: 'already-completed' as const, clientServiceCount };
      }
      if (agreement.activationStatus !== 'PROCESSING' || agreement.activationClaimToken !== claim.claimToken) throw new LostActivationClaimError();
      if (agreement.status !== 'DRAFT') throw new ActivationFailure(PUBLIC_INELIGIBLE_ERROR, true);
      assertDocumentMetadataActivatable(agreement.generatedDocument.metadata);
      const isOakDoc = readGeneratedDocumentEngineState(agreement.generatedDocument.metadata) === 'OAKDOC';
      if (isOakDoc && agreement.generatedDocument.revision !== inspectedOakDocRevision) {
        // Edited after inspection (or turned into OakDoc): retry with fresh evidence.
        throw new Error('The agreement document changed during activation');
      }

      let clientServiceCount = 0;
      for (const item of agreement.items) {
        const seenCompanies = new Set<string>();
        for (const link of item.entityLinks) {
          const companyId = link.agreementEntity.companyId;
          if (seenCompanies.has(companyId)) continue;
          seenCompanies.add(companyId);
          let service = await tx.clientService.findUnique({ where: { agreementItemId_companyId: { agreementItemId: item.id, companyId } } });
          const created = !service;
          const fees = item.feeLines.filter((fee) => fee.agreementEntityId === link.agreementEntityId);
          const postpaidTemplates = await postpaidFeeTemplatesFor(tx, agreement.tenantId, item.serviceVariantId);
          const activationFees = fees.map((fee) => {
            const postpaid = postpaidTemplates.get(feeTemplateKey(fee.description));
            if (postpaid) {
              return { ...fee, billingStartDate: null, scheduleConfig: null, billingTiming: 'POSTPAID' as const, ...postpaid };
            }
            const billingStartDate = fee.billingStartDate ?? item.startDate;
            const scheduleConfig = canonicalizeBillingSchedule({
              billingFrequency: fee.billingFrequency,
              billingStartDate,
              customFrequencyLabel: fee.customFrequencyLabel,
            });
            return {
              ...fee,
              billingStartDate,
              scheduleConfig,
              billingTiming: 'PREPAID' as const,
              postpaidTrigger: null,
              tieredPricing: null,
            };
          });
          const activationBillingDisposition = fees.length > 0
            && activationFees.every((fee) => fee.billingTiming === 'POSTPAID' || isMaterializableBillingSchedule(fee))
            ? 'CONFIGURED'
            : 'UNREVIEWED';
          if (!service) {
            service = await tx.clientService.create({ data: { tenantId: agreement.tenantId, companyId, source: 'AGREEMENT', agreementId: agreement.id, agreementItemId: item.id, serviceVariantId: item.serviceVariantId, familyName: item.familyNameSnapshot, serviceName: item.variantNameSnapshot, serviceCadence: item.serviceCadence, customCadenceLabel: item.customCadenceLabel, startDate: item.startDate, endDate: item.endDate, fieldValues: item.fieldValues as Prisma.InputJsonValue, billingDisposition: activationBillingDisposition, billingNotRequiredReason: null } });
          }
          clientServiceCount += 1;
          if (created && fees.length > 0) {
            await tx.clientServiceFeeLine.createMany({ data: activationFees.map((fee) => ({ tenantId: agreement.tenantId, clientServiceId: service!.id, sourceAgreementFeeLineId: fee.id, description: fee.description, amount: fee.amount, currency: fee.currency, billingFrequency: fee.billingFrequency, customFrequencyLabel: fee.customFrequencyLabel, billingStartDate: fee.billingStartDate, scheduleConfig: fee.scheduleConfig ?? Prisma.JsonNull, billingTiming: fee.billingTiming, postpaidTrigger: fee.postpaidTrigger, tieredPricing: fee.tieredPricing ?? Prisma.JsonNull, isActive: true, displayOrder: fee.displayOrder })) });
          }
          if (created) {
            const variantRules = tx.serviceVariantDeadlineRule?.findMany
              ? await tx.serviceVariantDeadlineRule.findMany({
                  where: {
                    serviceVariantId: item.serviceVariantId,
                    tenantId: agreement.tenantId,
                    enabledByDefault: true,
                    archivedAt: null,
                    rule: {
                      tenantId: agreement.tenantId,
                      isActive: true,
                      archivedAt: null,
                      currentVersionId: { not: null },
                    },
                  },
                  select: { ruleId: true, enabledByDefault: true, parameterDefaults: true, scheduleDefaults: true },
                })
              : [];

            const enabledVariantRules = variantRules.filter((variantRule) => variantRule.enabledByDefault !== false);
            if (enabledVariantRules.length > 0 && tx.clientServiceDeadlineRule?.createMany) {
              await tx.clientServiceDeadlineRule.createMany({
                data: enabledVariantRules.map((vr) => {
                  const parameterValues = (vr.parameterDefaults && typeof vr.parameterDefaults === 'object' && !Array.isArray(vr.parameterDefaults))
                    ? vr.parameterDefaults as Record<string, unknown>
                    : {};
                  return {
                    tenantId: agreement.tenantId,
                    clientServiceId: service.id,
                    ruleId: vr.ruleId,
                    enabled: true,
                    parameterValues: parameterValues as Prisma.InputJsonValue,
                    parameterProvenance: Object.fromEntries(Object.keys(parameterValues).map((key) => [key, 'CATALOG_DEFAULT'])) as Prisma.InputJsonValue,
                    scheduleEntries: (Array.isArray(vr.scheduleDefaults) ? vr.scheduleDefaults : []) as Prisma.InputJsonValue,
                    applicabilityState: 'MISSING_INPUT',
                  };
                }),
              });
            }

            await createMonitoringForActivatedService(tx, {
              tenantId: agreement.tenantId,
              companyId,
              clientServiceId: service.id,
              serviceVariantId: item.serviceVariantId,
              agreementId: agreement.id,
              agreementDate: agreement.agreementDate ?? null,
              serviceStartDate: item.startDate ?? null,
              serviceEndDate: item.endDate ?? null,
              fieldValues: item.fieldValues,
              actorId: agreement.activationRequestedById ?? null,
            });

            await enqueueScheduleReconciliation(tx, {
              tenantId: agreement.tenantId,
              scopeType: 'CLIENT_SERVICE',
              scopeId: service.id,
              triggerType: 'SERVICE_AGREEMENT_ACTIVATED',
              correlationId: `agreement-activation-${agreement.id}-${service.id}`,
              requestedById: agreement.activationRequestedById ?? null,
            });

            await createAuditLog({ tenantId: agreement.tenantId, userId: agreement.activationRequestedById ?? undefined, companyId, entityType: 'ClientService', entityId: service.id, entityName: item.variantNameSnapshot, action: 'CREATE', changeSource: agreement.activationSource === 'MANUAL' ? 'MANUAL' : 'SYSTEM', changes: { billingDisposition: { old: null, new: activationBillingDisposition }, feeLines: { old: { count: 0, snapshot: snapshotClientServiceFees([]) }, new: { count: fees.length, snapshot: snapshotClientServiceFees(activationFees) } } }, summary: 'Created operational service from signed Service Agreement' }, tx);
          }
        }
      }

      if (agreement.generatedDocument.status === 'DRAFT') {
        const finalized = await tx.generatedDocument.updateMany({ where: { id: agreement.generatedDocumentId, tenantId: agreement.tenantId, status: 'DRAFT' }, data: { status: 'FINALIZED', finalizedAt: new Date() } });
        if (finalized.count !== 1) throw new LostActivationClaimError();
      }
      const completed = await tx.serviceAgreement.updateMany({
        where: { id: agreement.id, tenantId: agreement.tenantId, status: 'DRAFT', activationStatus: 'PROCESSING', activationClaimToken: claim.claimToken },
        data: { status: 'EFFECTIVE', activatedAt: new Date(), activationStatus: 'COMPLETED', activationAttemptCount: { increment: 1 }, activationClaimedAt: null, activationLeaseExpiresAt: null, activationClaimToken: null, activationLastError: null },
      });
      if (completed.count !== 1) throw new LostActivationClaimError();
      await createAuditLog({ tenantId: agreement.tenantId, userId: agreement.activationRequestedById ?? undefined, companyId: agreement.primaryCompanyId, entityType: 'ServiceAgreement', entityId: agreement.id, action: 'UPDATE', changeSource: agreement.activationSource === 'MANUAL' ? 'MANUAL' : 'SYSTEM', reason: agreement.activationReason ?? undefined, summary: `Activated ${clientServiceCount} operational service(s)` }, tx);
      return { status: 'completed' as const, clientServiceCount };
    });
    if (activationResult.status === 'completed') {
      processScheduleReconciliationBatch().catch((error) => {
        log.warn('Immediate Service Agreement schedule reconciliation failed; the scheduler will retry', {
          agreementId: claim.agreementId,
          tenantId: claim.tenantId,
          error,
        });
      });
    }
    return activationResult;
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof LostActivationClaimError) return { status: 'stale-worker' };
    if (error instanceof ActivationFailure) return persistActivationFailure(claim, error);
    const correlationId = randomUUID();
    log.error('Service Agreement activation failed', { correlationId, agreementId: claim.agreementId, tenantId: claim.tenantId, error });
    return persistActivationFailure(claim, new ActivationFailure(`${PUBLIC_TEMPORARY_ERROR} Reference: ${correlationId}`, false));
  }
}

export async function processQueuedServiceAgreementActivations(options: { limit?: number; concurrency?: number; leaseMs?: number } = {}): Promise<{ claimed: number; completed: number; failed: number }> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const concurrency = Math.min(Math.max(options.concurrency ?? 2, 1), 20);
  const leaseMs = options.leaseMs ?? 300_000;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const claims = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string }>>(Prisma.sql`
      SELECT "id", "tenant_id" AS "tenantId" FROM "service_agreements"
      WHERE "status" = 'DRAFT' AND ((("activation_status" IN ('PENDING', 'FAILED_RETRYABLE') AND ("activation_available_at" IS NULL OR "activation_available_at" <= ${now}))
        OR ("activation_status" = 'PROCESSING' AND "activation_lease_expires_at" <= ${now})))
      ORDER BY "activation_available_at" ASC NULLS FIRST
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    const claimed: ActivationClaim[] = [];
    for (const row of rows) {
      const claimToken = randomUUID();
      const result = await tx.serviceAgreement.updateMany({
        where: {
          id: row.id, tenantId: row.tenantId, status: 'DRAFT',
          OR: [
            { activationStatus: { in: ['PENDING', 'FAILED_RETRYABLE'] }, OR: [{ activationAvailableAt: null }, { activationAvailableAt: { lte: now } }] },
            { activationStatus: 'PROCESSING', activationLeaseExpiresAt: { lte: now } },
          ],
        },
        data: { activationStatus: 'PROCESSING', activationClaimedAt: now, activationLeaseExpiresAt: leaseExpiresAt, activationClaimToken: claimToken },
      });
      if (result.count === 1) claimed.push({ agreementId: row.id, tenantId: row.tenantId, claimToken });
    }
    return claimed;
  });
  let completed = 0;
  let failed = 0;
  for (let offset = 0; offset < claims.length; offset += concurrency) {
    const results = await Promise.all(claims.slice(offset, offset + concurrency).map(processServiceAgreementActivation));
    completed += results.filter((result) => result.status === 'completed' || result.status === 'already-completed').length;
    failed += results.filter((result) => result.status === 'retryable-failure' || result.status === 'permanent-failure').length;
  }
  return { claimed: claims.length, completed, failed };
}

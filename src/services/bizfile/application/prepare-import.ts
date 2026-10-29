import { prisma } from '@/lib/prisma';

import {
  buildBizFileChangePlan,
  computeBizFileAggregateRevision,
  type BizFileBaselineSnapshot,
  type BizFileChangePlan,
  type BizFileContactDecisionBinding,
} from '../change-plan';
import { normalizeExtractedData } from '../normalizer';
import type { ExtractedBizFileData, OfficerAction } from '../types';

export interface PrepareBizFileImportArgs {
  tenantId: string;
  documentId: string;
  reviewedData: ExtractedBizFileData;
  targetCompanyId?: string;
  sourceVersion?: number;
  sourceHash?: string;
  contactDecisions?: Record<string, BizFileContactDecisionBinding>;
  selectedChangeIds?: string[];
  officerActions?: OfficerAction[];
}

export interface BizFilePreparedSource {
  documentId: string;
  tenantId: string;
  version: number;
  /** Authoritative source revision used by the stale-preparation guard. */
  sourceRevision: number;
  storageKey: string;
  mimeType: string;
  originalFileName: string;
  /** A caller supplied content hash. Never infer this from a mutable path. */
  sourceHash?: string;
}

export interface BizFileContactCandidate {
  sourceRecordId: string;
  kind: 'officer' | 'shareholder';
  name: string;
  hasExplicitDecision: boolean;
  /** The row is new or has no bound contact and therefore needs a decision. */
  requiresDecision: boolean;
}

export interface PreparedBizFileImport {
  plan: BizFileChangePlan;
  source: BizFilePreparedSource;
  contactCandidates: BizFileContactCandidate[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function baselineFromCompany(company: Record<string, unknown>): BizFileBaselineSnapshot {
  const mapRows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
    ? value.map(asRecord)
    : [];
  const addresses = mapRows(company.addresses);
  const formerNames = mapRows(company.formerNames);
  const shareCapital = mapRows(company.shareCapital);
  const officers = mapRows(company.officers);
  const shareholders = mapRows(company.shareholders);
  const charges = mapRows(company.charges);
  const auditor = company.auditor ? asRecord(company.auditor) : null;
  const baseline: BizFileBaselineSnapshot = {
    company: Object.fromEntries(Object.entries(company).filter(([key]) => !['addresses', 'formerNames', 'shareCapital', 'officers', 'shareholders', 'charges', 'auditor'].includes(key))),
    addresses,
    formerNames,
    shareCapital,
    officers,
    shareholders,
    auditor,
    charges,
    updatedAt: company.updatedAt instanceof Date ? company.updatedAt.toISOString() : typeof company.updatedAt === 'string' ? company.updatedAt : undefined,
    expectedAggregateRevision: typeof company.aggregateRevision === 'number' && Number.isInteger(company.aggregateRevision)
      ? company.aggregateRevision
      : 0,
  };
  baseline.aggregateRevision = computeBizFileAggregateRevision(baseline);
  return baseline;
}

function contactCandidates(
  data: ExtractedBizFileData,
  plan: BizFileChangePlan,
): BizFileContactCandidate[] {
  const candidates: BizFileContactCandidate[] = [];
  for (const [index, officer] of (data.officers ?? []).entries()) {
    const sourceRecordId = `officers.${index}`;
    const change = plan.changes.find((candidate) => candidate.sourceRecordId === sourceRecordId);
    const before = asRecord(change?.before);
    candidates.push({
      sourceRecordId,
      kind: 'officer',
      name: officer.name,
      hasExplicitDecision: Boolean(officer.contactResolution || plan.contactDecisions[sourceRecordId]),
      requiresDecision: change?.operation === 'ADD' || !before.contactId,
    });
  }
  for (const [index, shareholder] of (data.shareholders ?? []).entries()) {
    const sourceRecordId = `shareholders.${index}`;
    const change = plan.changes.find((candidate) => candidate.sourceRecordId === sourceRecordId);
    const before = asRecord(change?.before);
    candidates.push({
      sourceRecordId,
      kind: 'shareholder',
      name: shareholder.name,
      hasExplicitDecision: Boolean(shareholder.contactResolution || plan.contactDecisions[sourceRecordId]),
      requiresDecision: change?.operation === 'ADD' || !before.contactId,
    });
  }
  return candidates;
}

/**
 * Read the source and target once, then build the immutable proposal used by
 * both the document UI and the Business Assistant adapter. No company writes
 * or provider calls occur here.
 */
export async function prepareBizFileImportCommand(
  args: PrepareBizFileImportArgs,
): Promise<PreparedBizFileImport> {
  const document = await prisma.document.findFirst({
    where: { id: args.documentId, tenantId: args.tenantId, deletedAt: null },
    select: { id: true, tenantId: true, version: true, sourceRevision: true, storageKey: true, mimeType: true, originalFileName: true },
  });
  if (!document) throw new Error('BizFile source document not found');
  const authoritativeSourceRevision = typeof document.sourceRevision === 'number'
    && Number.isSafeInteger(document.sourceRevision)
    && document.sourceRevision >= 0
    ? document.sourceRevision
    : 0;
  if (args.sourceVersion !== undefined && args.sourceVersion !== authoritativeSourceRevision) {
    throw new Error(`STALE_BIZFILE_SOURCE: expected source revision ${args.sourceVersion}, found ${authoritativeSourceRevision}`);
  }

  let baseline: BizFileBaselineSnapshot | undefined;
  if (args.targetCompanyId) {
    const company = await prisma.company.findFirst({
      where: { id: args.targetCompanyId, tenantId: args.tenantId, deletedAt: null },
      include: {
        addresses: { where: { isCurrent: true } },
        formerNames: true,
        shareCapital: true,
        officers: { where: { isCurrent: true } },
        shareholders: { where: { isCurrent: true } },
        auditor: true,
        charges: true,
      },
    });
    if (!company) throw new Error('BizFile target company not found');
    baseline = baselineFromCompany(company as unknown as Record<string, unknown>);
  }

  const reviewedData = normalizeExtractedData(args.reviewedData);
  const mode = args.targetCompanyId ? 'UPDATE' : 'CREATE';
  const plan = buildBizFileChangePlan({
    mode,
    tenantId: args.tenantId,
    documentId: args.documentId,
    reviewedData,
    baseline,
    targetCompanyId: args.targetCompanyId,
    // The database source revision is the only value allowed to bind a
    // prepared proposal. `args.sourceVersion` is retained for compatibility
    // with older callers but cannot override the authoritative row value.
    sourceVersion: authoritativeSourceRevision,
    sourceHash: args.sourceHash,
    aggregateRevision: baseline?.aggregateRevision,
    expectedAggregateRevision: baseline?.expectedAggregateRevision,
    expectedUpdatedAt: baseline?.updatedAt,
    contactDecisions: args.contactDecisions,
    selectedChangeIds: args.selectedChangeIds,
    officerActions: args.officerActions,
  });
  return {
    plan,
    source: {
      documentId: document.id,
      tenantId: document.tenantId,
      version: document.version,
      sourceRevision: authoritativeSourceRevision,
      storageKey: document.storageKey,
      mimeType: document.mimeType,
      originalFileName: document.originalFileName,
      ...(args.sourceHash ? { sourceHash: args.sourceHash } : {}),
    },
    contactCandidates: contactCandidates(reviewedData, plan),
  };
}

export { baselineFromCompany };

/**
 * Authenticated staff review for Singapore Company Incorporation responses:
 * KYC source links per person, staff-only review subjects, checklist decisions and
 * filing-preparation readiness. Nothing here files with ACRA or contacts anyone.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  INCORPORATION_CHECKLIST_AREAS,
  INCORPORATION_REVIEW_METADATA_KEY,
  KYC_COVERAGE_ITEMS,
  STAFF_SUBJECT_ROLES,
  evaluateIncorporationReadiness,
  parseIncorporationReview,
  type IncorporationReadiness,
  type IncorporationReviewState,
  type KycLink,
  type KycLinkStatus,
  type ReviewSubject,
} from '@/lib/forms/company-incorporation-review';
import { parseObject } from '@/lib/form-utils';
import { prisma } from '@/lib/prisma';
import type { TenantAwareParams } from '@/lib/types';
import {
  parseCompanyIncorporationSubmissionRecord,
  type CompanyIncorporationSubmissionRecord,
} from './company-incorporation-intake.service';

export interface KycSourceCandidate {
  submissionId: string;
  formId: string;
  formTitle: string;
  respondentName: string | null;
  respondentEmail: string | null;
  submittedAt: string;
}

export interface CompanyIncorporationReviewView {
  reference: string;
  intake: CompanyIncorporationSubmissionRecord;
  subjects: ReviewSubject[];
  review: IncorporationReviewState;
  linkStatus: Record<string, KycLinkStatus>;
  readiness: IncorporationReadiness;
  sourceCandidates: KycSourceCandidate[];
}

const decisionSchema = z.object({
  action: z.literal('set_decision'),
  areaKey: z.string().refine((key) => INCORPORATION_CHECKLIST_AREAS.some((area) => area.key === key), 'Unknown checklist area'),
  state: z.enum(['pending', 'satisfied', 'not_applicable']),
  note: z.string().trim().max(2000).optional().nullable(),
});

const linkSchema = z.object({
  action: z.literal('link_kyc'),
  subjectId: z.string().min(1).max(80),
  sourceKind: z.enum(['form_submission', 'manual']),
  sourceId: z.string().uuid().optional().nullable(),
  manualLocation: z.string().trim().max(500).optional().nullable(),
  coverage: z.record(z.string(), z.boolean()).default({}),
  reviewState: z.enum(['received', 'verified', 'needs_follow_up']),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const unlinkSchema = z.object({
  action: z.literal('unlink_kyc'),
  subjectId: z.string().min(1).max(80),
});

const addSubjectSchema = z.object({
  action: z.literal('add_subject'),
  name: z.string().trim().min(1).max(300),
  kind: z.enum(['individual', 'organisation']),
  roles: z.array(z.enum(STAFF_SUBJECT_ROLES.map((role) => role.value) as [string, ...string[]])).min(1).max(6),
});

const removeSubjectSchema = z.object({
  action: z.literal('remove_subject'),
  subjectId: z.string().min(1).max(80),
});

export const companyIncorporationReviewUpdateSchema = z.intersection(
  z.object({ expectedRevision: z.number().int().min(0) }),
  z.discriminatedUnion('action', [decisionSchema, linkSchema, unlinkSchema, addSubjectSchema, removeSubjectSchema])
);

export type CompanyIncorporationReviewUpdate = z.infer<typeof companyIncorporationReviewUpdateSchema>;

function submissionReference(submissionId: string): string {
  return submissionId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** Roster rows become review subjects keyed by their immutable party row id. */
function buildSubjects(intake: CompanyIncorporationSubmissionRecord, review: IncorporationReviewState): ReviewSubject[] {
  const partySubjects: ReviewSubject[] = intake.partyRows.map((row) => ({
    subjectId: row.partyRowId,
    origin: 'party',
    partyRowId: row.partyRowId,
    kind: row.kind === 'organisation' ? 'organisation' : 'individual',
    name: row.name || `Party ${row.rowIndex + 1}`,
    roles: row.roles,
    createdAt: intake.evaluatedAt,
    createdBy: null,
  }));
  const staffSubjects = review.subjects.filter((subject) => subject.origin === 'staff');
  return [...partySubjects, ...staffSubjects];
}

async function loadSubmission(formId: string, submissionId: string, tenantId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const submission = await client.formSubmission.findFirst({
    where: { id: submissionId, formId, tenantId, deletedAt: null },
    include: { form: { select: { title: true } } },
  });
  if (!submission) throw new NotFoundError('Submission not found');
  const intake = parseCompanyIncorporationSubmissionRecord(submission.metadata);
  if (!intake) throw new ValidationError('This response is not a company incorporation submission');
  return { submission, intake };
}

async function resolveLinkStatus(
  tenantId: string,
  kycLinks: Record<string, KycLink>
): Promise<Record<string, KycLinkStatus>> {
  const sourceIds = [...new Set(Object.values(kycLinks)
    .filter((link) => link.sourceKind === 'form_submission' && link.sourceId)
    .map((link) => link.sourceId as string))];
  const sources = sourceIds.length > 0
    ? await prisma.formSubmission.findMany({
      where: { id: { in: sourceIds }, tenantId, deletedAt: null },
      select: { id: true, updatedAt: true },
    })
    : [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  const status: Record<string, KycLinkStatus> = {};
  for (const [subjectId, link] of Object.entries(kycLinks)) {
    if (link.sourceKind !== 'form_submission') {
      status[subjectId] = { stale: false, staleReason: null };
      continue;
    }
    const source = link.sourceId ? sourceById.get(link.sourceId) : undefined;
    if (!source) {
      status[subjectId] = { stale: true, staleReason: 'is no longer available' };
    } else if (link.sourceVersion && source.updatedAt.toISOString() !== link.sourceVersion) {
      status[subjectId] = { stale: true, staleReason: 'changed since it was reviewed' };
    } else {
      status[subjectId] = { stale: false, staleReason: null };
    }
  }
  return status;
}

async function findSourceCandidates(tenantId: string, excludeSubmissionId: string, query: string): Promise<KycSourceCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const rows = await prisma.formSubmission.findMany({
    where: {
      tenantId,
      deletedAt: null,
      id: { not: excludeSubmissionId },
      form: { deletedAt: null },
      OR: [
        { respondentName: { contains: trimmed, mode: 'insensitive' } },
        { respondentEmail: { contains: trimmed, mode: 'insensitive' } },
        { form: { title: { contains: trimmed, mode: 'insensitive' } } },
      ],
    },
    orderBy: { submittedAt: 'desc' },
    take: 15,
    select: {
      id: true,
      formId: true,
      respondentName: true,
      respondentEmail: true,
      submittedAt: true,
      form: { select: { title: true } },
    },
  });

  return rows.map((row) => ({
    submissionId: row.id,
    formId: row.formId,
    formTitle: row.form.title,
    respondentName: row.respondentName,
    respondentEmail: row.respondentEmail,
    submittedAt: row.submittedAt.toISOString(),
  }));
}

export async function getCompanyIncorporationReview(
  formId: string,
  submissionId: string,
  params: TenantAwareParams,
  options: { sourceQuery?: string | null } = {}
): Promise<CompanyIncorporationReviewView> {
  const { submission, intake } = await loadSubmission(formId, submissionId, params.tenantId);
  const review = parseIncorporationReview(submission.metadata);
  const subjects = buildSubjects(intake, review);
  const linkStatus = await resolveLinkStatus(params.tenantId, review.kycLinks);

  return {
    reference: submissionReference(submission.id),
    intake,
    subjects,
    review,
    linkStatus,
    readiness: evaluateIncorporationReadiness({ review: { ...review, subjects }, linkStatus }),
    sourceCandidates: options.sourceQuery
      ? await findSourceCandidates(params.tenantId, submission.id, options.sourceQuery)
      : [],
  };
}

function describeUpdate(update: CompanyIncorporationReviewUpdate, subjects: ReviewSubject[]): string {
  const subjectName = 'subjectId' in update
    ? subjects.find((subject) => subject.subjectId === update.subjectId)?.name ?? 'a person'
    : '';
  switch (update.action) {
    case 'set_decision':
      return `Set "${INCORPORATION_CHECKLIST_AREAS.find((area) => area.key === update.areaKey)?.title}" to ${update.state.replace('_', ' ')}`;
    case 'link_kyc':
      return `Linked KYC for ${subjectName} (${update.reviewState.replace('_', ' ')})`;
    case 'unlink_kyc':
      return `Removed KYC link for ${subjectName}`;
    case 'add_subject':
      return `Added ${update.name} to the incorporation checklist`;
    case 'remove_subject':
      return `Removed ${subjectName} from the incorporation checklist`;
  }
}

export async function updateCompanyIncorporationReview(
  formId: string,
  submissionId: string,
  update: CompanyIncorporationReviewUpdate,
  params: TenantAwareParams
): Promise<CompanyIncorporationReviewView> {
  let auditSummary = '';
  let auditEntityName = '';

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM form_submissions WHERE id = ${submissionId} FOR UPDATE`;
    const { submission, intake } = await loadSubmission(formId, submissionId, params.tenantId, tx);
    const review = parseIncorporationReview(submission.metadata);

    if (review.revision !== update.expectedRevision) {
      throw new ConflictError('This checklist was changed by someone else. Reload it and try again.');
    }

    const subjects = buildSubjects(intake, review);
    const now = new Date().toISOString();
    const next: IncorporationReviewState = {
      ...review,
      subjects: review.subjects.filter((subject) => subject.origin === 'staff'),
      kycLinks: { ...review.kycLinks },
      decisions: { ...review.decisions },
      revision: review.revision + 1,
      updatedAt: now,
      updatedBy: params.userId ?? null,
    };

    switch (update.action) {
      case 'set_decision':
        next.decisions[update.areaKey] = {
          state: update.state,
          note: update.note?.trim() || null,
          decidedBy: params.userId ?? null,
          decidedAt: now,
        };
        break;
      case 'link_kyc': {
        const subject = subjects.find((entry) => entry.subjectId === update.subjectId);
        if (!subject) throw new ValidationError('Unknown person on the checklist');

        const coverageKeys = new Set(KYC_COVERAGE_ITEMS[subject.kind].map((item) => item.key));
        const coverage = Object.fromEntries(
          Object.entries(update.coverage).filter(([key]) => coverageKeys.has(key))
        );

        if (update.sourceKind === 'form_submission') {
          if (!update.sourceId || update.sourceId === submission.id) {
            throw new ValidationError('Select a KYC response to link');
          }
          const source = await tx.formSubmission.findFirst({
            where: { id: update.sourceId, tenantId: params.tenantId, deletedAt: null },
            select: {
              id: true,
              formId: true,
              updatedAt: true,
              submittedAt: true,
              respondentName: true,
              respondentEmail: true,
              form: { select: { title: true, deletedAt: true } },
            },
          });
          if (!source || source.form.deletedAt) {
            throw new ValidationError('That KYC response is not available in this workspace');
          }
          next.kycLinks[subject.subjectId] = {
            sourceKind: 'form_submission',
            sourceId: source.id,
            sourceFormId: source.formId,
            sourceLabel: `${source.form.title}: ${source.respondentName || source.respondentEmail || submissionReference(source.id)}`,
            sourceVersion: source.updatedAt.toISOString(),
            manualLocation: null,
            coverage,
            reviewState: update.reviewState,
            notes: update.notes?.trim() || null,
            reviewedBy: params.userId ?? null,
            reviewedAt: now,
          };
        } else {
          const location = update.manualLocation?.trim() || '';
          if (!location) throw new ValidationError('Describe where the KYC evidence is kept');
          next.kycLinks[subject.subjectId] = {
            sourceKind: 'manual',
            sourceId: null,
            sourceFormId: null,
            sourceLabel: location,
            sourceVersion: null,
            manualLocation: location,
            coverage,
            reviewState: update.reviewState,
            notes: update.notes?.trim() || null,
            reviewedBy: params.userId ?? null,
            reviewedAt: now,
          };
        }
        break;
      }
      case 'unlink_kyc':
        delete next.kycLinks[update.subjectId];
        break;
      case 'add_subject':
        next.subjects.push({
          subjectId: `staff_${randomUUID()}`,
          origin: 'staff',
          partyRowId: null,
          kind: update.kind,
          name: update.name.trim(),
          roles: [...new Set(update.roles)],
          createdAt: now,
          createdBy: params.userId ?? null,
        });
        break;
      case 'remove_subject': {
        const subject = next.subjects.find((entry) => entry.subjectId === update.subjectId);
        if (!subject) throw new ValidationError('Only people added by staff can be removed');
        next.subjects = next.subjects.filter((entry) => entry.subjectId !== update.subjectId);
        delete next.kycLinks[update.subjectId];
        break;
      }
    }

    const metadata = parseObject(submission.metadata) ? { ...(submission.metadata as Record<string, unknown>) } : {};
    metadata[INCORPORATION_REVIEW_METADATA_KEY] = next;
    await tx.formSubmission.update({
      where: { id: submission.id },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });

    auditSummary = describeUpdate(update, subjects);
    auditEntityName = submission.respondentName || submission.respondentEmail || submission.id;
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'FormSubmission',
    entityId: submissionId,
    entityName: auditEntityName,
    summary: auditSummary,
    changeSource: 'MANUAL',
    metadata: { event: 'company_incorporation_review_updated', formId, action: update.action },
  }).catch(() => undefined);

  return getCompanyIncorporationReview(formId, submissionId, params);
}

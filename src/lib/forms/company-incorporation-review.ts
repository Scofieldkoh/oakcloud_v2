/**
 * Staff-only preparation checklist for a Singapore Company Incorporation response.
 *
 * Stored in `FormSubmission.metadata.companyIncorporationReview`, written only through
 * the authenticated review service, and never included in public output.
 */

export const INCORPORATION_REVIEW_METADATA_KEY = 'companyIncorporationReview';

export type ChecklistDecisionState = 'pending' | 'satisfied' | 'not_applicable';
export type KycReviewState = 'received' | 'verified' | 'needs_follow_up';
export type ReviewSubjectKind = 'individual' | 'organisation';
export type KycSourceKind = 'form_submission' | 'manual';

export interface ChecklistArea {
  key: string;
  title: string;
  detail: string;
  /** Staff may mark this area not applicable. */
  allowNotApplicable: boolean;
}

/** Areas from the handover plan's internal ACRA preparation checklist (section 5). */
export const INCORPORATION_CHECKLIST_AREAS: ChecklistArea[] = [
  { key: 'name_type', title: 'Name and company type', detail: 'Name reserved from the proposed or alternative names (application reference and expiry); company type matches the name ending; exempt private company classification and shareholder count.', allowNotApplicable: false },
  { key: 'activities_contact', title: 'Activities and company email', detail: 'Primary and any secondary SSIC code checked against the business description; final company email.', allowNotApplicable: false },
  { key: 'registered_office', title: 'Registered office', detail: 'Singapore address and the accepted office arrangement (own address or our registered office service).', allowNotApplicable: false },
  { key: 'financial_year', title: 'Financial year', detail: 'First FYE checked against the actual incorporation date (12-month periods assumed); Registrar approval if the first period is over 18 months.', allowNotApplicable: false },
  { key: 'capital_schedule', title: 'Share capital schedule', detail: 'Currency, number of ordinary shares, issued and paid-up amounts; paid in cash unless agreed otherwise.', allowNotApplicable: false },
  { key: 'allotments', title: 'Allotments', detail: 'Each shareholder’s number of shares (from their percentage), issued and paid amounts, reconciled to the totals; trust or joint holdings if any.', allowNotApplicable: false },
  { key: 'controllers', title: 'Registrable controllers', detail: 'Exemption decision and basis, or identified controllers with control basis (more than 25%, other control) and effective dates. Ownership percentages alone do not decide this.', allowNotApplicable: false },
  { key: 'nominees', title: 'Nominee directors and shareholders', detail: 'People ticked as nominee shareholder or director and who they act for; our nominee director service if requested; effective dates.', allowNotApplicable: false },
  { key: 'constitution', title: 'Constitution', detail: 'Model constitution adopted as-is, or the custom constitution received; subscribers and execution through the document workflow.', allowNotApplicable: false },
  { key: 'consents', title: 'Consents and appointments', detail: 'Director consent and non-disqualification, a Singapore-resident director, secretary appointed (ours or the client’s), managing director or CEO particulars if appointed, auditor timing.', allowNotApplicable: false },
  { key: 'professional_readiness', title: 'Professional readiness', detail: 'KYC/CDD completed and reviewed, representative and filing authority verified, exceptions resolved.', allowNotApplicable: false },
  { key: 'intake_items', title: 'Intake items resolved', detail: 'Every item the intake flagged (below) has been followed up and recorded.', allowNotApplicable: true },
];

export interface CoverageItem {
  key: string;
  label: string;
}

/** ACRA particulars staff confirm are present in the linked KYC source for each subject. */
export const KYC_COVERAGE_ITEMS: Record<ReviewSubjectKind, CoverageItem[]> = {
  individual: [
    { key: 'identity', label: 'Legal name, aliases, ID type and number, date of birth, nationality' },
    { key: 'residential_address', label: 'Residential address' },
    { key: 'contact_address', label: 'Public contact address (or residential address used)' },
    { key: 'email_phone', label: 'Email and phone' },
    { key: 'role_eligibility', label: 'Role eligibility (age, residency or pass, disqualification)' },
    { key: 'controller_facts', label: 'Controller or nominator facts, if applicable' },
  ],
  organisation: [
    { key: 'registration', label: 'Name, UEN or foreign registration number, legal form, jurisdiction and registrar' },
    { key: 'registered_address', label: 'Registered office address and contact' },
    { key: 'authority', label: 'Authorised representative and authority evidence' },
    { key: 'ownership_chain', label: 'Ownership chain and controller facts' },
  ],
};

export const STAFF_SUBJECT_ROLES = [
  { value: 'secretary', label: 'Company secretary' },
  { value: 'ceo', label: 'CEO' },
  { value: 'controller', label: 'Registrable controller' },
  { value: 'nominator', label: 'Nominator' },
  { value: 'authorised_representative', label: 'Authorised representative' },
  { value: 'other', label: 'Other' },
] as const;

export interface ReviewSubject {
  subjectId: string;
  /** 'party' subjects mirror a roster row; 'staff' subjects are added by staff only. */
  origin: 'party' | 'staff';
  partyRowId: string | null;
  kind: ReviewSubjectKind;
  name: string;
  roles: string[];
  createdAt: string;
  createdBy: string | null;
}

export interface KycLink {
  sourceKind: KycSourceKind;
  /** FormSubmission id for 'form_submission'. */
  sourceId: string | null;
  sourceFormId: string | null;
  sourceLabel: string;
  /** updatedAt of the linked submission when it was reviewed; a change makes the link stale. */
  sourceVersion: string | null;
  /** Where staff can find evidence held outside Oakcloud. */
  manualLocation: string | null;
  coverage: Record<string, boolean>;
  reviewState: KycReviewState;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: string;
}

export interface ChecklistDecision {
  state: ChecklistDecisionState;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

export interface IncorporationReviewState {
  revision: number;
  subjects: ReviewSubject[];
  kycLinks: Record<string, KycLink>;
  decisions: Record<string, ChecklistDecision>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface KycLinkStatus {
  /** Linked source was deleted, moved to another tenant or changed since review. */
  stale: boolean;
  staleReason: string | null;
}

export interface IncorporationReadiness {
  ready: boolean;
  blockers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function emptyIncorporationReview(): IncorporationReviewState {
  return { revision: 0, subjects: [], kycLinks: {}, decisions: {}, updatedAt: null, updatedBy: null };
}

export function parseIncorporationReview(metadata: unknown): IncorporationReviewState {
  const root = isRecord(metadata) ? metadata : null;
  const raw = root && isRecord(root[INCORPORATION_REVIEW_METADATA_KEY]) ? root[INCORPORATION_REVIEW_METADATA_KEY] as Record<string, unknown> : null;
  if (!raw) return emptyIncorporationReview();

  return {
    revision: typeof raw.revision === 'number' && Number.isInteger(raw.revision) ? raw.revision : 0,
    subjects: Array.isArray(raw.subjects) ? raw.subjects.filter(isRecord) as unknown as ReviewSubject[] : [],
    kycLinks: isRecord(raw.kycLinks) ? raw.kycLinks as unknown as Record<string, KycLink> : {},
    decisions: isRecord(raw.decisions) ? raw.decisions as unknown as Record<string, ChecklistDecision> : {},
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
  };
}

/**
 * Filing preparation is ready only when every checklist area is satisfied or not
 * applicable, and every subject has a current, verified KYC source covering each
 * particular. Intake answers alone never make a case ready.
 */
export function evaluateIncorporationReadiness(input: {
  review: IncorporationReviewState;
  linkStatus: Record<string, KycLinkStatus>;
}): IncorporationReadiness {
  const { review } = input;
  const blockers: string[] = [];

  for (const area of INCORPORATION_CHECKLIST_AREAS) {
    const decision = review.decisions[area.key];
    if (!decision || decision.state === 'pending') {
      blockers.push(`${area.title}: not yet confirmed`);
    } else if (decision.state === 'not_applicable' && !area.allowNotApplicable) {
      blockers.push(`${area.title}: cannot be marked not applicable`);
    }
  }

  if (review.subjects.length === 0) {
    blockers.push('No shareholders, directors or other people are on the checklist');
  }

  for (const subject of review.subjects) {
    const link = review.kycLinks[subject.subjectId];
    if (!link) {
      blockers.push(`${subject.name}: KYC source not linked`);
      continue;
    }
    const status = input.linkStatus[subject.subjectId];
    if (status?.stale) {
      blockers.push(`${subject.name}: linked KYC source ${status.staleReason ?? 'changed'}; review it again`);
      continue;
    }
    if (link.reviewState !== 'verified') {
      blockers.push(`${subject.name}: KYC not verified`);
    }
    const missing = KYC_COVERAGE_ITEMS[subject.kind].filter((item) => link.coverage[item.key] !== true);
    if (missing.length > 0) {
      blockers.push(`${subject.name}: missing ${missing.map((item) => item.label.toLowerCase()).join('; ')}`);
    }
  }

  return { ready: blockers.length === 0, blockers };
}

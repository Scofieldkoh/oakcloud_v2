'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, ClipboardCheck, Link2, Plus, Trash2, User } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card-section';
import { Checkbox } from '@/components/ui/checkbox';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  useCompanyIncorporationReview,
  useKycSourceSearch,
  useUpdateCompanyIncorporationReview,
} from '@/hooks/use-company-incorporation-review';
import {
  INCORPORATION_CHECKLIST_AREAS,
  KYC_COVERAGE_ITEMS,
  STAFF_SUBJECT_ROLES,
  type ChecklistDecisionState,
  type KycLink,
  type ReviewSubject,
  type ReviewSubjectKind,
} from '@/lib/forms/company-incorporation-review';
import { PARTY_ROLE_LABELS } from '@/lib/form-templates/sg-company-incorporation';
import type { CompanyIncorporationReviewUpdate } from '@/services/company-incorporation-review.service';
import type { CompanyIncorporationSubmissionRecord } from '@/services/company-incorporation-intake.service';

type UpdateWithoutRevision = CompanyIncorporationReviewUpdate extends infer U
  ? U extends { expectedRevision: number } ? Omit<U, 'expectedRevision'> : never
  : never;

const SELECT_CLASS = 'h-8 rounded-md border border-border-primary bg-background-primary px-2 text-sm text-text-primary';

const ROLE_LABELS: Record<string, string> = {
  ...Object.fromEntries(STAFF_SUBJECT_ROLES.map((role) => [role.value, role.label])),
  ...PARTY_ROLE_LABELS,
};

const SEVERITY_LABELS: Record<string, { label: string; className: string }> = {
  error: { label: 'Must fix', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
  // Profile version 1 responses only.
  needs_information: { label: 'Needs information', className: 'bg-status-warning/10 text-status-warning' },
  staff_review: { label: 'Staff review', className: 'bg-oak-primary/10 text-oak-primary' },
};

type PartyRow = CompanyIncorporationSubmissionRecord['partyRows'][number];

function partyDetails(party: PartyRow): string[] {
  const details: string[] = [];
  if (party.roles.includes('shareholder')) {
    if (party.ownershipUndecided) details.push('Ownership not decided');
    else details.push(`${party.ownershipPercent ?? '0'}%${party.shares ? ` (${Number(party.shares).toLocaleString('en-SG')} shares)` : ''}`);
  }
  if (party.resident) details.push('Lives in Singapore');
  if (party.nomineeShareholder) details.push('Nominee shareholder');
  if (party.nomineeDirector) details.push('Nominee director');
  if (party.shareholderNominator) details.push(`Shareholder nominator: ${party.shareholderNominator}`);
  if (party.directorNominator) details.push(`Director nominator: ${party.directorNominator}`);
  if (party.nominator) details.push(`Acts for ${party.nominator}`);
  if (party.otherControl) details.push('Other control');
  return details;
}

const REVIEW_STATE_LABELS: Record<KycLink['reviewState'], string> = {
  received: 'Received, not yet reviewed',
  verified: 'Verified',
  needs_follow_up: 'Needs follow-up',
};

function roleText(roles: string[]): string {
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(', ') || 'No role';
}

interface CompanyIncorporationReviewPanelProps {
  formId: string;
  submissionId: string;
}

export function CompanyIncorporationReviewPanel({ formId, submissionId }: CompanyIncorporationReviewPanelProps) {
  const { error: showError } = useToast();
  const { data, isLoading, error } = useCompanyIncorporationReview(formId, submissionId, true);
  const updateMutation = useUpdateCompanyIncorporationReview(formId, submissionId);
  const [linkingSubject, setLinkingSubject] = useState<ReviewSubject | null>(null);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectKind, setNewSubjectKind] = useState<ReviewSubjectKind>('individual');
  const [newSubjectRole, setNewSubjectRole] = useState<string>(STAFF_SUBJECT_ROLES[0].value);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const apply = async (update: UpdateWithoutRevision): Promise<boolean> => {
    if (!data) return false;
    try {
      await updateMutation.mutateAsync({ ...update, expectedRevision: data.review.revision } as CompanyIncorporationReviewUpdate);
      return true;
    } catch (mutationError) {
      showError(mutationError instanceof Error ? mutationError.message : 'Update failed');
      return false;
    }
  };

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-border-primary bg-background-secondary p-4 text-sm text-text-secondary shadow-sm sm:rounded-3xl">
        Loading incorporation checklist…
      </section>
    );
  }
  if (error || !data) {
    return (
      <Alert variant="error" title="Incorporation checklist unavailable">
        {error instanceof Error ? error.message : 'The checklist could not be loaded.'}
      </Alert>
    );
  }

  const { intake, subjects, review, linkStatus, readiness } = data;
  const staleCount = Object.values(linkStatus).filter((status) => status.stale).length;

  return (
    <section className="space-y-4 rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <ClipboardCheck className="h-4 w-4 text-oak-primary" aria-hidden="true" />
            Company incorporation preparation
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Reference {data.reference} · Template version {intake.templateVersion} · Staff only; nothing here is shown to the client or filed with ACRA.
          </p>
        </div>
      </div>

      {readiness.ready ? (
        <Alert variant="success" title="Ready for filing preparation">
          Every checklist area is confirmed and each person has a verified KYC source. This is an internal readiness check, not ACRA approval.
        </Alert>
      ) : (
        <Alert variant="warning" title={`Not ready for filing preparation (${readiness.blockers.length} open)`}>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {readiness.blockers.slice(0, 8).map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
          {readiness.blockers.length > 8 && (
            <p className="mt-1 text-xs">And {readiness.blockers.length - 8} more.</p>
          )}
        </Alert>
      )}

      {staleCount > 0 && (
        <Alert variant="error" title="KYC source changed">
          {staleCount === 1 ? 'One linked KYC source has' : `${staleCount} linked KYC sources have`} changed or been removed since review. Review the link again.
        </Alert>
      )}

      <CardSection title="Intake summary" badge={intake.issues.length > 0 ? `${intake.issues.length} items` : undefined} id="incorporation-intake">
        <div className="space-y-3 p-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-secondary">Primary activity</dt>
              <dd className="text-text-primary">{intake.ssic.primary ? intake.ssic.primary.label : 'Not selected'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Secondary activity</dt>
              <dd className="text-text-primary">{intake.ssic.secondary ? intake.ssic.secondary.label : 'None'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Ownership total</dt>
              <dd className="text-text-primary">
                {intake.ownershipTotal}%{intake.ownershipFullyDecided === false ? ' (some percentages undecided)' : ''}
                {intake.shareCount ? ` of ${Number(intake.shareCount).toLocaleString('en-SG')} shares` : ''}
              </dd>
            </div>
          </dl>
          {intake.issues.length === 0 ? (
            <p className="text-xs text-text-secondary">The intake raised no items for follow-up.</p>
          ) : (
            <ul className="space-y-1.5">
              {intake.issues.map((issue, index) => {
                const severity = SEVERITY_LABELS[issue.severity] ?? SEVERITY_LABELS.staff_review;
                return (
                  <li key={`${issue.code}-${index}`} className="flex items-start gap-2">
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-2xs font-medium ${severity.className}`}>
                      {severity.label}
                    </span>
                    <span className="text-text-primary">{issue.message}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardSection>

      <CardSection title="People and KYC" badge={`${subjects.length}`} id="incorporation-people">
        <div className="space-y-3 p-4">
          <ul className="divide-y divide-border-primary rounded-lg border border-border-primary">
            {subjects.map((subject) => {
              const link = review.kycLinks[subject.subjectId];
              const status = linkStatus[subject.subjectId];
              const party = subject.partyRowId ? intake.partyRows.find((row) => row.partyRowId === subject.partyRowId) : undefined;
              const coverageItems = KYC_COVERAGE_ITEMS[subject.kind];
              const covered = link ? coverageItems.filter((item) => link.coverage[item.key]).length : 0;
              return (
                <li key={subject.subjectId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      {subject.kind === 'organisation'
                        ? <Building2 className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                        : <User className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />}
                      <span className="truncate">{subject.name}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {roleText(subject.roles)}
                      {party && partyDetails(party).map((detail) => <span key={detail}> · {detail}</span>)}
                      {subject.origin === 'staff' && ' · Added by staff'}
                    </p>
                    <p className="mt-0.5 text-xs">
                      {!link ? (
                        <span className="text-status-warning">KYC source not linked</span>
                      ) : status?.stale ? (
                        <span className="text-red-600 dark:text-red-400">Linked source {status.staleReason}</span>
                      ) : (
                        <span className={link.reviewState === 'verified' ? 'text-green-700 dark:text-green-400' : 'text-status-warning'}>
                          {REVIEW_STATE_LABELS[link.reviewState]} · {covered}/{coverageItems.length} particulars · {link.sourceLabel}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {link?.sourceKind === 'form_submission' && link.sourceId && link.sourceFormId && (
                      <Link
                        href={`/forms/${link.sourceFormId}/responses/${link.sourceId}`}
                        className="text-xs text-oak-primary hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open source
                      </Link>
                    )}
                    <Button
                      variant="secondary"
                      size="xs"
                      leftIcon={<Link2 className="h-3.5 w-3.5" />}
                      onClick={() => setLinkingSubject(subject)}
                    >
                      {link ? 'Review link' : 'Link KYC'}
                    </Button>
                    {subject.origin === 'staff' && (
                      <Button
                        variant="ghost"
                        size="xs"
                        iconOnly
                        aria-label={`Remove ${subject.name}`}
                        onClick={() => void apply({ action: 'remove_subject', subjectId: subject.subjectId })}
                        disabled={updateMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border-primary p-3">
            <FormInput
              label="Add a person the client did not list"
              placeholder="Full name"
              value={newSubjectName}
              onChange={(event) => setNewSubjectName(event.target.value)}
              containerClassName="min-w-[12rem] flex-1"
            />
            <select aria-label="Person type" className={SELECT_CLASS} value={newSubjectKind} onChange={(event) => setNewSubjectKind(event.target.value as ReviewSubjectKind)}>
              <option value="individual">Individual</option>
              <option value="organisation">Organisation</option>
            </select>
            <select aria-label="Role" className={SELECT_CLASS} value={newSubjectRole} onChange={(event) => setNewSubjectRole(event.target.value)}>
              {STAFF_SUBJECT_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              disabled={!newSubjectName.trim() || updateMutation.isPending}
              onClick={async () => {
                const ok = await apply({ action: 'add_subject', name: newSubjectName.trim(), kind: newSubjectKind, roles: [newSubjectRole] });
                if (ok) setNewSubjectName('');
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </CardSection>

      <CardSection title="Preparation checklist" id="incorporation-checklist">
        <ul className="divide-y divide-border-primary">
          {INCORPORATION_CHECKLIST_AREAS.map((area) => {
            const decision = review.decisions[area.key];
            const state: ChecklistDecisionState = decision?.state ?? 'pending';
            const noteDraft = noteDrafts[area.key] ?? decision?.note ?? '';
            return (
              <li key={area.key} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{area.title}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">{area.detail}</p>
                  <FormInput
                    aria-label={`${area.title} note`}
                    placeholder="Note (optional)"
                    inputSize="xs"
                    value={noteDraft}
                    onChange={(event) => setNoteDrafts((current) => ({ ...current, [area.key]: event.target.value }))}
                    onBlur={() => {
                      if ((decision?.note ?? '') === noteDraft.trim()) return;
                      void apply({ action: 'set_decision', areaKey: area.key, state, note: noteDraft.trim() || null });
                    }}
                    containerClassName="mt-2"
                  />
                  {decision && decision.state !== 'pending' && (
                    <p className="mt-1 text-2xs text-text-tertiary">Updated {new Date(decision.decidedAt).toLocaleString()}</p>
                  )}
                </div>
                <select
                  aria-label={`${area.title} status`}
                  className={SELECT_CLASS}
                  value={state}
                  disabled={updateMutation.isPending}
                  onChange={(event) => void apply({
                    action: 'set_decision',
                    areaKey: area.key,
                    state: event.target.value as ChecklistDecisionState,
                    note: noteDraft.trim() || null,
                  })}
                >
                  <option value="pending">Pending</option>
                  <option value="satisfied">Confirmed</option>
                  {area.allowNotApplicable && <option value="not_applicable">Not applicable</option>}
                </select>
              </li>
            );
          })}
        </ul>
      </CardSection>

      {linkingSubject && (
        <KycLinkModal
          formId={formId}
          submissionId={submissionId}
          subject={linkingSubject}
          existing={review.kycLinks[linkingSubject.subjectId] ?? null}
          isSaving={updateMutation.isPending}
          onClose={() => setLinkingSubject(null)}
          onSave={async (update) => {
            if (await apply(update)) setLinkingSubject(null);
          }}
        />
      )}
    </section>
  );
}

interface KycLinkModalProps {
  formId: string;
  submissionId: string;
  subject: ReviewSubject;
  existing: KycLink | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (update: UpdateWithoutRevision) => Promise<void>;
}

function KycLinkModal({ formId, submissionId, subject, existing, isSaving, onClose, onSave }: KycLinkModalProps) {
  const [sourceKind, setSourceKind] = useState<KycLink['sourceKind']>(existing?.sourceKind ?? 'form_submission');
  const [sourceId, setSourceId] = useState<string | null>(existing?.sourceId ?? null);
  const [sourceLabel, setSourceLabel] = useState<string>(existing?.sourceKind === 'form_submission' ? existing.sourceLabel : '');
  const [query, setQuery] = useState(subject.name);
  const [manualLocation, setManualLocation] = useState(existing?.manualLocation ?? '');
  const [coverage, setCoverage] = useState<Record<string, boolean>>(existing?.coverage ?? {});
  const [reviewState, setReviewState] = useState<KycLink['reviewState']>(existing?.reviewState ?? 'received');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { data: candidates = [], isFetching } = useKycSourceSearch(formId, submissionId, sourceKind === 'form_submission' ? query : '');

  const coverageItems = KYC_COVERAGE_ITEMS[subject.kind];
  const canSave = useMemo(() => (
    sourceKind === 'form_submission' ? !!sourceId : manualLocation.trim().length > 0
  ), [manualLocation, sourceId, sourceKind]);

  return (
    <Modal isOpen onClose={onClose} title={`KYC source for ${subject.name}`} description={roleText(subject.roles)} size="2xl">
      <ModalBody className="space-y-4">
        <div className="flex gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={sourceKind === 'form_submission'} onChange={() => setSourceKind('form_submission')} />
            Oakcloud form response
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={sourceKind === 'manual'} onChange={() => setSourceKind('manual')} />
            Held elsewhere
          </label>
        </div>

        {sourceKind === 'form_submission' ? (
          <div className="space-y-2">
            <FormInput
              label="Search responses by respondent name, email or form title"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              hint={sourceId ? `Selected: ${sourceLabel}` : 'Select the KYC response that covers this person.'}
            />
            <ul className="max-h-56 divide-y divide-border-primary overflow-y-auto rounded-md border border-border-primary">
              {isFetching && <li className="p-2 text-xs text-text-secondary">Searching…</li>}
              {!isFetching && candidates.length === 0 && (
                <li className="p-2 text-xs text-text-secondary">No matching responses.</li>
              )}
              {candidates.map((candidate) => {
                const label = `${candidate.formTitle} · ${candidate.respondentName || candidate.respondentEmail || 'Unnamed respondent'}`;
                const selected = candidate.submissionId === sourceId;
                return (
                  <li key={candidate.submissionId}>
                    <button
                      type="button"
                      className={`w-full p-2 text-left text-sm hover:bg-background-tertiary ${selected ? 'bg-oak-primary/10' : ''}`}
                      onClick={() => { setSourceId(candidate.submissionId); setSourceLabel(label); }}
                    >
                      <span className="block text-text-primary">{label}</span>
                      <span className="block text-xs text-text-secondary">
                        Submitted {new Date(candidate.submittedAt).toLocaleDateString()}
                        {candidate.respondentEmail ? ` · ${candidate.respondentEmail}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <FormInput
            label="Where the KYC evidence is kept"
            placeholder="e.g. SharePoint > Clients > ABC Pte Ltd > KYC"
            value={manualLocation}
            onChange={(event) => setManualLocation(event.target.value)}
          />
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">Particulars present in this source</p>
          {coverageItems.map((item) => (
            <Checkbox
              key={item.key}
              label={item.label}
              checked={coverage[item.key] === true}
              onChange={(event) => setCoverage((current) => ({ ...current, [item.key]: event.target.checked }))}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <label className="flex flex-col gap-1 text-sm text-text-primary">
            Review status
            <select className={SELECT_CLASS} value={reviewState} onChange={(event) => setReviewState(event.target.value as KycLink['reviewState'])}>
              {(Object.keys(REVIEW_STATE_LABELS) as KycLink['reviewState'][]).map((state) => (
                <option key={state} value={state}>{REVIEW_STATE_LABELS[state]}</option>
              ))}
            </select>
          </label>
          <FormInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </ModalBody>
      <ModalFooter>
        {existing && (
          <Button
            variant="danger"
            size="sm"
            disabled={isSaving}
            onClick={() => void onSave({ action: 'unlink_kyc', subjectId: subject.subjectId })}
          >
            Unlink
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          isLoading={isSaving}
          disabled={!canSave || isSaving}
          onClick={() => void onSave({
            action: 'link_kyc',
            subjectId: subject.subjectId,
            sourceKind,
            sourceId: sourceKind === 'form_submission' ? sourceId : null,
            manualLocation: sourceKind === 'manual' ? manualLocation.trim() : null,
            coverage,
            reviewState,
            notes: notes.trim() || null,
          })}
        >
          Save link
        </Button>
      </ModalFooter>
    </Modal>
  );
}

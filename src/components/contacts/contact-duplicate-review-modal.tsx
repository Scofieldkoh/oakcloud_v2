'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  useContactDuplicateGroups,
  useMergeContacts,
  useRejectContactDuplicate,
} from '@/hooks/use-contacts';
import type {
  ContactDuplicateGroup,
  ContactDuplicatePreview,
  ContactMergeFieldDecisions,
  MergeContactsInput,
} from '@/types/contact';
import type { ContactIdentityConflict, ContactMatchReason } from '@/types/contact-identity';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { CardDetailItem, CardDetailsGrid, MobileCard } from '@/components/ui/responsive-table';
import { useToast } from '@/components/ui/toast';

const CONFIRMATION_COPY = 'The duplicate source records will be permanently deleted. Only the selected master contact will remain.';

const reasonLabels: Record<ContactMatchReason, string> = {
  IDENTIFIER: 'Matching identifier',
  CORPORATE_UEN: 'Matching corporate UEN',
  APPROVED_ALIAS: 'Approved alias',
  EXACT_CANONICAL_NAME: 'Exact canonical name',
  CORPORATE_SUFFIX_VARIANT: 'Corporate suffix variant',
  FUZZY_NAME: 'Fuzzy name',
};

const fieldLabels: Record<ContactIdentityConflict['field'], string> = {
  identificationNumber: 'identification number',
  corporateUen: 'corporate UEN',
  identificationType: 'identification type',
  alias: 'alias',
  nationality: 'nationality',
  dateOfBirth: 'date of birth',
  fullAddress: 'full address',
  firstName: 'first name',
  lastName: 'last name',
  corporateName: 'corporate name',
};

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `contact-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function referenceTotal(contact: ContactDuplicatePreview) {
  return Object.values(contact.referenceCounts).reduce((sum, count) => sum + count, 0);
}

function referenceSummary(contact: ContactDuplicatePreview) {
  const counts = contact.referenceCounts;
  return [
    `Officers ${counts.officerPositions}`,
    `Shareholders ${counts.shareholdings}`,
    `Charges ${counts.chargeHoldings}`,
    `Notes ${counts.noteTabs}`,
    `Documents ${counts.documentRevisions}`,
    `Aliases ${counts.aliases}`,
  ].join(' · ');
}

function detailsSummary(contact: ContactDuplicatePreview) {
  return contact.contactDetails.map((detail) => `${detail.detailType}: ${detail.value}`).join(', ') || 'None';
}

function companySummary(contact: ContactDuplicatePreview) {
  return contact.companies.map((company) => company.name).join(', ') || 'None';
}

function ContactCard({
  contact,
  isMaster,
  isRecommended,
  onSelectMaster,
}: {
  contact: ContactDuplicatePreview;
  isMaster: boolean;
  isRecommended: boolean;
  onSelectMaster: () => void;
}) {
  const masterControl = (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm focus-within:ring-2 focus-within:ring-oak-primary/30">
      <input
        type="radio"
        name="duplicate-master"
        checked={isMaster}
        onChange={onSelectMaster}
        aria-label={`Use ${contact.fullName} as master`}
        className="h-4 w-4 accent-oak-primary"
      />
      <span>{isMaster ? 'Selected master' : 'Use as master'}</span>
    </label>
  );

  return (
    <div data-testid="duplicate-contact-mobile-card">
      <MobileCard
        className={isMaster ? 'ring-2 ring-oak-primary/40' : undefined}
        title={contact.fullName}
        subtitle={contact.alias ? `Alias: ${contact.alias}` : contact.contactType === 'CORPORATE' ? 'Corporate' : 'Individual'}
        badge={isRecommended ? <span className="badge badge-success">Recommended</span> : undefined}
        actions={masterControl}
        details={
          <CardDetailsGrid>
            <CardDetailItem label="Identifier" value={contact.identificationNumber || contact.corporateUen || 'None'} />
            <CardDetailItem label="Nationality" value={contact.nationality || 'None'} />
            <CardDetailItem label="Birth date" value={contact.dateOfBirth || 'None'} />
            <CardDetailItem label="References" value={referenceTotal(contact)} />
            <CardDetailItem label="Address" value={contact.fullAddress || 'None'} fullWidth />
            <CardDetailItem label="Contact details" value={detailsSummary(contact)} fullWidth />
            <CardDetailItem label="Companies" value={companySummary(contact)} fullWidth />
            <CardDetailItem label="Reference context" value={referenceSummary(contact)} fullWidth />
          </CardDetailsGrid>
        }
      />
    </div>
  );
}

function contactFieldValue(contact: ContactDuplicatePreview, field: ContactIdentityConflict['field']) {
  const value = contact[field];
  return value == null ? null : String(value);
}

function masterRetainedDecisions(group: ContactDuplicateGroup, masterId: string): ContactMergeFieldDecisions {
  const master = group.contacts.find((contact) => contact.id === masterId) ?? group.contacts[0];
  const fields = [...new Set(group.conflicts.map(({ field }) => field))];
  return Object.fromEntries(fields
    .filter((field) => field !== 'identificationNumber' && field !== 'corporateUen')
    .map((field) => [field, contactFieldValue(master, field)])) as ContactMergeFieldDecisions;
}

function ReviewGroup({
  group,
  onRefresh,
  onGroupRemoved,
}: {
  group: ContactDuplicateGroup;
  onRefresh: () => Promise<void>;
  onGroupRemoved: () => void;
}) {
  const toast = useToast();
  const merge = useMergeContacts();
  const reject = useRejectContactDuplicate();
  const [masterId, setMasterId] = useState(group.recommendedMasterId);
  const [fieldDecisions, setFieldDecisions] = useState<ContactMergeFieldDecisions>(() => masterRetainedDecisions(group, group.recommendedMasterId));
  const [mergeConfirmationOpen, setMergeConfirmationOpen] = useState(false);
  const [rejectConfirmationOpen, setRejectConfirmationOpen] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const master = group.contacts.find((contact) => contact.id === masterId) ?? group.contacts[0];
  const sourceContacts = group.contacts.filter((contact) => contact.id !== master.id);
  const conflictFields = [...new Set(group.conflicts.map(({ field }) => field))];
  const unresolvedConflicts = conflictFields.filter((field) => fieldDecisions[field] === undefined);

  const expectedUpdatedAt = useMemo(
    () => Object.fromEntries(group.contacts.map((contact) => [contact.id, contact.updatedAt])),
    [group.contacts],
  );

  const resetMergeAttempt = () => {
    idempotencyKey.current = null;
    setReviewError(null);
  };

  const selectMaster = (id: string) => {
    setMasterId(id);
    setFieldDecisions(masterRetainedDecisions(group, id));
    resetMergeAttempt();
  };

  const selectConflictValue = (field: ContactIdentityConflict['field'], value: string | null) => {
    setFieldDecisions((current) => {
      const next = { ...current, [field]: value };
      if (field === 'identificationNumber') {
        const selectedContact = group.contacts.find((contact) => contact.identificationNumber === value);
        next.identificationType = value === null ? null : selectedContact?.identificationType ?? master.identificationType;
      }
      return next;
    });
    resetMergeAttempt();
  };

  const handleMerge = async () => {
    const key = idempotencyKey.current ?? createIdempotencyKey();
    idempotencyKey.current = key;
    const input: MergeContactsInput = {
      idempotencyKey: key,
      masterContactId: master.id,
      sourceContactIds: sourceContacts.map((contact) => contact.id),
      expectedUpdatedAt,
      expectedFingerprints: group.fingerprints,
      fieldDecisions,
    };
    try {
      await merge.mutateAsync(input);
      idempotencyKey.current = null;
      setMergeConfirmationOpen(false);
      setReviewError(null);
      toast.success('Contacts merged successfully');
      onGroupRemoved();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to merge contacts';
      setReviewError(/stale|changed|no longer current/i.test(message)
        ? 'This recommendation changed. Refresh the recommendations and review again.'
        : message);
      toast.error(message);
    }
  };

  const handleReject = async (reason?: string) => {
    if (!reason) return;
    const sortedIds = [...group.contactIds].sort();
    const pairs = sortedIds.flatMap((leftContactId, leftIndex) =>
      sortedIds.slice(leftIndex + 1).map((rightContactId) => [leftContactId, rightContactId] as const),
    );
    const failures: string[] = [];
    let rejectedCount = 0;
    for (const [leftContactId, rightContactId] of pairs) {
      try {
        await reject.mutateAsync({
          leftContactId,
          rightContactId,
          leftFingerprint: group.fingerprints[leftContactId],
          rightFingerprint: group.fingerprints[rightContactId],
          reason,
          deferInvalidation: true,
        });
        rejectedCount += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `Failed to reject ${leftContactId} and ${rightContactId}`);
      }
    }
    if (failures.length === 0) {
      setRejectConfirmationOpen(false);
      setReviewError(null);
      toast.success('Duplicate recommendation rejected');
      onGroupRemoved();
      void reject.invalidateQueries();
    } else {
      const firstFailure = failures[0];
      const message = `Rejected ${rejectedCount} of ${pairs.length} pairs. ${firstFailure}. Retry to complete the remaining pair rejections.`;
      setReviewError(/stale|changed|no longer current/i.test(firstFailure)
        ? `Rejected ${rejectedCount} of ${pairs.length} pairs. This recommendation changed. Refresh the recommendations and review again.`
        : message);
      toast.error(message);
      throw new Error(message);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-success">{group.confidence}% confidence</span>
          {group.reasons.map((reason) => <span key={reason} className="badge badge-neutral">{reasonLabels[reason]}</span>)}
        </div>

        {reviewError ? (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-status-error bg-status-error/5 p-3 text-sm text-status-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{reviewError}</p>
              {/changed.*review again/i.test(reviewError) ? (
                <Button className="mt-2 min-h-11 sm:min-h-7" size="xs" variant="secondary" leftIcon={<RefreshCw />} onClick={onRefresh}>Refresh recommendations</Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <section aria-labelledby="duplicate-contacts-heading">
          <h3 id="duplicate-contacts-heading" className="mb-2 text-base font-semibold text-text-primary">Choose the master contact</h3>
          <p className="mb-3 text-sm text-text-secondary">All other contacts in this group will be merged into the selected master in one operation.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {group.contacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                isMaster={contact.id === master.id}
                isRecommended={contact.id === group.recommendedMasterId}
                onSelectMaster={() => selectMaster(contact.id)}
              />
            ))}
          </div>
        </section>

        {group.conflicts.length > 0 ? (
          <section aria-labelledby="conflicts-heading" className="rounded-lg border border-status-warning bg-status-warning/5 p-3 sm:p-4">
            <div className="mb-3 flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" />
              <div>
                <h3 id="conflicts-heading" className="text-base font-semibold text-text-primary">Resolve conflicting fields</h3>
                <p className="text-sm text-text-secondary">An identifier conflict blocks this merge until selected. Other differing fields retain the master value by default.</p>
              </div>
            </div>
            <div className="space-y-3">
              {conflictFields.map((field) => {
                const masterValue = contactFieldValue(master, field);
                const values = [...new Set(group.contacts.map((contact) => contactFieldValue(contact, field)).filter((value): value is string => value != null && value !== ''))];
                const selected = fieldDecisions[field];
                return (
                  <fieldset key={field} className="rounded-lg border border-border-primary bg-background-secondary p-3">
                    <legend className="px-1 text-sm font-medium capitalize text-text-primary">{fieldLabels[field]}</legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {values.map((value) => (
                        <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-background-tertiary focus-within:ring-2 focus-within:ring-oak-primary/30">
                          <input
                            type="radio"
                            name={`conflict-${field}`}
                            checked={selected !== undefined && selected === value}
                            onChange={() => selectConflictValue(field, value)}
                            aria-label={value === masterValue ? `Use master ${fieldLabels[field]}` : `Use ${fieldLabels[field]} ${value}`}
                          />
                          <span>{value === masterValue ? <strong>Master: </strong> : null}{value}</span>
                        </label>
                      ))}
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-background-tertiary focus-within:ring-2 focus-within:ring-oak-primary/30">
                        <input type="radio" name={`conflict-${field}`} checked={selected === null} onChange={() => selectConflictValue(field, null)} aria-label={`Clear ${fieldLabels[field]}`} />
                        <span>Clear value</span>
                      </label>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-status-success/30 bg-status-success/5 p-3 text-sm text-text-secondary">
            <CheckCircle2 className="h-4 w-4 text-status-success" /> No blocking field conflicts.
          </div>
        )}
      </div>

      <ModalFooter className="-mx-4 -mb-4 mt-4 px-4">
        <Button className="min-h-11 sm:min-h-8" variant="secondary" onClick={() => setRejectConfirmationOpen(true)}>Reject recommendation</Button>
        <Button className="min-h-11 sm:min-h-8" disabled={unresolvedConflicts.length > 0} isLoading={merge.isPending} onClick={() => setMergeConfirmationOpen(true)}>Merge contacts</Button>
      </ModalFooter>

      <ConfirmDialog
        isOpen={mergeConfirmationOpen}
        onClose={() => setMergeConfirmationOpen(false)}
        onConfirm={handleMerge}
        title="Permanently merge contacts"
        description={CONFIRMATION_COPY}
        confirmLabel="Permanently merge"
        variant="danger"
        isLoading={merge.isPending}
      />
      <ConfirmDialog
        isOpen={rejectConfirmationOpen}
        onClose={() => setRejectConfirmationOpen(false)}
        onConfirm={handleReject}
        title="Reject duplicate recommendation"
        description="Every unique pair in this group will be rejected separately. Successful pair rejections remain saved if another pair fails."
        confirmLabel="Reject all pairs"
        variant="danger"
        requireReason
        reasonLabel="Rejection reason"
        reasonPlaceholder="Explain why these contacts are different"
        reasonMinLength={10}
        isLoading={reject.isPending}
      />
    </>
  );
}

export function ContactDuplicateReviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const query = useContactDuplicateGroups(page, 1, open);
  const group = query.error ? undefined : query.data?.groups[0];

  useEffect(() => {
    const totalPages = query.data?.totalPages;
    if (totalPages === undefined) return;
    setPage((current) => Math.min(current, Math.max(1, totalPages)));
  }, [query.data?.totalPages]);

  const refresh = async () => {
    const result = await query.refetch();
    const totalPages = result.data?.totalPages;
    if (totalPages !== undefined) setPage((current) => Math.min(current, Math.max(1, totalPages)));
  };

  const handleGroupRemoved = () => {
    const remainingPages = Math.max(0, (query.data?.totalPages ?? 1) - 1);
    setPage((current) => Math.min(current, Math.max(1, remainingPages)));
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Review duplicate contacts" description="Review each recommendation before merging or rejecting it." size="4xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
      <ModalBody>
        {query.isLoading ? <p className="py-8 text-center text-sm text-text-secondary">Loading duplicate recommendations...</p> : null}
        {query.error ? (
          <div role="alert" className="rounded-lg border border-status-error bg-status-error/5 p-3 text-sm text-status-error">
            <p>{query.error instanceof Error ? query.error.message : 'Failed to load duplicate recommendations'}</p>
            <Button className="mt-2 min-h-11 sm:min-h-7" size="xs" variant="secondary" leftIcon={<RefreshCw />} onClick={() => void refresh()}>Retry loading recommendations</Button>
          </div>
        ) : null}
        {!query.isLoading && !query.error && !group ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-status-success" />
            <h3 className="text-base font-semibold text-text-primary">No pending duplicates</h3>
            <p className="mt-1 text-sm text-text-secondary">There are no recommendations to review.</p>
          </div>
        ) : null}
        {group ? (
          <ReviewGroup
            key={`${group.contactIds.join(':')}:${Object.values(group.fingerprints).join(':')}`}
            group={group}
            onRefresh={refresh}
            onGroupRemoved={handleGroupRemoved}
          />
        ) : null}

        {!query.error && (query.data?.totalPages ?? 0) > 1 ? (
          <div className="mt-4 flex items-center justify-between border-t border-border-primary pt-4 text-sm text-text-secondary">
            <Button className="min-h-11 sm:min-h-7" variant="secondary" size="xs" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous group</Button>
            <span>Page {page} of {query.data?.totalPages}</span>
            <Button className="min-h-11 sm:min-h-7" variant="secondary" size="xs" disabled={page === query.data?.totalPages} onClick={() => setPage((value) => value + 1)}>Next group</Button>
          </div>
        ) : null}
      </ModalBody>
    </Modal>
  );
}

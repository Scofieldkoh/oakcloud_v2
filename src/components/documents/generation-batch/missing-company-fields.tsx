'use client';

import { useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SingleDateInput } from '@/components/ui/single-date-input';
import {
  saveCompanyDocumentField,
  useCompanyDocumentFieldValues,
} from '@/hooks/use-company-document-fields';
import {
  companyFieldTagsToResolve,
  detectMissingCompanyFields,
  encodeYearEnd,
  formatCompanyFieldValue,
  normalizeCompanyFieldValue,
  type CompanyFieldHome,
  type CompanyFieldHomeId,
  type MissingCompanyField,
} from '@/lib/document-editor/oakdoc-company-field-homes';
import type { BatchItemConfiguration } from '@/types/document-generation-batch';
import { BatchSection } from './batch-section';

export interface MissingCompanyFieldsProps {
  company: { id: string; name: string } | null;
  /** Tags in the document's Word (OakDoc) template. */
  templateFieldTags?: readonly string[];
  /** Values set for this document only (`configuration.companyFieldValues`). */
  documentValues?: Record<string, string>;
  onPatch: (patch: Partial<BatchItemConfiguration>) => void;
  disabled?: boolean;
}

type Draft = Record<string, string>;

const MONTH_OPTIONS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((label, index) => ({ value: String(index + 1), label }));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));

function encodeDraft(home: CompanyFieldHome, draft: Draft): string {
  switch (home.input) {
    case 'date':
    case 'text':
      return draft.value ?? '';
    case 'yearEnd':
      return draft.day && draft.month ? encodeYearEnd(Number(draft.day), Number(draft.month)) : '';
    case 'address':
      return JSON.stringify(draft);
    case 'money':
      return JSON.stringify({
        currency: draft.currency ?? 'SGD',
        amount: draft.amount?.trim() ? Number(draft.amount) : '',
      });
  }
}

function initialDraft(home: CompanyFieldHome): Draft {
  if (home.input === 'address') return { country: 'Singapore' };
  if (home.input === 'money') return { currency: 'SGD' };
  return {};
}

function FieldEditor({
  home,
  draft,
  onChange,
  error,
  disabled,
}: {
  home: CompanyFieldHome;
  draft: Draft;
  onChange: (draft: Draft) => void;
  error?: string;
  disabled?: boolean;
}) {
  const set = (key: string) => (value: string) => onChange({ ...draft, [key]: value });
  const inputId = `missing-company-${home.id}`;
  switch (home.input) {
    case 'date':
      return (
        <SingleDateInput
          id={inputId}
          value={draft.value ?? ''}
          onChange={set('value')}
          ariaLabel={home.label}
          error={error}
          disabled={disabled}
          className="w-full"
        />
      );
    case 'text':
      return (
        <FormInput
          id={inputId}
          aria-label={home.label}
          value={draft.value ?? ''}
          onChange={(event) => set('value')(event.target.value)}
          error={error}
          disabled={disabled}
          containerClassName="max-w-sm"
        />
      );
    case 'yearEnd':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <SearchableSelect
              options={DAY_OPTIONS}
              value={draft.day ?? ''}
              onChange={set('day')}
              ariaLabel={`${home.label} day`}
              placeholder="Day"
              disabled={disabled}
              size="md"
              className="w-28"
            />
            <SearchableSelect
              options={MONTH_OPTIONS}
              value={draft.month ?? ''}
              onChange={set('month')}
              ariaLabel={`${home.label} month`}
              placeholder="Month"
              disabled={disabled}
              size="md"
              className="w-44"
            />
          </div>
          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>
      );
    case 'address':
      return (
        <div className="space-y-1">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <FormInput label="Block" id={`${inputId}-block`} value={draft.block ?? ''} onChange={(event) => set('block')(event.target.value)} disabled={disabled} />
            <FormInput label="Street name" id={`${inputId}-street`} value={draft.streetName ?? ''} onChange={(event) => set('streetName')(event.target.value)} disabled={disabled} />
            <FormInput label="Level" id={`${inputId}-level`} value={draft.level ?? ''} onChange={(event) => set('level')(event.target.value)} disabled={disabled} />
            <FormInput label="Unit" id={`${inputId}-unit`} value={draft.unit ?? ''} onChange={(event) => set('unit')(event.target.value)} disabled={disabled} />
            <FormInput label="Building" id={`${inputId}-building`} value={draft.buildingName ?? ''} onChange={(event) => set('buildingName')(event.target.value)} disabled={disabled} />
            <FormInput label="Postal code" id={`${inputId}-postal`} value={draft.postalCode ?? ''} onChange={(event) => set('postalCode')(event.target.value)} disabled={disabled} />
          </div>
          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>
      );
    case 'money':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <FormInput label="Currency" id={`${inputId}-currency`} value={draft.currency ?? ''} onChange={(event) => set('currency')(event.target.value)} disabled={disabled} containerClassName="w-24" />
            <FormInput label="Amount" id={`${inputId}-amount`} type="number" min={0} step="0.01" value={draft.amount ?? ''} onChange={(event) => set('amount')(event.target.value)} disabled={disabled} containerClassName="w-44" />
          </div>
          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>
      );
  }
}

function MissingFieldRow({
  field,
  disabled,
  onUse,
  onSaveDocumentValue,
  onClearDocumentValue,
}: {
  field: MissingCompanyField;
  disabled?: boolean;
  onUse: (id: CompanyFieldHomeId, value: string) => void;
  onSaveDocumentValue: (id: CompanyFieldHomeId, value: string) => void;
  onClearDocumentValue: (id: CompanyFieldHomeId) => void;
}) {
  const { home, documentValue } = field;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(home));
  const [error, setError] = useState<string | undefined>();

  const use = () => {
    const result = normalizeCompanyFieldValue(home.id, encodeDraft(home, draft));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(undefined);
    onUse(home.id, result.value);
  };

  return (
    <li className="rounded-lg border border-border-primary bg-background-primary p-3">
      <p className="text-sm font-medium text-text-primary">{home.label}</p>
      {home.id === 'firstFinancialYearEnd' && field.tags.includes('company.financialYearEnd') ? (
        <p className="text-xs text-text-muted">The financial year end is taken from this date&apos;s day and month.</p>
      ) : null}
      {documentValue ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-text-secondary">
            Using <span className="font-medium text-text-primary">{formatCompanyFieldValue(home.id, documentValue)}</span> for this document only.
          </p>
          <Button size="xs" variant="secondary" onClick={() => onSaveDocumentValue(home.id, documentValue)} disabled={disabled}>
            Save to company
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onClearDocumentValue(home.id)} disabled={disabled}>
            Clear
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <FieldEditor home={home} draft={draft} onChange={setDraft} error={error} disabled={disabled} />
          </div>
          <Button size="sm" onClick={use} disabled={disabled}>
            Use value
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Warns about company values the template prints that are blank for the
 * selected company, and lets the user fill each one: saved to the company
 * where it belongs, or used for this document only.
 */
export function MissingCompanyFields({
  company,
  templateFieldTags,
  documentValues,
  onPatch,
  disabled = false,
}: MissingCompanyFieldsProps) {
  const companyId = company?.id ?? null;
  const tags = useMemo(() => companyFieldTagsToResolve(templateFieldTags), [templateFieldTags]);
  const { values, reload } = useCompanyDocumentFieldValues(companyId, tags);
  const [pending, setPending] = useState<{ home: CompanyFieldHome; value: string; fromDocument: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const missing = useMemo(() => (values
    ? detectMissingCompanyFields({ tags: templateFieldTags, values, documentValues })
    : null), [documentValues, templateFieldTags, values]);

  if (!company || !missing || missing.fillable.length === 0) return null;

  const unresolved = missing.fillable.filter((field) => !field.documentValue).length;
  const withoutDocument = (id: CompanyFieldHomeId) => {
    const next = { ...(documentValues ?? {}) };
    delete next[id];
    return next;
  };
  const open = (id: CompanyFieldHomeId, value: string, fromDocument: boolean) => {
    const home = missing.fillable.find((field) => field.home.id === id)?.home;
    if (!home) return;
    setSaveError(null);
    setPending({ home, value, fromDocument });
  };
  const close = () => {
    if (!saving) setPending(null);
  };
  const applyToDocument = () => {
    if (!pending) return;
    onPatch({ companyFieldValues: { ...(documentValues ?? {}), [pending.home.id]: pending.value } });
    setPending(null);
  };
  const saveToCompany = async () => {
    if (!pending || !companyId) return;
    setSaveError(null);
    setSaving(true);
    try {
      await saveCompanyDocumentField(companyId, { fieldId: pending.home.id, value: pending.value });
      // Patching marks the preview out of date, so it re-renders with the saved value.
      onPatch({ companyFieldValues: withoutDocument(pending.home.id) });
      setPending(null);
      reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save the value.');
    } finally {
      setSaving(false);
    }
  };

  const total = unresolved;
  return (
    <BatchSection
      title="Missing company information"
      status={{
        complete: total === 0,
        label: total === 0 ? 'Filled for this document' : `${total} missing`,
      }}
    >
      <div className="space-y-3">
        <Alert variant="warning" compact>
          This document prints company details that {company.name} has no value for. Fill them in
          here, or they print blank.
        </Alert>
        {missing.fillable.length > 0 ? (
          <ul className="space-y-2" aria-label="Missing company values">
            {missing.fillable.map((field) => (
              <MissingFieldRow
                key={field.home.id}
                field={field}
                disabled={disabled}
                onUse={(id, value) => open(id, value, false)}
                onSaveDocumentValue={(id, value) => open(id, value, true)}
                onClearDocumentValue={(id) => onPatch({ companyFieldValues: withoutDocument(id) })}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <Modal
        isOpen={pending !== null}
        onClose={close}
        title={pending ? `Save ${pending.home.label}?` : undefined}
        size="md"
      >
        {pending ? (
          <>
            <ModalBody>
              <div className="space-y-3">
                {saveError ? <Alert variant="error" compact>{saveError}</Alert> : null}
                <p className="text-sm text-text-primary">
                  Save <span className="font-medium">{formatCompanyFieldValue(pending.home.id, pending.value)}</span>{' '}
                  as the {pending.home.label.toLowerCase()} in {company.name}&apos;s {pending.home.sectionLabel}?
                </p>
                <p className="text-sm text-text-secondary">
                  Saving updates the company record, so later documents use it too.
                </p>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              {!pending.fromDocument ? (
                <Button variant="secondary" onClick={applyToDocument} disabled={saving}>
                  Use for this document only
                </Button>
              ) : null}
              <Button onClick={() => void saveToCompany()} isLoading={saving}>
                Save to company
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </BatchSection>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { DocumentPartyChoiceList } from '@/components/documents/document-party-choice-list';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { formatOakDocRole } from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { DocumentParty } from '@/lib/document-party';
import { groupOfficersByPerson, oneOfficerPerPerson } from '@/lib/officer-identity';

export interface OfficerChoiceListProps {
  id: string;
  label: string;
  /** Officer records on offer, one per appointment, in display order. */
  officers: DocumentParty[];
  /** Ticked officer record ids, in order. */
  values: readonly string[];
  onChange: (values: string[]) => void;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const ROLE_COLUMN_CLASS = 'w-32 sm:w-40';

function roleLabel(officer: DocumentParty): string {
  return formatOakDocRole(officer.role ?? officer.detail);
}

/** The role as the director list shows it, e.g. "SECRETARY". */
function detailRole(officer: DocumentParty): string | null {
  const role = (officer.role ?? officer.detail)?.replace(/_/g, ' ').trim();
  return role ? role.toUpperCase() : null;
}

/**
 * Officers listed once per person. A person holding several of the offered
 * roles has a role dropdown choosing which appointment prints; the ticked id
 * is that appointment's record, so changing the role swaps it in place.
 */
export function OfficerChoiceList({
  id,
  label,
  officers,
  values,
  onChange,
  isLoading,
  error,
  onRetry,
}: OfficerChoiceListProps) {
  const people = useMemo(() => groupOfficersByPerson(officers), [officers]);
  // A saved choice with two appointments of one person keeps the first.
  const selected = useMemo(() => oneOfficerPerPerson(values, officers), [values, officers]);
  // The role picked for a person not yet ticked, by person key.
  const [pendingRole, setPendingRole] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    const ticked = new Set(selected);
    return people.map((person) => {
      const chosen = person.records.find((record) => ticked.has(record.id))
        ?? person.records.find((record) => record.id === pendingRole[person.key])
        ?? person.records[0];
      return { person, chosen };
    });
  }, [people, pendingRole, selected]);
  const rowByRecordId = useMemo(
    () => new Map(rows.map((row) => [row.chosen.id, row])),
    [rows],
  );
  // A one-role person shows the role in the details line, like the director
  // and shareholder lists; a person with several roles picks it in a dropdown.
  const options = useMemo(
    () => rows.map(({ person, chosen }) => ({
      ...chosen,
      detail: person.records.length < 2 ? detailRole(chosen) : null,
    })),
    [rows],
  );

  const chooseRole = (personKey: string, fromId: string, toId: string) => {
    if (!toId || toId === fromId) return;
    const index = selected.indexOf(fromId);
    if (index < 0) {
      setPendingRole((current) => ({ ...current, [personKey]: toId }));
      return;
    }
    const next = [...selected];
    next[index] = toId;
    onChange(next);
  };

  return (
    <DocumentPartyChoiceList
      id={id}
      label={label}
      options={options}
      values={selected}
      onChange={(next) => onChange(oneOfficerPerPerson(next, officers))}
      multiple
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      renderOptionAction={(option) => {
        const row = rowByRecordId.get(option.id);
        if (!row) return null;
        const { person, chosen } = row;
        if (person.records.length < 2) return null;
        return (
          <SearchableSelect
            options={person.records.map((record) => ({ value: record.id, label: roleLabel(record) }))}
            value={chosen.id}
            onChange={(value) => chooseRole(person.key, chosen.id, value)}
            ariaLabel={`Role for ${chosen.name}`}
            size="sm"
            clearable={false}
            showKeyboardHints={false}
            popoverMinWidth={160}
            className={ROLE_COLUMN_CLASS}
          />
        );
      }}
    />
  );
}

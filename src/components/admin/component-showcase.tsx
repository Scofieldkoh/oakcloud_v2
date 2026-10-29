'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Building2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { ActiveFilterBar } from '@/components/ui/active-filter-bar';
import { Alert } from '@/components/ui/alert';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from '@/components/ui/async-search-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableBody, TableCell, TableEmptyState, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableShell, TableViewport } from '@/components/ui/data-table';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import { EmptyState, ListEmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FilterChip } from '@/components/ui/filter-chip';
import { FormInput } from '@/components/ui/form-input';
import { LoadingState } from '@/components/ui/loading-state';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Stepper } from '@/components/ui/stepper';
import { useToast } from '@/components/ui/toast';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip } from '@/components/ui/tooltip';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

/**
 * Internal gallery of the shared UI components in their common states. Every
 * example renders the production component with sample data, so this page
 * shows what the app ships. Add a section here when a new shared component
 * lands in `src/components/ui`.
 */

const SAMPLE_OPTIONS: SelectOption[] = [
  { value: 'acme', label: 'Acme Holdings Pte. Ltd.', description: '202600001A' },
  { value: 'beta', label: 'Beta Services Pte. Ltd.', description: '202600002B' },
  { value: 'cedar', label: 'Cedar Trading LLP', description: 'T26LL0003C' },
];

const ASYNC_OPTIONS: AsyncSearchSelectOption[] = SAMPLE_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  description: option.description,
}));

const SAMPLE_ROWS = [
  { id: '1', company: 'Acme Holdings Pte. Ltd.', service: 'Annual return', status: 'active' as const },
  { id: '2', company: 'Beta Services Pte. Ltd.', service: 'Form C filing', status: 'pending' as const },
  { id: '3', company: 'Cedar Trading LLP', service: 'Bookkeeping', status: 'inactive' as const },
];

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card space-y-4 p-4 sm:p-6">
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold text-text-primary">{title}</h2>
        <p className="mt-1 text-sm text-text-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      {children}
    </div>
  );
}

function AsyncSelectExample({ mode }: { mode: 'results' | 'loading' | 'error' }) {
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const options = useMemo(
    () => (mode === 'results' ? ASYNC_OPTIONS.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())) : []),
    [mode, query],
  );
  return (
    <AsyncSearchSelect
      label={mode === 'results' ? 'Company' : mode === 'loading' ? 'Company (loading)' : 'Company (failed search)'}
      value={value}
      onChange={(id) => setValue(id)}
      options={options}
      isLoading={mode === 'loading'}
      searchQuery={query}
      onSearchChange={setQuery}
      placeholder="Search companies..."
      icon={<Building2 className="h-4 w-4" />}
      emptySearchText="No companies available"
      noResultsText="No companies match your search"
      error={mode === 'error' ? "Couldn't load companies." : undefined}
      onRetry={mode === 'error' ? () => undefined : undefined}
    />
  );
}

const SECTIONS = [
  { id: 'buttons', label: 'Buttons' },
  { id: 'fields', label: 'Form fields' },
  { id: 'pickers', label: 'Pickers' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'empty-states', label: 'Empty states' },
  { id: 'filters', label: 'Filters' },
  { id: 'tables', label: 'Tables' },
  { id: 'dialogs', label: 'Dialogs and menus' },
  { id: 'navigation', label: 'Steps and paging' },
];

export function ComponentShowcase() {
  const toast = useToast();
  const { confirm, dialog } = useConfirmDialog();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectValue, setSelectValue] = useState('acme');
  const [date, setDate] = useState('');
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(false);
  const [filters, setFilters] = useState([
    { key: 'status', label: 'Status', value: 'Active' },
    { key: 'family', label: 'Family', value: 'Tax' },
  ]);
  const [page, setPage] = useState(1);
  const [tableEmpty, setTableEmpty] = useState(false);

  return (
    <div className="space-y-6">
      <nav aria-label="Showcase sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="rounded-full bg-background-tertiary px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary">
            {section.label}
          </a>
        ))}
      </nav>

      <Section id="buttons" title="Buttons" description="Primary for the one main action on a page, secondary for the rest, danger only for destructive acts.">
        <Example label="Variants">
          <div className="flex flex-wrap items-center gap-2">
            <Button leftIcon={<Plus />}>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" leftIcon={<Trash2 />}>Danger</Button>
          </div>
        </Example>
        <Example label="Sizes and states">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="secondary">Extra small</Button>
            <Button size="sm" variant="secondary">Small</Button>
            <Button size="md" variant="secondary">Medium</Button>
            <Button size="lg" variant="secondary">Large</Button>
            <Button isLoading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Example>
      </Section>

      <Section id="fields" title="Form fields" description="Labels sit above the field; hints and errors sit below it.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput label="Company name" placeholder="Acme Holdings Pte. Ltd." hint="As shown on the BizFile." />
          <FormInput label="UEN" defaultValue="2026" error="Enter a valid UEN." />
          <SingleDateInput label="Financial year end" value={date} onChange={setDate} showTodayButton />
          <FormInput label="Read only" value="Locked value" disabled readOnly />
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <Checkbox label="Send a copy to me" description="A copy goes to your login email." checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <Toggle label="Company monitoring" description="Tracks ECI and Form C due dates." checked={toggled} onChange={setToggled} />
        </div>
      </Section>

      <Section id="pickers" title="Pickers" description="SearchableSelect for lists already loaded, AsyncSearchSelect (or CompanySelect, ContactSearchSelect) for server search.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Example label="SearchableSelect">
            <SearchableSelect label="Company" options={SAMPLE_OPTIONS} value={selectValue} onChange={setSelectValue} size="md" />
          </Example>
          <Example label="SearchableSelect, loading">
            <SearchableSelect label="Company" options={[]} value="" onChange={() => undefined} loading size="md" />
          </Example>
          <Example label="AsyncSearchSelect">
            <AsyncSelectExample mode="results" />
          </Example>
          <Example label="AsyncSearchSelect, loading">
            <AsyncSelectExample mode="loading" />
          </Example>
          <Example label="AsyncSearchSelect, failed search">
            <AsyncSelectExample mode="error" />
          </Example>
        </div>
      </Section>

      <Section id="feedback" title="Feedback" description="Inline messages for local fixes, alerts for lasting issues, toasts for passing outcomes.">
        <div className="grid gap-3">
          <Alert variant="info" title="Company monitoring is off">Turn it on to track ECI and Form C deadlines.</Alert>
          <Alert variant="success">Saved.</Alert>
          <Alert variant="warning">This company has no SharePoint folder yet.</Alert>
          <Alert variant="error">Unable to load services.</Alert>
        </div>
        <Example label="Status badges">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="active" />
            <StatusBadge status="pending" />
            <StatusBadge status="inactive" />
            <StatusBadge status="success" label="Filed" />
            <StatusBadge status="failed" />
          </div>
        </Example>
        <Example label="Toasts">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => toast.success('Company saved')}>Show success</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.error('Could not save the company')}>Show error</Button>
          </div>
        </Example>
        <div className="grid gap-4 sm:grid-cols-2">
          <Example label="Loading">
            <div className="rounded-lg border border-border-primary"><LoadingState message="Loading companies..." /></div>
          </Example>
          <Example label="Request failed">
            <div className="rounded-lg border border-border-primary"><ErrorState message="Could not load companies." onRetry={() => undefined} /></div>
          </Example>
        </div>
      </Section>

      <Section id="empty-states" title="Empty states" description="ListEmptyState tells a filtered list apart from one with nothing in it yet.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border-primary">
            <ListEmptyState icon={Building2} noun="companies" filtered={false} emptyDescription="Add a company or upload a BizFile to get started." createAction={<Button size="sm" leftIcon={<Plus />}>Add Company</Button>} />
          </div>
          <div className="rounded-lg border border-border-primary">
            <ListEmptyState icon={Building2} noun="companies" filtered onClearFilters={() => undefined} />
          </div>
          <div className="rounded-lg border border-border-primary">
            <EmptyState icon={Building2} title="No SharePoint folder" description="Map a folder to file signed documents automatically." />
          </div>
        </div>
      </Section>

      <Section id="filters" title="Filters" description="Active filters show as removable chips with one Clear all.">
        <ActiveFilterBar
          filters={filters.map((filter) => ({ ...filter, onRemove: () => setFilters((current) => current.filter((item) => item.key !== filter.key)) }))}
          onClearAll={() => setFilters([])}
        />
        {filters.length === 0 ? (
          <Button size="sm" variant="secondary" onClick={() => setFilters([{ key: 'status', label: 'Status', value: 'Active' }, { key: 'family', label: 'Family', value: 'Tax' }])}>Reset example</Button>
        ) : null}
        <Example label="Single chip">
          <FilterChip label="Company" value="Acme Holdings" onRemove={() => undefined} />
        </Example>
      </Section>

      <Section id="tables" title="Tables" description="The shared table parts keep headers, zebra rows and the empty message consistent.">
        <Toggle label="Show the empty table" checked={tableEmpty} onChange={setTableEmpty} size="sm" />
        <TableShell>
          <TableViewport>
            <TableRoot aria-label="Sample services table">
              <TableHead>
                <TableHeaderRow>
                  <TableHeaderCell label="Company" />
                  <TableHeaderCell label="Service" />
                  <TableHeaderCell label="Status" />
                  <TableHeaderCell label="Actions" align="center" />
                </TableHeaderRow>
              </TableHead>
              <TableBody>
                {tableEmpty ? (
                  <TableEmptyState colSpan={4} message={<ListEmptyState noun="services" filtered onClearFilters={() => setTableEmpty(false)} />} />
                ) : SAMPLE_ROWS.map((row, index) => (
                  <TableRow key={row.id} index={index}>
                    <TableCell>{row.company}</TableCell>
                    <TableCell>{row.service}</TableCell>
                    <TableCell><StatusBadge status={row.status} size="xs" /></TableCell>
                    <TableCell className="text-center">
                      <Dropdown>
                        <DropdownTrigger asChild aria-label={`Actions for ${row.company}`}>
                          <button type="button" className="rounded p-1 text-text-tertiary hover:bg-background-elevated hover:text-text-primary">
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </DropdownTrigger>
                        <DropdownMenu>
                          <DropdownItem icon={<Pencil className="h-4 w-4" />}>Edit</DropdownItem>
                          <DropdownItem icon={<Trash2 className="h-4 w-4" />} destructive>Delete</DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </TableRoot>
          </TableViewport>
        </TableShell>
      </Section>

      <Section id="dialogs" title="Dialogs and menus" description="Use Modal for forms and ConfirmDialog (or useConfirmDialog) instead of browser pop-ups.">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setIsModalOpen(true)}>Open modal</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const confirmed = await confirm({ title: 'Discard changes?', description: 'Your edits to this company will be lost.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', variant: 'warning' });
              toast.info(confirmed ? 'Discarded' : 'Kept editing');
            }}
          >
            Open confirm dialog
          </Button>
          <Tooltip content="Tooltips explain icons and disabled actions.">
            <Button size="sm" variant="ghost">Hover for tooltip</Button>
          </Tooltip>
        </div>
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Edit company" description="Changes save when you press Save." size="md">
          <ModalBody>
            <FormInput label="Company name" defaultValue="Acme Holdings Pte. Ltd." />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => setIsModalOpen(false)}>Save</Button>
          </ModalFooter>
        </Modal>
        {dialog}
      </Section>

      <Section id="navigation" title="Steps and paging" description="Stepper for multi-step flows, Pagination under every paged list.">
        <Stepper
          steps={[
            { id: 'upload', label: 'Upload', description: 'Add documents' },
            { id: 'recipients', label: 'Recipients' },
            { id: 'fields', label: 'Fields' },
            { id: 'send', label: 'Review and send' },
          ]}
          currentStep={1}
        />
        <Pagination page={page} totalPages={5} total={96} limit={20} onPageChange={setPage} />
      </Section>
    </div>
  );
}

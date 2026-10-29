import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { OakDocCustomFieldsPanel } from '@/components/documents/oakdoc/oakdoc-custom-fields-panel';
import { BatchCustomFieldForm } from '@/components/documents/generation-batch/batch-custom-field-form';
import { DocumentContactChoiceList, type DocumentContact } from '@/components/documents/document-contact-choice-list';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import type { OakDocCustomField } from '@/lib/document-editor/oakdoc-custom-fields';
import { storagePlaceholdersToEditor } from '@/lib/template-placeholder-storage';
import '@/app/globals.css';

vi.mock('@/hooks/use-contacts', () => ({
  useContacts: () => ({
    data: {
      contacts: [
        { id: 'p1', fullName: 'Tan Wei Jie', identificationNumber: 'S1234567A' },
        { id: 'p2', fullName: 'Lim Mei Ling', identificationNumber: 'S7654321B' },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function PanelHarness({ onInsert }: { onInsert: (tag: string) => void }) {
  const [fields, setFields] = useState<OakDocCustomField[]>([
    { key: 'fee', label: 'Annual fee', type: 'currency', required: true },
  ]);
  return (
    <div className="w-72 bg-background-secondary p-3">
      <OakDocCustomFieldsPanel
        fields={fields}
        onChange={setFields}
        onInsert={(field) => onInsert(field.tag)}
        presentTags={['custom.fee']}
      />
    </div>
  );
}

const contacts: DocumentContact[] = [
  { id: 'c1', fullName: 'Alex Lim', email: 'alex@example.com', designation: 'Director' },
  { id: 'c2', fullName: 'Outside Adviser', email: 'adviser@example.com' },
];

function item(itemValues: Record<string, string> = {}): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-1',
    templateName: 'Engagement Letter',
    templateKind: 'STANDARD',
    templateVersion: 1,
    templateEngine: 'OAKDOC',
    displayOrder: 0,
    status: 'NOT_STARTED',
    configuration: {
      version: 1,
      title: 'Engagement Letter',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues,
      masterOverrides: {},
      useLetterhead: false,
      serviceAgreement: null,
    },
  } as unknown as EditableBatchItem;
}

describe('Word template custom fields and contacts', () => {
  beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; });
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('defines a dropdown custom field and inserts it', async () => {
    await page.viewport(1100, 800);
    const onInsert = vi.fn();
    await act(async () => root.render(<PanelHarness onInsert={onInsert} />));

    await act(async () => userEvent.click(screen.getByRole('button', { name: 'New custom field' })));
    const dialog = screen.getByRole('dialog');
    await act(async () => userEvent.fill(within(dialog).getByLabelText('Label'), 'Billing basis'));
    await act(async () => userEvent.click(within(dialog).getByRole('combobox')));
    await act(async () => userEvent.click(screen.getByRole('option', { name: 'Dropdown' })));
    await act(async () => userEvent.fill(within(dialog).getByPlaceholderText('One choice per line'), 'Annual\nMonthly'));
    await page.screenshot();
    await act(async () => userEvent.click(within(dialog).getByRole('button', { name: 'Add field' })));

    // The new field opens, ready to add.
    await expect.element(screen.getByText('{{custom.billing_basis}}')).toBeVisible();
    await expect.element(screen.getByText('Dropdown · required')).toBeVisible();
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Add Billing basis' })));
    expect(onInsert).toHaveBeenCalledWith('custom.billing_basis');
    await page.screenshot();
  });

  it('defines a Contact field from a shortlist and inserts its details', async () => {
    await page.viewport(1100, 800);
    const onInsert = vi.fn();
    await act(async () => root.render(<PanelHarness onInsert={onInsert} />));

    await act(async () => userEvent.click(screen.getByRole('button', { name: 'New custom field' })));
    const dialog = screen.getByRole('dialog');
    await act(async () => userEvent.fill(within(dialog).getByLabelText('Label'), 'Secretary'));
    await act(async () => userEvent.click(within(dialog).getAllByRole('combobox')[0]));
    await act(async () => userEvent.click(screen.getByRole('option', { name: 'Contact' })));
    await act(async () => userEvent.click(within(dialog).getByPlaceholderText('Search contacts to add...')));
    await act(async () => userEvent.click(await screen.findByText('Lim Mei Ling')));
    await expect.element(within(dialog).getByRole('list', { name: 'Contact shortlist' })).toHaveTextContent('Lim Mei Ling');
    await page.screenshot();
    await act(async () => userEvent.click(within(dialog).getByRole('button', { name: 'Add field' })));

    await expect.element(screen.getByText('Contact · required · 1 to choose from')).toBeVisible();
    await act(async () => userEvent.click(screen.getByTitle('Add custom.secretary.identificationNumber')));
    expect(onInsert).toHaveBeenCalledWith('custom.secretary.identificationNumber');
    await page.screenshot();
  });

  it('asks for custom values, including dropdown choices, and picks any contact', async () => {
    await page.viewport(1100, 800);
    const fields = storagePlaceholdersToEditor([
      { key: 'custom.fee', label: 'Annual fee', type: 'currency', source: 'custom', required: true },
      { key: 'custom.billing_basis', label: 'Billing basis', type: 'text', source: 'custom', options: ['Annual', 'Monthly'] },
      { key: 'custom.meeting_date', label: 'Meeting date', type: 'date', source: 'custom' },
    ], { scope: { kind: 'template', id: 'template-1' } });
    const onPatch = vi.fn();
    const onContact = vi.fn();
    await act(async () => root.render(
      <div className="space-y-6 p-4">
        <BatchCustomFieldForm item={item({ fee: '1500' })} fields={fields} onPatch={onPatch} />
        <div className="max-w-md">
          <DocumentContactChoiceList
            id="selected-contact"
            label="Contact"
            single
            contacts={contacts}
            selected={[contacts[1]]}
            onChange={onContact}
          />
        </div>
      </div>,
    ));

    await act(async () => userEvent.click(screen.getByRole('combobox', { name: 'Billing basis' })));
    await act(async () => userEvent.click(screen.getByRole('option', { name: 'Monthly' })));
    expect(onPatch).toHaveBeenLastCalledWith({ itemValues: { fee: '1500', billing_basis: 'Monthly' } });

    expect(screen.getByRole('radio', { name: 'Select Outside Adviser' })).toBeChecked();
    await act(async () => userEvent.click(screen.getByRole('radio', { name: 'Select Alex Lim' })));
    expect(onContact).toHaveBeenLastCalledWith([contacts[0]]);
    await page.screenshot();
  });
});

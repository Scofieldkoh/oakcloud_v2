import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { OakDocRepeaterPanel } from '@/components/documents/oakdoc/oakdoc-repeater-panel';
import { StandardDocumentConfig } from '@/components/documents/generation-batch/standard-document-config';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import type { OakDocRepeaterSections } from '@/lib/document-editor/oakdoc-custom-fields';
import type { DocumentParty } from '@/lib/document-party';
import '@/app/globals.css';

vi.mock('@/hooks/use-contacts', () => ({
  useContacts: () => ({ data: { contacts: [] }, isLoading: false, error: null, refetch: vi.fn() }),
}));

const TRANSFEREES = 'repeat.contacts.transferee';

function PanelHarness({ onSections }: { onSections: (sections: OakDocRepeaterSections) => void }) {
  const [sections, setSections] = useState<OakDocRepeaterSections>({
    names: { [TRANSFEREES]: 'Transferee' },
    shortlists: {},
  });
  return (
    <div className="w-80 bg-background-secondary p-3">
      <OakDocRepeaterPanel
        repeaterTags={[TRANSFEREES]}
        fieldTags={[]}
        onAdd={vi.fn()}
        onRemoveAtCaret={vi.fn()}
        onAssignField={vi.fn()}
        customFields={[{ key: 'transfer_shares', label: 'Shares transferred', type: 'number' }]}
        sections={sections}
        onSectionsChange={(next) => {
          setSections(next);
          onSections(next);
        }}
      />
    </div>
  );
}

function party(id: string, name: string): DocumentParty {
  return { id, contactId: id, name, detail: 'DIRECTOR', role: 'DIRECTOR', email: null, phone: null, address: { full: null, letter: null } };
}

function item(): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-1',
    templateName: 'Transfer of Shares',
    templateKind: 'RESOLUTION',
    templateVersion: 1,
    templateEngine: 'OAKDOC',
    displayOrder: 0,
    status: 'NOT_STARTED',
    configuration: {
      version: 1,
      title: 'Transfer of Shares',
      contactIds: [],
      selectedContactListIds: { transferee: ['p1', 'p2'] },
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: { transfer_shares: '1000' },
      masterOverrides: {},
      useLetterhead: false,
      serviceAgreement: null,
    },
  } as unknown as EditableBatchItem;
}

describe('Per-person fields', () => {
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

  it('adds a per-person field to a section that must add up to a document field', async () => {
    await page.viewport(1100, 900);
    const onSections = vi.fn();
    await act(async () => root.render(<PanelHarness onSections={onSections} />));

    await act(async () => userEvent.click(screen.getByRole('button', { name: /^Repeating sections/ })));
    const contacts = screen.getByRole('list', { name: 'Contacts sections' });
    await act(async () => userEvent.click(within(contacts).getByRole('button', { name: 'Transferee · Contacts list' })));
    await expect.element(screen.getByText('Per-person fields')).toBeVisible();
    await act(async () => userEvent.fill(screen.getByLabelText('New per-person field'), 'Shares received'));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Add per-person field' })));
    expect(onSections).toHaveBeenLastCalledWith(expect.objectContaining({
      personFields: { [TRANSFEREES]: [{ key: 'shares_received', label: 'Shares received', type: 'number', required: true }] },
    }));
    await page.screenshot();
  });

  it('asks each person their value on Configure and says when the total does not tally', async () => {
    await page.viewport(1100, 900);
    const onPatch = vi.fn();
    await act(async () => root.render(
      <div className="p-4">
        <StandardDocumentConfig
          item={item()}
          templateFields={[{ id: 'f1', key: 'custom.transfer_shares', type: 'number', label: 'Shares transferred', required: true }]}
          templateContent="<p>Word</p>"
          templateFieldTags={[TRANSFEREES, 'contact.name', 'item.shares']}
          repeaterSections={{
            names: { [TRANSFEREES]: ['Transferee'] },
            shortlists: {},
            personFields: { [TRANSFEREES]: [{ key: 'shares', label: 'Shares received', type: 'number', required: true, totalOf: 'transfer_shares' }] },
          }}
          masterFields={{ fields: [], conflicts: [] }}
          effectiveMasterValues={{}}
          directors={[party('d1', 'Dana Director')]}
          shareholders={[]}
          contacts={[{ id: 'p1', fullName: 'Tan Wei Jie' }, { id: 'p2', fullName: 'Lim Mei Ling' }]}
          companyContacts={[]}
          onPatch={onPatch}
        />
      </div>,
    ));

    const card = screen.getByRole('heading', { name: 'Transferee: details for each person' }).closest('section')!;
    await expect.element(within(card).getByText('Tan Wei Jie')).toBeVisible();
    await expect.element(within(card).getByText('Enter Shares received for Lim Mei Ling (Transferee).')).toBeVisible();
    await act(async () => userEvent.fill(within(card).getByLabelText('Shares received for Tan Wei Jie'), '600'));
    expect(onPatch).toHaveBeenLastCalledWith({ personValues: { [TRANSFEREES]: { p1: { shares: '600' } } } });
    await page.screenshot();
  });
});

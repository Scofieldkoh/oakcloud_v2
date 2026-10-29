import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { OakDocRepeaterPanel } from '@/components/documents/oakdoc/oakdoc-repeater-panel';
import { StandardDocumentConfig } from '@/components/documents/generation-batch/standard-document-config';
import { BatchSharedParties } from '@/components/documents/generation-batch/batch-shared-parties';
import { templatePartyNeeds } from '@/components/documents/generation-batch/template-party-needs';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import type { OakDocRepeaterSections } from '@/lib/document-editor/oakdoc-custom-fields';
import type { DocumentParty } from '@/lib/document-party';
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

const SECRETARY_TAG = 'repeat.contacts.corporate-secretary-to-be-appointed';

function PanelHarness({ onSections }: { onSections: (sections: OakDocRepeaterSections) => void }) {
  const [tags, setTags] = useState<string[]>(['repeat.directors']);
  const [sections, setSections] = useState<OakDocRepeaterSections>({ names: {}, shortlists: {} });
  return (
    <div className="w-72 bg-background-secondary p-3">
      <OakDocRepeaterPanel
        repeaterTags={tags}
        fieldTags={[]}
        onAdd={(definition) => setTags((current) => [...current, definition.tag])}
        onRemoveAtCaret={vi.fn()}
        onAssignField={vi.fn()}
        sections={sections}
        onSectionsChange={(next) => {
          setSections(next);
          onSections(next);
        }}
      />
    </div>
  );
}

function party(id: string, name: string, role = 'DIRECTOR'): DocumentParty {
  return { id, contactId: id, name, detail: role, role, email: null, phone: null, address: { full: null, letter: null } };
}

function item(key = 'item-1', selectedContactListIds?: Record<string, string[]>): EditableBatchItem {
  return {
    key,
    id: key,
    templateId: 'template-1',
    templateName: 'Change of Secretary',
    templateKind: 'RESOLUTION',
    templateVersion: 1,
    templateEngine: 'OAKDOC',
    displayOrder: 0,
    status: 'NOT_STARTED',
    configuration: {
      version: 1,
      title: 'Change of Secretary',
      contactIds: [],
      selectedContactListIds,
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: false,
      serviceAgreement: null,
    },
  } as unknown as EditableBatchItem;
}

describe('Named repeating sections', () => {
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

  it('names a Contacts section as its own list with its own shortlist, and renames a section', async () => {
    await page.viewport(1100, 900);
    const onSections = vi.fn();
    await act(async () => root.render(<PanelHarness onSections={onSections} />));

    // Open the Contacts kind under New section, name it and repeat the caret's paragraph.
    await act(async () => userEvent.click(screen.getByRole('button', { name: /^Repeating sections/ })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Contacts' })));
    await act(async () => userEvent.fill(screen.getByLabelText('List name on Configure'), 'Corporate secretary to be appointed'));
    await expect.element(screen.getByText(SECRETARY_TAG)).toBeVisible();
    await act(async () => userEvent.click(screen.getByRole('button', {
      name: 'Add Contacts (Corporate secretary to be appointed) section',
    })));
    const contacts = screen.getByRole('list', { name: 'Contacts sections' });
    await expect.element(within(contacts).getByText('Corporate secretary to be appointed · Contacts list')).toBeVisible();

    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Shortlist for Corporate secretary to be appointed' })));
    const dialog = screen.getByRole('dialog', { name: 'Corporate secretary to be appointed shortlist' });
    await expect.element(dialog).toBeVisible();
    await act(async () => userEvent.click(within(dialog).getByPlaceholderText('Search contacts to add...')));
    await act(async () => userEvent.click(await screen.findByText('Lim Mei Ling')));
    await expect.element(within(dialog).getByRole('list', { name: 'Contact shortlist' })).toHaveTextContent('Lim Mei Ling');
    await page.screenshot();
    await act(async () => userEvent.click(within(dialog).getByRole('button', { name: 'Done' })));
    await expect.element(within(contacts).getByText('Configure offers 1 shortlisted contact.')).toBeVisible();

    const directors = screen.getByRole('list', { name: 'Directors sections' });
    await act(async () => userEvent.click(within(directors).getByRole('button', { name: 'Directors' })));
    await act(async () => userEvent.fill(
      within(directors).getByRole('textbox', { name: 'Name on Configure' }),
      'Signers for the resolution(s)',
    ));
    expect(onSections).toHaveBeenLastCalledWith({
      names: {
        [SECRETARY_TAG]: 'Corporate secretary to be appointed',
        'repeat.directors': 'Signers for the resolution(s)',
      },
      shortlists: { [SECRETARY_TAG]: [{ id: 'p2', name: 'Lim Mei Ling' }] },
    });
    await page.screenshot();
  });

  it('shows each named section as its own card on Configure', async () => {
    await page.viewport(1100, 900);
    const onPatch = vi.fn();
    await act(async () => root.render(
      <div className="p-4">
        <StandardDocumentConfig
          item={item()}
          templateFields={[]}
          templateContent="<p>Word</p>"
          templateFieldTags={['repeat.directors', 'director.name', 'repeat.contacts', SECRETARY_TAG, 'contact.name']}
          repeaterSections={{
            names: {
              'repeat.directors': ['Signers for the resolution(s)'],
              [SECRETARY_TAG]: ['Corporate secretary to be appointed'],
            },
            shortlists: { [SECRETARY_TAG]: [{ id: 'p2', name: 'Lim Mei Ling' }, { id: 'p3', name: 'Ong Kai' }] },
          }}
          masterFields={{ fields: [], conflicts: [] }}
          effectiveMasterValues={{}}
          directors={[party('d1', 'Dana Director')]}
          shareholders={[]}
          contacts={[{ id: 'p9', fullName: 'Anyone Else' }]}
          companyContacts={[]}
          onPatch={onPatch}
        />
      </div>,
    ));

    await expect.element(screen.getByRole('heading', { name: 'Signers for the resolution(s)' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /^Parties/ })).toBeNull();
    const card = screen.getByRole('heading', { name: /^Corporate secretary to be appointed/ }).closest('section')!;
    await expect.element(within(card).getByRole('checkbox', { name: 'Select Ong Kai' })).toBeVisible();
    expect(within(card).queryByRole('checkbox', { name: /Anyone Else/ })).toBeNull();
    await act(async () => userEvent.click(within(card).getByRole('checkbox', { name: 'Select Ong Kai' })));
    expect(onPatch).toHaveBeenLastCalledWith({ selectedContactListIds: { 'corporate-secretary-to-be-appointed': ['p3'] } });
    await page.screenshot();
  });

  it('shares a contacts list in Shared setup only between lists of the same name', async () => {
    await page.viewport(1100, 900);
    const onApply = vi.fn();
    const tags = [SECRETARY_TAG, 'contact.name'];
    const sections = {
      names: { [SECRETARY_TAG]: ['Corporate secretary to be appointed'] },
      shortlists: { [SECRETARY_TAG]: [{ id: 'p2', name: 'Lim Mei Ling' }] },
    };
    const needs = templatePartyNeeds('', tags);
    await act(async () => root.render(
      <div className="p-4">
        <BatchSharedParties
          items={[item('a'), item('b'), item('c')]}
          needsByItemKey={{ a: needs, b: needs, c: needs }}
          fieldTagsByItemKey={{ a: tags, b: tags, c: ['repeat.contacts.auditor-to-be-appointed'] }}
          repeaterSectionsByItemKey={{
            a: sections,
            b: sections,
            c: { names: { 'repeat.contacts.auditor-to-be-appointed': ['Auditor to be appointed'] }, shortlists: {} },
          }}
          directors={[]}
          shareholders={[]}
          contacts={[party('p9', 'Anyone Else')]}
          onApply={onApply}
        />
      </div>,
    ));

    await expect.element(screen.getByText('Corporate secretary to be appointed')).toBeVisible();
    expect(screen.queryByText('Auditor to be appointed')).toBeNull();
    await act(async () => userEvent.click(screen.getByRole('checkbox', { name: /Lim Mei Ling/ })));
    expect(onApply).toHaveBeenCalledWith(['a'], { selectedContactListIds: { 'corporate-secretary-to-be-appointed': ['p2'] } });
    expect(onApply).toHaveBeenCalledWith(['b'], { selectedContactListIds: { 'corporate-secretary-to-be-appointed': ['p2'] } });
    await page.screenshot();
  });
});

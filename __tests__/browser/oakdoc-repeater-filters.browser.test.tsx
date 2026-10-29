import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { OakDocRepeaterPanel } from '@/components/documents/oakdoc/oakdoc-repeater-panel';
import { StandardDocumentConfig } from '@/components/documents/generation-batch/standard-document-config';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import type { OakDocRepeaterSections } from '@/lib/document-editor/oakdoc-custom-fields';
import type { OakDocRepeaterDefinition } from '@/lib/document-editor/oakdoc-repeaters';
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

function PanelHarness({ onAdd }: { onAdd: (definition: OakDocRepeaterDefinition) => void }) {
  const [sections, setSections] = useState<OakDocRepeaterSections>({ names: {}, shortlists: {} });
  return (
    <div className="w-72 bg-background-secondary p-3">
      <OakDocRepeaterPanel
        repeaterTags={['repeat.contacts', 'repeat.officers.secretary']}
        fieldTags={[]}
        onAdd={onAdd}
        onRemoveAtCaret={vi.fn()}
        onAssignField={vi.fn()}
        sections={sections}
        onSectionsChange={setSections}
      />
    </div>
  );
}

function officer(id: string, name: string, role: string): DocumentParty {
  return { id, contactId: null, name, detail: role, role, email: null, phone: null, address: { full: null, letter: null } };
}

function item(): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-1',
    templateName: 'Appointment Letter',
    templateKind: 'STANDARD',
    templateVersion: 1,
    templateEngine: 'OAKDOC',
    displayOrder: 0,
    status: 'NOT_STARTED',
    configuration: {
      version: 1,
      title: 'Appointment Letter',
      contactIds: [],
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

describe('Word repeater role filter and contact shortlist', () => {
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

  it('limits a new Officers section to roles and shortlists contacts', async () => {
    await page.viewport(1100, 900);
    const onAdd = vi.fn();
    await act(async () => root.render(<PanelHarness onAdd={onAdd} />));

    await act(async () => userEvent.click(screen.getByRole('button', { name: /^Repeating sections/ })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Officers' })));
    const roles = screen.getByRole('group', { name: 'Officer roles' });
    await act(async () => userEvent.click(within(roles).getByRole('button', { name: 'Secretary' })));
    await expect.element(screen.getByText('repeat.officers.secretary', { exact: true })).toBeVisible();
    const insertSecretaries = screen.getByRole('button', { name: 'Add Officers (Secretary) section' });
    await act(async () => userEvent.click(insertSecretaries));
    expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'repeat.officers.secretary' }));
    await expect.element(within(screen.getByRole('list', { name: 'Officers sections' })).getByText('Officers (Secretary)')).toBeVisible();

    const contacts = screen.getByRole('list', { name: 'Contacts sections' });
    await act(async () => userEvent.click(within(contacts).getByRole('button', { name: 'Contacts' })));
    await expect.element(screen.getByText('Configure offers any contact.')).toBeVisible();
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Shortlist' })));
    const dialog = screen.getByRole('dialog');
    await act(async () => userEvent.click(within(dialog).getByPlaceholderText('Search contacts to add...')));
    await act(async () => userEvent.click(await screen.findByText('Lim Mei Ling')));
    await expect.element(within(dialog).getByRole('list', { name: 'Contact shortlist' })).toHaveTextContent('Lim Mei Ling');
    await page.screenshot();
    await act(async () => userEvent.click(within(dialog).getByRole('button', { name: 'Done' })));
    await expect.element(screen.getByText('Configure offers 1 shortlisted contact.')).toBeVisible();
    await page.screenshot();
  });

  it('offers only officers of the repeater roles and the shortlisted contacts on Configure', async () => {
    await page.viewport(1100, 900);
    const onPatch = vi.fn();
    await act(async () => root.render(
      <div className="p-4">
        <StandardDocumentConfig
          item={item()}
          templateFields={[]}
          templateContent="<p>Word</p>"
          templateFieldTags={['repeat.officers.secretary', 'officer.name', 'repeat.contacts', 'contact.name']}
          contactShortlist={[{ id: 'p2', name: 'Lim Mei Ling' }, { id: 'p3', name: 'Ong Kai' }]}
          masterFields={{ fields: [], conflicts: [] }}
          effectiveMasterValues={{}}
          directors={[]}
          shareholders={[]}
          officers={[officer('o1', 'Dana Director', 'DIRECTOR'), officer('o2', 'Sam Secretary', 'SECRETARY')]}
          contacts={[{ id: 'p9', fullName: 'Anyone Else' }]}
          companyContacts={[]}
          onPatch={onPatch}
        />
      </div>,
    ));

    await expect.element(screen.getByRole('checkbox', { name: /Sam Secretary/ })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: /Dana Director/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Anyone Else/ })).toBeNull();
    await act(async () => userEvent.click(screen.getByRole('checkbox', { name: 'Select Ong Kai' })));
    expect(onPatch).toHaveBeenLastCalledWith({ contactIds: ['p3'] });
    await page.screenshot();
  });

  it('lists an officer once, with a role dropdown only for several roles, at one row height', async () => {
    const onPatch = vi.fn();
    const jane = (id: string, role: string): DocumentParty => ({ ...officer(id, 'Jane Ng', role), contactId: 'contact-jane' });
    const rowOf = (name: RegExp) => screen.getByRole('checkbox', { name }).closest('label')!.parentElement!;
    for (const width of [1100, 390]) {
      await page.viewport(width, 900);
      await act(async () => root.render(
        <div className="p-4">
          <StandardDocumentConfig
            item={item()}
            templateFields={[]}
            templateContent="<p>Word</p>"
            templateFieldTags={['repeat.directors', 'repeat.officers', 'officer.name']}
            masterFields={{ fields: [], conflicts: [] }}
            effectiveMasterValues={{}}
            directors={[officer('d9', 'Dana Director', 'DIRECTOR')]}
            shareholders={[]}
            officers={[jane('o1', 'DIRECTOR'), officer('o2', 'Sam Secretary', 'SECRETARY'), jane('o3', 'SECRETARY')]}
            contacts={[]}
            companyContacts={[]}
            onPatch={onPatch}
          />
        </div>,
      ));

      await expect.element(screen.getByRole('combobox', { name: 'Role for Jane Ng' })).toBeVisible();
      expect(screen.getAllByRole('checkbox', { name: /Jane Ng/ })).toHaveLength(1);
      expect(screen.queryByRole('combobox', { name: 'Role for Sam Secretary' })).toBeNull();
      // Inside the rows' borders (the last row of a list has none).
      const withDropdown = rowOf(/Jane Ng/).clientHeight;
      const withoutDropdown = rowOf(/Sam Secretary/).clientHeight;
      const directorRow = rowOf(/Dana Director/).clientHeight;
      expect(withDropdown).toBeGreaterThan(0);
      expect(withoutDropdown).toBe(withDropdown);
      expect(directorRow).toBe(withDropdown);
      await page.screenshot();
    }
  });
});

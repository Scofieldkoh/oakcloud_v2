import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchSharedParties } from '@/components/documents/generation-batch/batch-shared-parties';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import { templatePartyNeeds } from '@/components/documents/generation-batch/template-party-needs';
import type { DocumentParty } from '@/lib/document-party';

function party(id: string, name: string): DocumentParty {
  return { id, contactId: null, name, detail: 'DIRECTOR', email: null, phone: null, address: { full: null, letter: null } };
}

function item(key: string, selectedDirectorIds?: string[]): EditableBatchItem {
  return {
    key,
    id: key,
    templateId: 'resolution',
    templateName: 'Director Resolution',
    templateKind: 'RESOLUTION',
    templateVersion: 1,
    templateEngine: 'OAKDOC',
    status: 'NEEDS_INPUT',
    configuration: {
      version: 1,
      title: 'Director Resolution',
      contactIds: [],
      selectedDirectorId: null,
      selectedDirectorIds,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: false,
      serviceAgreement: null,
    },
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
  };
}

const directors = [party('d1', 'Alice Tan'), party('d2', 'Ben Lim')];
const resolutionNeeds = templatePartyNeeds('', ['repeat.directors', 'director.name']);
const letterNeeds = templatePartyNeeds('', []);

describe('BatchSharedParties', () => {
  it('sets the directors once for every document whose template signs by directors', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <BatchSharedParties
        items={[item('a'), item('b'), item('c')]}
        needsByItemKey={{ a: resolutionNeeds, b: resolutionNeeds, c: letterNeeds }}
        directors={directors}
        shareholders={[]}
        contacts={[]}
        onApply={onApply}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Shared parties' })).toBeInTheDocument();
    expect(screen.getByText('Used by 2 documents')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /shareholders/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Alice Tan/ }));
    expect(onApply).toHaveBeenCalledWith(['a', 'b'], { selectedDirectorIds: ['d2'] });
  });

  it('notes when documents differ, and shows nothing for a choice only one document uses', () => {
    const { rerender } = render(
      <BatchSharedParties
        items={[item('a'), item('b', ['d1'])]}
        needsByItemKey={{ a: resolutionNeeds, b: resolutionNeeds }}
        directors={directors}
        shareholders={[]}
        contacts={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/they differ, so the first document is shown/)).toBeInTheDocument();

    rerender(
      <BatchSharedParties
        items={[item('a'), item('b')]}
        needsByItemKey={{ a: resolutionNeeds, b: letterNeeds }}
        directors={directors}
        shareholders={[]}
        contacts={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'Shared parties' })).not.toBeInTheDocument();
  });

  it('offers officers of every role the documents print', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const officer = (id: string, name: string, role: string): DocumentParty => ({ ...party(id, name), detail: role, role });
    const secretaryNeeds = templatePartyNeeds('', ['repeat.officers.secretary']);
    const ceoNeeds = templatePartyNeeds('', ['repeat.officers.ceo']);
    render(
      <BatchSharedParties
        items={[item('a'), item('b')]}
        needsByItemKey={{ a: secretaryNeeds, b: ceoNeeds }}
        officerRolesByItemKey={{ a: ['SECRETARY'], b: ['CEO'] }}
        directors={[]}
        shareholders={[]}
        officers={[officer('o1', 'Dana Director', 'DIRECTOR'), officer('o2', 'Sam Secretary', 'SECRETARY'), officer('o3', 'Carl Chief', 'CEO')]}
        contacts={[]}
        onApply={onApply}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: /Dana Director/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Carl Chief/ }));
    expect(onApply).toHaveBeenCalledWith(['a', 'b'], { selectedOfficerIds: ['o3'] });
  });

  it('lists a shared officer once and swaps the ticked appointment when the role changes', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 160, height: 32, top: 0, left: 0, bottom: 32, right: 160, x: 0, y: 0, toJSON: () => undefined,
    } as unknown as DOMRect);
    const user = userEvent.setup();
    const onApply = vi.fn();
    const officer = (id: string, name: string, role: string): DocumentParty =>
      ({ ...party(id, name), detail: role, role, identificationNumber: name === 'Jane Ng' ? 'S1234567A' : null });
    const needs = templatePartyNeeds('', ['repeat.officers']);
    const withOfficers = (selectedOfficerIds: string[]) => ({
      ...item('a'),
      configuration: { ...item('a').configuration, selectedOfficerIds },
    });
    render(
      <BatchSharedParties
        items={[withOfficers(['sam', 'jane-director', 'jane-secretary']), { ...withOfficers(['sam', 'jane-director']), key: 'b', id: 'b' }]}
        needsByItemKey={{ a: needs, b: needs }}
        directors={[]}
        shareholders={[]}
        officers={[officer('jane-director', 'Jane Ng', 'DIRECTOR'), officer('jane-secretary', 'Jane Ng', 'SECRETARY'), officer('sam', 'Sam Lee', 'SECRETARY')]}
        contacts={[]}
        onApply={onApply}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    // A saved choice with both of Jane's roles counts her once, so the documents agree.
    expect(screen.getByText('Used by 2 documents')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for Sam Lee' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Role for Jane Ng' }));
    await user.click(screen.getByRole('option', { name: 'Secretary' }));
    expect(onApply).toHaveBeenLastCalledWith(['a', 'b'], { selectedOfficerIds: ['sam', 'jane-secretary'] });
    vi.restoreAllMocks();
  });

  it('titles a shared picker with the names the documents give their sections', () => {
    render(
      <BatchSharedParties
        items={[item('a'), item('b')]}
        needsByItemKey={{ a: resolutionNeeds, b: resolutionNeeds }}
        repeaterSectionsByItemKey={{
          a: { names: { 'repeat.directors': ['Signers for the resolution(s)'] }, shortlists: {} },
          b: { names: { 'repeat.directors': ['Approving directors'] }, shortlists: {} },
        }}
        directors={directors}
        shareholders={[]}
        contacts={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: /Signers for the resolution\(s\) · Approving directors/ })).toBeInTheDocument();
  });

  it('titles a shared single-director picker with the name the templates give it', () => {
    const signerNeeds = templatePartyNeeds('', ['selectedDirector.name']);
    render(
      <BatchSharedParties
        items={[item('a'), item('b')]}
        needsByItemKey={{ a: signerNeeds, b: signerNeeds }}
        repeaterSectionsByItemKey={{
          a: { names: { selectedDirector: ['Signer of the resolution(s)'] }, shortlists: {} },
          b: null,
        }}
        directors={directors}
        shareholders={[]}
        contacts={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText('Signer of the resolution(s)')).toBeInTheDocument();
    expect(screen.queryByText('Director', { exact: true })).not.toBeInTheDocument();
  });

  it('shares a named contacts list only with lists of the same name', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const tags = ['repeat.contacts.corp-sec', 'contact.name'];
    const needs = templatePartyNeeds('', tags);
    const corpSec = (shortlist: Array<{ id: string; name: string }>) => ({
      names: { 'repeat.contacts.corp-sec': ['Corporate secretary to be appointed'] },
      shortlists: { 'repeat.contacts.corp-sec': shortlist },
    });
    const a = item('a');
    a.configuration.selectedContactListIds = { 'corp-sec': ['k1'], other: ['k9'] };
    render(
      <BatchSharedParties
        items={[a, item('b'), item('c')]}
        needsByItemKey={{ a: needs, b: needs, c: needs }}
        fieldTagsByItemKey={{ a: tags, b: tags, c: ['repeat.contacts.auditor'] }}
        repeaterSectionsByItemKey={{
          a: corpSec([{ id: 'k1', name: 'Kim Lee' }]),
          b: corpSec([{ id: 'k2', name: 'Kay Ng' }]),
          c: { names: { 'repeat.contacts.auditor': ['Auditor to be appointed'] }, shortlists: {} },
        }}
        directors={[]}
        shareholders={[]}
        contacts={[party('k9', 'Anyone Else')]}
        onApply={onApply}
      />,
    );

    // One picker for the two lists of the same name; the auditor list is not shared.
    const picker = screen.getByRole('group', { name: /Corporate secretary to be appointed/ });
    expect(screen.queryByRole('group', { name: /Auditor to be appointed/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: /Anyone Else/ })).not.toBeInTheDocument();
    expect(screen.getByText(/they differ/)).toBeInTheDocument();

    await user.click(within(picker).getByRole('checkbox', { name: /Kay Ng/ }));
    // Each document keeps its other lists.
    expect(onApply).toHaveBeenCalledWith(['a'], { selectedContactListIds: { 'corp-sec': ['k1', 'k2'], other: ['k9'] } });
    expect(onApply).toHaveBeenCalledWith(['b'], { selectedContactListIds: { 'corp-sec': ['k1', 'k2'] } });
  });
});

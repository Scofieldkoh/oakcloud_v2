import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BatchItemConfigurator,
  type BatchItemConfiguratorProps,
} from '@/components/documents/generation-batch/batch-item-configurator';
import type { EditableBatchItem } from '@/components/documents/generation-batch/batch-workspace-state';
import type { MasterFieldCatalogue } from '@/types/document-generation-batch';

const masterFields: MasterFieldCatalogue = {
  fields: [
    {
      id: 'client_name::text',
      key: 'client_name',
      type: 'text',
      label: 'Client legal name',
      templateIds: ['template-a', 'template-b'],
      requiredTemplateIds: [],
      defaultsByTemplateId: {},
    },
  ],
  conflicts: [],
};

function item(kind: 'STANDARD' | 'SERVICE_AGREEMENT' = 'STANDARD'): EditableBatchItem {
  return {
    key: 'item-1',
    id: 'item-1',
    templateId: 'template-a',
    templateName: kind === 'SERVICE_AGREEMENT' ? 'Service Agreement' : 'Engagement Letter',
    templateKind: kind,
    templateVersion: 1,
    templateEngine: 'A4',
    status: 'NEEDS_INPUT',
    configuration: {
      version: 1,
      title: 'Engagement Letter',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: true,
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

function props(overrides: Partial<BatchItemConfiguratorProps> = {}): BatchItemConfiguratorProps {
  return {
    item: item(),
    primaryCompany: { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A', status: 'LIVE' },
    companies: [],
    contacts: [],
    companyContacts: [],
    directors: [],
    shareholders: [],
    masterFields,
    effectiveMasterValues: { client_name: 'Acme Pte. Ltd.' },
    onPatch: vi.fn(),
    ...overrides,
  };
}

/** The Contacts card's heading; another "Contacts" heading can sit inside a card. */
function contactsCardHeading() {
  return screen.getAllByRole('heading', { name: 'Contacts' }).find((heading) => heading.closest('header'))!;
}

describe('BatchItemConfigurator', () => {
  it('shows no subtext under the card headers', () => {
    render(<BatchItemConfigurator {...props({ templateContent: '<p>Word</p>', templateFieldTags: ['repeat.contacts', 'contact.name'] })} />);
    expect(contactsCardHeading()).toBeInTheDocument();
    expect(screen.queryByText(/in the order picked/)).not.toBeInTheDocument();
  });

  it('uses muted orange headers for incomplete required sections and green for complete sections', () => {
    render(<BatchItemConfigurator {...props()} />);

    const headers = document.querySelectorAll('section > header');
    expect(headers.length).toBeGreaterThan(1);
    expect(screen.getByRole('heading', { name: 'Details' }).closest('header'))
      .toHaveClass('bg-oak-primary');
    expect(screen.getByRole('heading', { name: /^Parties/ }).closest('header'))
      .toHaveClass('bg-[#9b6348]');
    expect(contactsCardHeading().closest('header'))
      .toHaveClass('bg-oak-primary');
  });

  it('does not expose letterhead controls', () => {
    render(<BatchItemConfigurator {...props()} />);

    expect(screen.queryByText('Output options')).not.toBeInTheDocument();
    expect(screen.queryByText('Use company letterhead')).not.toBeInTheDocument();
  });

  it('shows effective shared values and records an explicit local override', async () => {
    const user = userEvent.setup();
    const p = props();
    const { unmount } = render(<BatchItemConfigurator {...p} />);
    expect(screen.getByLabelText('Client legal name')).toHaveValue('Acme Pte. Ltd.');
    expect(screen.getByText('Shared')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /override for this document/i }));
    expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({
      masterOverrides: expect.objectContaining({ 'client_name::text': 'Acme Pte. Ltd.' }),
    }));
    unmount();
  });

  it('keeps service agreement services, fees, terms, entities, and representative item-specific', () => {
    const p = props({ item: item('SERVICE_AGREEMENT') });
    const { unmount } = render(<BatchItemConfigurator {...p} />);
    expect(screen.getByRole('heading', { name: /services and fees/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /entities and representative/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /authorised representative/i })).toBeInTheDocument();
    unmount();
  });

  it('is read-only for generated items', () => {
    const generated = item();
    generated.status = 'GENERATED';
    const { unmount } = render(<BatchItemConfigurator {...props({ item: generated })} />);
    expect(screen.getByText(/generated and locked/i)).toBeInTheDocument();
    unmount();
  });

  it('filters the authorised representative to primary-company contacts', () => {
    const p = props({
      item: item('SERVICE_AGREEMENT'),
      companyContacts: [{ id: 'primary-contact', fullName: 'Primary Contact' }],
      contacts: [{ id: 'other-contact', fullName: 'Other Contact' }],
    });
    const { unmount } = render(<BatchItemConfigurator {...p} />);
    const fieldset = screen.getByRole('group', { name: /authorised representative/i });
    expect(fieldset).toHaveTextContent('Primary Contact');
    expect(fieldset).not.toHaveTextContent('Other Contact');
    unmount();
  });

  it('renders item-only custom fields from the template', () => {
    const p = props({
      templateFields: [{
        id: 'reference',
        key: 'custom.reference',
        label: 'Reference',
        type: 'text',
        required: false,
      }],
    });
    const { unmount } = render(<BatchItemConfigurator {...p} />);
    expect(screen.getByLabelText('Reference')).toBeInTheDocument();
    unmount();
  });

  it('shows only the party controls used by the template and defaults director loops to all directors', async () => {
    const user = userEvent.setup();
    const p = props({
      templateContent: '<p>{{#each directors}}{{this.name}}{{/each}}</p>',
      directors: [
        { id: 'director-1', contactId: null, name: 'Alice Tan', detail: 'DIRECTOR', email: null, phone: null, address: { full: null, letter: null } },
        { id: 'director-2', contactId: null, name: 'Ben Lim', detail: 'DIRECTOR', email: null, phone: null, address: { full: null, letter: null } },
      ],
      shareholders: [
        { id: 'shareholder-1', contactId: null, name: 'Shareholder', detail: 'ORDINARY', email: null, phone: null, address: { full: null, letter: null } },
      ],
      companyContacts: [{ id: 'contact-1', fullName: 'Company Contact' }],
    });
    render(<BatchItemConfigurator {...p} />);

    expect(screen.getByRole('group', { name: /directors/i })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^director$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /shareholder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /company contact/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Contacts' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox').every((checkbox) => (
      (checkbox as HTMLInputElement).checked
    ))).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: /Alice Tan/ }));
    expect(p.onPatch).toHaveBeenCalledWith({ selectedDirectorIds: ['director-2'] });
  });

  it('lists every officer role for an officers repeater, unticked until chosen', async () => {
    const user = userEvent.setup();
    const officer = (id: string, name: string, detail: string) => ({
      id, contactId: null, name, detail, email: null, phone: null, address: { full: null, letter: null },
    });
    const p = props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.officers', 'officer.name'],
      officers: [
        officer('officer-1', 'Alice Tan', 'Director'),
        officer('officer-2', 'Sam Secretary', 'Secretary'),
        officer('officer-3', 'Sue Secretary', 'Secretary'),
      ],
    });
    render(<BatchItemConfigurator {...p} />);

    expect(screen.getByRole('group', { name: /officers/i })).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes.some((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(false);
    expect(screen.getByText('1 required')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Sue Secretary/ }));
    expect(p.onPatch).toHaveBeenCalledWith({ selectedOfficerIds: ['officer-3'] });
  });

  it('lists only officers of the roles the officers repeaters are limited to', async () => {
    const user = userEvent.setup();
    const officer = (id: string, name: string, role: string) => ({
      id, contactId: null, name, detail: role, role, email: null, phone: null, address: { full: null, letter: null },
    });
    const p = props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.officers.secretary', 'repeat.officers.ceo', 'officer.name'],
      officers: [
        officer('officer-1', 'Alice Tan', 'DIRECTOR'),
        officer('officer-2', 'Sam Secretary', 'SECRETARY'),
        officer('officer-3', 'Carl Chief', 'CEO'),
      ],
      item: { ...item(), configuration: { ...item().configuration, selectedOfficerIds: ['officer-1'] } },
    });
    render(<BatchItemConfigurator {...p} />);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: /Alice Tan/ })).not.toBeInTheDocument();
    // A ticked officer of another role does not count as chosen.
    expect(screen.getByText('1 required')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Sam Secretary/ }));
    expect(p.onPatch).toHaveBeenCalledWith({ selectedOfficerIds: ['officer-2'] });
  });

  describe('officers listed once per person', () => {
    const officer = (id: string, name: string, role: string, contactId: string | null = null) => ({
      id, contactId, name, detail: role, role, email: null, phone: null, address: { full: null, letter: null },
    });
    const officers = [
      officer('jane-director', 'Jane Ng', 'DIRECTOR', 'contact-jane'),
      officer('sam-secretary', 'Sam Lee', 'SECRETARY'),
      officer('jane-secretary', 'Jane Ng', 'SECRETARY', 'contact-jane'),
    ];
    const withOfficers = (selectedOfficerIds?: string[]) => props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.officers', 'officer.name'],
      officers,
      item: { ...item(), configuration: { ...item().configuration, selectedOfficerIds } },
    });

    beforeEach(() => {
      // The role dropdown's popover renders once its trigger has a width, which jsdom lacks.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 160, height: 32, top: 0, left: 0, bottom: 32, right: 160, x: 0, y: 0, toJSON: () => undefined,
      } as unknown as DOMRect);
    });
    afterEach(() => vi.restoreAllMocks());

    it('shows a role dropdown only for a person with more than one role', async () => {
      const user = userEvent.setup();
      const p = withOfficers();
      render(<BatchItemConfigurator {...p} />);

      expect(screen.getAllByRole('checkbox', { name: /Jane Ng/ })).toHaveLength(1);
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
      expect(screen.getByRole('combobox', { name: 'Role for Jane Ng' })).toHaveValue('Director');
      expect(screen.queryByRole('combobox', { name: 'Role for Sam Lee' })).not.toBeInTheDocument();
      // A one-role person shows the role under the name, like the director list.
      expect(screen.getByText('SECRETARY')).toBeInTheDocument();

      // Ticking prints the first role.
      await user.click(screen.getByRole('checkbox', { name: /Jane Ng/ }));
      expect(p.onPatch).toHaveBeenLastCalledWith({ selectedOfficerIds: ['jane-director'] });
    });

    it('swaps the ticked appointment in place when the role changes', async () => {
      const user = userEvent.setup();
      const p = withOfficers(['sam-secretary', 'jane-director']);
      render(<BatchItemConfigurator {...p} />);

      await user.click(screen.getByRole('combobox', { name: 'Role for Jane Ng' }));
      await user.click(screen.getByRole('option', { name: 'Secretary' }));
      expect(p.onPatch).toHaveBeenLastCalledWith({ selectedOfficerIds: ['sam-secretary', 'jane-secretary'] });
    });

    it('keeps the role chosen before ticking', async () => {
      const user = userEvent.setup();
      const p = withOfficers();
      render(<BatchItemConfigurator {...p} />);

      await user.click(screen.getByRole('combobox', { name: 'Role for Jane Ng' }));
      await user.click(screen.getByRole('option', { name: 'Secretary' }));
      expect(p.onPatch).not.toHaveBeenCalled();
      await user.click(screen.getByRole('checkbox', { name: /Jane Ng/ }));
      expect(p.onPatch).toHaveBeenLastCalledWith({ selectedOfficerIds: ['jane-secretary'] });
    });

    it('ticks a person once when a saved choice has two of their roles', async () => {
      const user = userEvent.setup();
      const p = withOfficers(['jane-secretary', 'jane-director']);
      render(<BatchItemConfigurator {...p} />);

      expect(screen.getByRole('checkbox', { name: /Jane Ng/ })).toBeChecked();
      expect(screen.getByRole('combobox', { name: 'Role for Jane Ng' })).toHaveValue('Secretary');
      await user.click(screen.getByRole('checkbox', { name: /Sam Lee/ }));
      expect(p.onPatch).toHaveBeenLastCalledWith({ selectedOfficerIds: ['jane-secretary', 'sam-secretary'] });
    });
  });

  it('offers only the template\'s shortlisted contacts for the contacts repeater', async () => {
    const user = userEvent.setup();
    const p = props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.contacts', 'contact.name'],
      contacts: [{ id: 'contact-9', fullName: 'Anyone Else' }],
      contactsById: new Map([['contact-2', { id: 'contact-2', fullName: 'Bea Tan', email: 'bea@example.com' }]]),
      contactShortlist: [{ id: 'contact-1', name: 'Alex Lim' }, { id: 'contact-2', name: 'Bea Tan' }],
      item: { ...item(), configuration: { ...item().configuration, contactIds: ['contact-9', 'contact-2'] } },
    });
    render(<BatchItemConfigurator {...p} />);

    expect(screen.queryByRole('checkbox', { name: /Anyone Else/ })).not.toBeInTheDocument();
    expect(screen.getByText('bea@example.com')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Bea Tan/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Alex Lim/ })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /Alex Lim/ }));
    expect(p.onPatch).toHaveBeenCalledWith({ contactIds: ['contact-2', 'contact-1'] });
  });

  it('searches every contact when the template sets no shortlist', () => {
    render(<BatchItemConfigurator {...props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.contacts', 'contact.name'],
      contacts: [{ id: 'contact-9', fullName: 'Anyone Else' }],
      contactShortlist: null,
    })} />);
    expect(screen.getByRole('checkbox', { name: /Anyone Else/ })).toBeInTheDocument();
  });

  it('gives each named contacts list its own card, shortlist and ticks', async () => {
    const user = userEvent.setup();
    const p = props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.contacts', 'repeat.contacts.corp-sec', 'repeat.contacts.auditor', 'contact.name'],
      contacts: [{ id: 'contact-9', fullName: 'Anyone Else' }],
      contactShortlist: [{ id: 'contact-1', name: 'Alex Lim' }],
      repeaterSections: {
        names: {
          'repeat.contacts.corp-sec': ['Corporate secretary to be appointed'],
          'repeat.contacts.auditor': ['Auditor to be appointed'],
        },
        shortlists: {
          'repeat.contacts': [{ id: 'contact-1', name: 'Alex Lim' }],
          'repeat.contacts.corp-sec': [{ id: 'contact-2', name: 'Bea Tan' }, { id: 'contact-3', name: 'Cal Ong' }],
        },
      },
      item: {
        ...item(),
        configuration: {
          ...item().configuration,
          contactIds: ['contact-1'],
          selectedContactListIds: { 'corp-sec': ['contact-3', 'contact-1'], auditor: ['contact-9'] },
        },
      },
    });
    render(<BatchItemConfigurator {...p} />);

    expect(contactsCardHeading()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Corporate secretary to be appointed/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Auditor to be appointed/ })).toBeInTheDocument();
    const corpSec = screen.getByRole('heading', { name: /^Corporate secretary to be appointed/ }).closest('section')!;
    // Only its own shortlist; an id not on it is not ticked.
    expect(within(corpSec).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(corpSec).getByRole('checkbox', { name: /Cal Ong/ })).toBeChecked();
    expect(within(corpSec).getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(1);
    // A list with no shortlist searches every contact.
    const auditor = screen.getByRole('heading', { name: /^Auditor to be appointed/ }).closest('section')!;
    expect(within(auditor).getByRole('checkbox', { name: /Anyone Else/ })).toBeChecked();

    await user.click(within(corpSec).getByRole('checkbox', { name: /Bea Tan/ }));
    expect(p.onPatch).toHaveBeenLastCalledWith({
      selectedContactListIds: { 'corp-sec': ['contact-3', 'contact-2'], auditor: ['contact-9'] },
    });
  });

  it('titles a named section with its name instead of Parties', async () => {
    const user = userEvent.setup();
    const officer = (id: string, name: string, role: string) => ({
      id, contactId: null, name, detail: role, role, email: null, phone: null, address: { full: null, letter: null },
    });
    const p = props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.directors', 'repeat.officers.secretary', 'repeat.officers.ceo', 'selectedContact.name'],
      directors: [officer('director-1', 'Dana Director', 'DIRECTOR')],
      officers: [officer('officer-2', 'Sam Secretary', 'SECRETARY')],
      repeaterSections: {
        names: {
          'repeat.directors': ['Signers for the resolution(s)'],
          'repeat.officers.secretary': ['Outgoing secretary'],
          'repeat.officers.ceo': ['Incoming CEO'],
        },
        shortlists: {},
      },
    });
    render(<BatchItemConfigurator {...p} />);

    expect(screen.getByRole('heading', { name: 'Signers for the resolution(s)' })).toBeInTheDocument();
    // Two officers sections share one selection; the card shows both names.
    expect(screen.getByRole('heading', { name: 'Outgoing secretary · Incoming CEO' })).toBeInTheDocument();
    // The selected contact stays under Parties.
    const parties = screen.getByRole('heading', { name: /^Parties/ }).closest('section')!;
    expect(within(parties).queryByRole('group', { name: /Directors/ })).not.toBeInTheDocument();

    const officers = screen.getByRole('heading', { name: 'Outgoing secretary · Incoming CEO' }).closest('section')!;
    expect(within(officers).getByText('1 required')).toBeInTheDocument();
    await user.click(within(officers).getByRole('checkbox', { name: /Sam Secretary/ }));
    expect(p.onPatch).toHaveBeenCalledWith({ selectedOfficerIds: ['officer-2'] });
  });

  it('keeps the Parties heading when no section is named', () => {
    render(<BatchItemConfigurator {...props({
      templateContent: '<p>Word</p>',
      templateFieldTags: ['repeat.directors', 'director.name'],
      repeaterSections: { names: {}, shortlists: {} },
    })} />);
    expect(screen.getByRole('heading', { name: /^Parties/ })).toBeInTheDocument();
  });

  it('titles the service agreement parties with the sections the author named', () => {
    render(<BatchItemConfigurator {...props({
      item: item('SERVICE_AGREEMENT'),
      repeaterSections: {
        names: {
          'repeat.authorisedRepresentatives': ['Persons signing for the client'],
          'repeat.agreementEntities': ['Client entities'],
        },
        shortlists: {},
      },
    })} />);
    expect(screen.getByRole('heading', { name: /^Client entities · Persons signing for the client/ })).toBeInTheDocument();
  });

  describe('one document per person', () => {
    const party = (id: string, name: string) => ({ id, contactId: null, name, detail: 'DIRECTOR', email: null, phone: null, address: { full: null, letter: null } });
    const directors = [party('d1', 'Liang Joo Heong'), party('d2', 'Yuly Mirawati')];

    it('picks the people on their own card and leaves the section out of Parties', async () => {
      const user = userEvent.setup();
      const onDocumentPeopleChange = vi.fn();
      const base = item();
      render(<BatchItemConfigurator {...props({
        item: {
          ...base,
          templateEngine: 'OAKDOC',
          configuration: {
            ...base.configuration,
            selectedDirectorIds: ['d1'],
            documentPerson: { tag: 'repeat.directors', id: 'd1', name: 'Liang Joo Heong' },
          },
        },
        templateContent: '',
        templateFieldTags: ['repeat.directors', 'director.name'],
        directors,
        perPersonTag: 'repeat.directors',
        documentPeople: [{ id: 'd1', name: 'Liang Joo Heong' }],
        onDocumentPeopleChange,
      })} />);
      expect(screen.getByRole('heading', { name: 'Directors · one document each' })).toBeInTheDocument();
      expect(screen.getByText(/This document is for Liang Joo Heong/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Parties' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /Liang Joo Heong/ })).toBeChecked();
      await user.click(screen.getByRole('checkbox', { name: /Yuly Mirawati/ }));
      expect(onDocumentPeopleChange).toHaveBeenLastCalledWith([
        { id: 'd1', name: 'Liang Joo Heong' },
        { id: 'd2', name: 'Yuly Mirawati' },
      ]);
    });
  });
});

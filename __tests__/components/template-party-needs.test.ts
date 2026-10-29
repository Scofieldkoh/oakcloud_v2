import { describe, expect, it } from 'vitest';
import {
  officersOfRoles,
  pickerTitle,
  repeaterSectionTitle,
  templateContactLists,
  templateOfficerRoles,
  templatePartyNeeds,
} from '@/components/documents/generation-batch/template-party-needs';
import { OAKDOC_TEMPLATE_CONTENT } from '@/lib/document-editor/oakdoc-template';

describe('templatePartyNeeds for Word templates', () => {
  it('asks for the parties the template fields and repeaters use', () => {
    expect(templatePartyNeeds(OAKDOC_TEMPLATE_CONTENT, [
      'selectedContact.name',
      'repeat.contacts',
      'contact.email',
      'custom.fee',
    ])).toEqual({
      director: false,
      directors: false,
      shareholder: false,
      shareholders: false,
      contact: true,
      officers: false,
      contacts: true,
    });
    expect(templatePartyNeeds(OAKDOC_TEMPLATE_CONTENT, ['selectedDirector.name', 'selectedShareholder.name']))
      .toMatchObject({ director: true, shareholder: true, contact: false, contacts: false });
  });

  it('asks for officers when the template repeats them', () => {
    expect(templatePartyNeeds(OAKDOC_TEMPLATE_CONTENT, ['repeat.officers', 'officer.name']))
      .toMatchObject({ officers: true, directors: false });
  });

  it('asks for nothing when a Word template uses only company fields', () => {
    expect(Object.values(templatePartyNeeds(OAKDOC_TEMPLATE_CONTENT, ['company.name'])).some(Boolean)).toBe(false);
  });

  it('asks for officers of the roles an officers repeater is limited to', () => {
    const tags = ['repeat.officers.secretary', 'repeat.officers.auditor', 'officer.name'];
    expect(templatePartyNeeds(OAKDOC_TEMPLATE_CONTENT, tags)).toMatchObject({ officers: true });
    expect(templateOfficerRoles(tags)).toEqual(['SECRETARY', 'AUDITOR']);
    expect(templateOfficerRoles([...tags, 'repeat.officers'])).toBeNull();
    const officers = [{ id: 'a', role: 'SECRETARY' }, { id: 'b', role: 'DIRECTOR' }, { id: 'c', role: 'Auditor' }];
    expect(officersOfRoles(officers, templateOfficerRoles(tags)).map((officer) => officer.id)).toEqual(['a', 'c']);
    expect(officersOfRoles(officers, null)).toHaveLength(3);
  });
});

describe('named repeating sections on Configure', () => {
  const sections = {
    names: {
      'repeat.directors': ['Signers for the resolution(s)'],
      'repeat.officers.secretary': ['Outgoing secretary'],
      'repeat.officers.ceo': ['Incoming CEO', 'Outgoing secretary'],
      'repeat.contacts.corp-sec': ['Corporate secretary to be appointed'],
    },
    shortlists: { 'repeat.contacts.corp-sec': [{ id: 'c1', name: 'Alex Lim' }] },
  };

  it('titles a kind with every name its sections were given', () => {
    expect(repeaterSectionTitle(sections, 'directors')).toBe('Signers for the resolution(s)');
    expect(repeaterSectionTitle(sections, 'officers')).toBe('Outgoing secretary · Incoming CEO');
    expect(repeaterSectionTitle(sections, 'shareholders')).toBeNull();
    expect(repeaterSectionTitle(null, 'directors')).toBeNull();
  });

  it('titles a single-person picker with the names it was given', () => {
    const named = { names: { selectedDirector: ['Signer of the resolution(s)', 'Chairman'] }, shortlists: {} };
    expect(pickerTitle(named, 'selectedDirector')).toBe('Signer of the resolution(s) · Chairman');
    expect(pickerTitle(named, 'selectedShareholder')).toBeNull();
    expect(pickerTitle(null, 'selectedContact')).toBeNull();
    // A picker name is not a repeating section's.
    expect(repeaterSectionTitle(named, 'directors')).toBeNull();
  });

  it('lists the named contacts lists with their names and shortlists', () => {
    expect(templateContactLists(['repeat.contacts', 'repeat.contacts.corp-sec', 'repeat.contacts.auditor'], sections)).toEqual([
      { slug: 'corp-sec', name: 'Corporate secretary to be appointed', shortlist: [{ id: 'c1', name: 'Alex Lim' }] },
      { slug: 'auditor', name: 'Auditor', shortlist: [] },
    ]);
    expect(templateContactLists(['repeat.contacts'], null)).toEqual([]);
  });
});

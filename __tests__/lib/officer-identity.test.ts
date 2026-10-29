import { describe, expect, it } from 'vitest';
import { groupOfficersByPerson, oneOfficerPerPerson, sameOfficerPerson, soleOfficerDefault } from '@/lib/officer-identity';

type Officer = { id: string; contactId?: string | null; identificationNumber?: string | null; name: string; role: string };

const officer = (id: string, name: string, role: string, extra: Partial<Officer> = {}): Officer =>
  ({ id, name, role, contactId: null, identificationNumber: null, ...extra });

describe('officer identity', () => {
  it('matches by contact, then ID number, then name', () => {
    expect(sameOfficerPerson(officer('a', 'Jane Ng', 'DIRECTOR', { contactId: 'c1' }), officer('b', 'J. Ng', 'SECRETARY', { contactId: 'c1' }))).toBe(true);
    // Different contacts are different people, even with one name.
    expect(sameOfficerPerson(officer('a', 'Jane Ng', 'DIRECTOR', { contactId: 'c1' }), officer('b', 'Jane Ng', 'SECRETARY', { contactId: 'c2' }))).toBe(false);
    expect(sameOfficerPerson(
      officer('a', 'Jane Ng', 'DIRECTOR', { contactId: 'c1', identificationNumber: 's1234567a' }),
      officer('b', 'Jane NG', 'SECRETARY', { identificationNumber: 'S 1234567A' }),
    )).toBe(true);
    expect(sameOfficerPerson(
      officer('a', 'Jane Ng', 'DIRECTOR', { identificationNumber: 'S1234567A' }),
      officer('b', 'Jane Ng', 'SECRETARY', { identificationNumber: 'S7654321B' }),
    )).toBe(false);
    expect(sameOfficerPerson(officer('a', ' Jane  Ng ', 'DIRECTOR'), officer('b', 'jane ng', 'SECRETARY'))).toBe(true);
    expect(sameOfficerPerson(officer('a', '', 'DIRECTOR'), officer('b', '', 'SECRETARY'))).toBe(false);
  });

  it('groups appointments by person in first-seen order', () => {
    const officers = [
      officer('d1', 'Jane Ng', 'DIRECTOR', { contactId: 'c1' }),
      officer('d2', 'Sam Lee', 'DIRECTOR'),
      officer('s1', 'Jane Ng', 'SECRETARY', { contactId: 'c1' }),
      officer('s2', 'Jane Ng', 'SECRETARY', { contactId: 'c9' }),
    ];
    expect(groupOfficersByPerson(officers).map((person) => [person.key, person.records.map((record) => record.id)]))
      .toEqual([['d1', ['d1', 's1']], ['d2', ['d2']], ['s2', ['s2']]]);
  });

  it('keeps one ticked record per person, the first, and drops records not offered', () => {
    const officers = [
      officer('d1', 'Jane Ng', 'DIRECTOR', { contactId: 'c1' }),
      officer('s1', 'Jane Ng', 'SECRETARY', { contactId: 'c1' }),
      officer('d2', 'Sam Lee', 'DIRECTOR'),
    ];
    expect(oneOfficerPerPerson(['s1', 'd2', 'd1', 'gone', 'd2'], officers)).toEqual(['s1', 'd2']);
    expect(oneOfficerPerPerson([], officers)).toEqual([]);
  });

  it('ticks the only person offered until something is chosen', () => {
    const secretary = officer('s1', 'Wong Lee Chuin', 'SECRETARY', { identificationNumber: 'S1' });
    const sameAsDirector = officer('d1', 'Wong Lee Chuin', 'DIRECTOR', { identificationNumber: 'S1' });
    expect(soleOfficerDefault(undefined, [secretary])).toEqual(['s1']);
    // One person with two appointments is still one choice.
    expect(soleOfficerDefault(undefined, [secretary, sameAsDirector])).toEqual(['s1']);
    // A choice already made, even none, is kept.
    expect(soleOfficerDefault([], [secretary])).toBeNull();
    expect(soleOfficerDefault(undefined, [secretary, officer('s2', 'Tan Wei Jie', 'SECRETARY')])).toBeNull();
    expect(soleOfficerDefault(undefined, [])).toBeNull();
  });
});

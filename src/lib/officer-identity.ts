/**
 * Officer appointments of one person. A company keeps one officer record per
 * appointment, so a person who is both Director and Secretary has two
 * records; pickers and the Word officers repeater list that person once.
 */
export interface OfficerIdentityFields {
  id: string;
  contactId?: string | null;
  identificationNumber?: string | null;
  name?: string | null;
}

export interface OfficerPerson<T extends OfficerIdentityFields> {
  /** Id of the person's first record, stable while the records are. */
  key: string;
  /** The person's records, in the order given. */
  records: T[];
}

function idNumber(officer: OfficerIdentityFields): string {
  return (officer.identificationNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function personName(officer: OfficerIdentityFields): string {
  return (officer.name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * The same person: the same contact when both records are linked to one,
 * else the same identification number when both have one, else the same name.
 */
export function sameOfficerPerson(a: OfficerIdentityFields, b: OfficerIdentityFields): boolean {
  if (a.contactId && b.contactId) return a.contactId === b.contactId;
  const aId = idNumber(a);
  const bId = idNumber(b);
  if (aId && bId) return aId === bId;
  const aName = personName(a);
  return aName.length > 0 && aName === personName(b);
}

/** Records that name different people outright (different contacts or ID numbers). */
function conflicting(a: OfficerIdentityFields, b: OfficerIdentityFields): boolean {
  if (a.contactId && b.contactId && a.contactId !== b.contactId) return true;
  const aId = idNumber(a);
  const bId = idNumber(b);
  return Boolean(aId && bId && aId !== bId);
}

/** Officer records grouped by person, people and records in first-seen order. */
export function groupOfficersByPerson<T extends OfficerIdentityFields>(officers: readonly T[]): OfficerPerson<T>[] {
  const people: OfficerPerson<T>[] = [];
  for (const officer of officers) {
    const person = people.find(({ records }) =>
      records.some((record) => sameOfficerPerson(record, officer))
      && !records.some((record) => conflicting(record, officer)));
    if (person) person.records.push(officer);
    else people.push({ key: officer.id, records: [officer] });
  }
  return people;
}

/**
 * Ticked officer ids with one record per person: ids of records not offered
 * are dropped, and of two records of one person the first ticked is kept.
 */
export function oneOfficerPerPerson<T extends OfficerIdentityFields>(
  ids: readonly string[],
  officers: readonly T[],
): string[] {
  const personOf = new Map<string, string>();
  for (const person of groupOfficersByPerson(officers)) {
    for (const record of person.records) personOf.set(record.id, person.key);
  }
  const seen = new Set<string>();
  return ids.filter((id) => {
    const person = personOf.get(id);
    if (person === undefined || seen.has(person)) return false;
    seen.add(person);
    return true;
  });
}

/**
 * The officer to tick by default: the only person offered, when nothing has
 * been chosen yet (`saved` undefined). Null when there is nothing to default.
 */
export function soleOfficerDefault<T extends OfficerIdentityFields>(
  saved: readonly string[] | undefined,
  officers: readonly T[],
): string[] | null {
  if (saved !== undefined) return null;
  const people = groupOfficersByPerson(officers);
  return people.length === 1 ? [people[0].records[0].id] : null;
}

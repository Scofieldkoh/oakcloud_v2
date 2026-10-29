const APPOINTMENT_ALIASES: Readonly<Record<string, string>> = {
  DIRECTOR: 'Director',
  MANAGING_DIRECTOR: 'Managing Director',
  CEO: 'CEO',
  CHIEF_EXECUTIVE_OFFICER: 'CEO',
  COO: 'COO',
  CHIEF_OPERATING_OFFICER: 'COO',
  CFO: 'CFO',
  CHIEF_FINANCIAL_OFFICER: 'CFO',
  GENERAL_MANAGER: 'General Manager',
  MANAGER: 'Manager',
  SECRETARY: 'Company Secretary',
  COMPANY_SECRETARY: 'Company Secretary',
  SHAREHOLDER: 'Shareholder',
};

const AUTHORITY_ORDER = new Map([
  ['Director', 0],
  ['Managing Director', 1],
  ['CEO', 2],
  ['COO', 3],
  ['CFO', 4],
  ['General Manager', 5],
  ['Manager', 6],
  ['Company Secretary', 7],
  ['Shareholder', 9],
]);

const ACRONYMS = new Set(['CEO', 'COO', 'CFO', 'CTO', 'CIO']);

function appointmentKey(value: string): string {
  return value.trim().replace(/[\s-]+/g, '_').toUpperCase();
}

export function canonicalAppointment(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const key = appointmentKey(trimmed);
  const aliased = APPOINTMENT_ALIASES[key];
  if (aliased) return aliased;

  return key
    .split('_')
    .map((word) => ACRONYMS.has(word)
      ? word
      : `${word.charAt(0)}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

export function appointmentAuthorityRank(value: string | null | undefined): number {
  const appointment = value ? canonicalAppointment(value) : null;
  return appointment ? (AUTHORITY_ORDER.get(appointment) ?? 8) : 8;
}

export function rankAppointments(values: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const appointment = canonicalAppointment(value);
    if (appointment) byKey.set(appointment.toLocaleLowerCase(), appointment);
  }

  return [...byKey.values()].sort((left, right) => {
    const authorityDifference = appointmentAuthorityRank(left) - appointmentAuthorityRank(right);
    return authorityDifference || left.localeCompare(right);
  });
}

export function insertRepresentativeByAuthority(
  currentIds: readonly string[],
  newId: string,
  roles: Readonly<Record<string, string | null | undefined>>,
): string[] {
  if (currentIds.includes(newId)) return [...currentIds];

  const newRank = appointmentAuthorityRank(roles[newId]);
  const insertionIndex = currentIds.findIndex(
    (id) => appointmentAuthorityRank(roles[id]) > newRank,
  );

  if (insertionIndex < 0) return [...currentIds, newId];
  return [
    ...currentIds.slice(0, insertionIndex),
    newId,
    ...currentIds.slice(insertionIndex),
  ];
}

export function moveRepresentative(
  currentIds: readonly string[],
  contactId: string,
  direction: 'up' | 'down',
): string[] {
  const currentIndex = currentIds.indexOf(contactId);
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentIds.length) {
    return [...currentIds];
  }

  const nextIds = [...currentIds];
  [nextIds[currentIndex], nextIds[targetIndex]] = [
    nextIds[targetIndex],
    nextIds[currentIndex],
  ];
  return nextIds;
}

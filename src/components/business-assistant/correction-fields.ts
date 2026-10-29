import { BIZFILE_CORRECTION_FINDING_CODES, BIZFILE_CORRECTION_SOURCE_PATHS } from '@/lib/bizfile-correction-contract';

export { BIZFILE_CORRECTION_FINDING_CODES };

export const BIZFILE_CORRECTION_FIELDS = [
  { path: 'entityDetails.name', label: 'Company name', group: 'Entity details' },
  { path: 'entityDetails.displayAlias', label: 'Display alias', group: 'Entity details' },
  { path: 'entityDetails.formerName', label: 'Former name', group: 'Entity details' },
  { path: 'entityDetails.dateOfNameChange', label: 'Date of name change', group: 'Entity details' },
  { path: 'entityDetails.entityType', label: 'Entity type', group: 'Entity details' },
  { path: 'entityDetails.status', label: 'Entity status', group: 'Entity details' },
  { path: 'entityDetails.statusDate', label: 'Status date', group: 'Entity details' },
  { path: 'entityDetails.incorporationDate', label: 'Incorporation date', group: 'Entity details' },
  { path: 'entityDetails.registrationDate', label: 'Registration date', group: 'Entity details' },
  { path: 'ssicActivities.primary.code', label: 'Primary SSIC code', group: 'SSIC activities' },
  { path: 'ssicActivities.primary.description', label: 'Primary SSIC description', group: 'SSIC activities' },
  { path: 'ssicActivities.secondary.code', label: 'Secondary SSIC code', group: 'SSIC activities' },
  { path: 'ssicActivities.secondary.description', label: 'Secondary SSIC description', group: 'SSIC activities' },
  { path: 'financialYear.endDay', label: 'Financial year end day', group: 'Financial year and compliance' },
  { path: 'financialYear.endMonth', label: 'Financial year end month', group: 'Financial year and compliance' },
  { path: 'compliance.lastAgmDate', label: 'Last AGM date', group: 'Financial year and compliance' },
  { path: 'compliance.lastArFiledDate', label: 'Last annual return filed date', group: 'Financial year and compliance' },
  { path: 'compliance.accountsDueDate', label: 'Accounts due date', group: 'Financial year and compliance' },
  { path: 'compliance.fyeAsAtLastAr', label: 'FYE as at last annual return', group: 'Financial year and compliance' },
  { path: 'homeCurrency', label: 'Home currency', group: 'Capital and currency' },
  { path: 'paidUpCapital', label: 'Paid-up capital', group: 'Capital and currency' },
  { path: 'issuedCapital', label: 'Issued capital', group: 'Capital and currency' },
  { path: 'treasuryShares', label: 'Treasury shares', group: 'Capital and currency' },
  { path: 'addresses.registered', label: 'Registered address', group: 'Addresses and auditor' },
  { path: 'addresses.mailing', label: 'Mailing address', group: 'Addresses and auditor' },
  { path: 'auditor', label: 'Auditor', group: 'Addresses and auditor' },
] as const;

const allowedFindingCodes = new Set<string>(BIZFILE_CORRECTION_FINDING_CODES);
const fieldByPath = new Map<string, (typeof BIZFILE_CORRECTION_FIELDS)[number]>(BIZFILE_CORRECTION_FIELDS.map((field) => [field.path, field]));
const correctionPaths = new Set<string>(Object.keys(BIZFILE_CORRECTION_SOURCE_PATHS));

export interface EligibleBizFileCorrectionFinding {
  id: string;
  code: string;
  path: string;
  changeId: string;
  label: string;
  group: string;
  message?: string;
  expected: unknown;
  actual?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function eligibleBizFileCorrectionFindings(value: unknown): EligibleBizFileCorrectionFinding[] {
  if (!Array.isArray(value)) return [];
  const seenPaths = new Set<string>();
  const eligible: EligibleBizFileCorrectionFinding[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.code !== 'string'
      || typeof candidate.path !== 'string' || typeof candidate.changeId !== 'string'
      || !allowedFindingCodes.has(candidate.code) || candidate.expected === undefined) continue;
    const field = fieldByPath.get(candidate.path);
    if (!field || !correctionPaths.has(candidate.path) || seenPaths.has(candidate.path)) continue;
    seenPaths.add(candidate.path);
    eligible.push({
      id: candidate.id,
      code: candidate.code,
      path: candidate.path,
      changeId: candidate.changeId,
      label: field.label,
      group: field.group,
      ...(typeof candidate.message === 'string' ? { message: candidate.message } : {}),
      expected: candidate.expected,
      ...(Object.prototype.hasOwnProperty.call(candidate, 'actual') ? { actual: candidate.actual } : {}),
    });
  }
  return eligible;
}

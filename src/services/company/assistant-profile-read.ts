import { prisma } from '@/lib/prisma';
import { evaluateFreshAuthorization } from '@/lib/fresh-authorization';

export interface CompanyAssistantReadActor {
  tenantId: string;
  userId: string;
}

export interface CompanyAssistantIdentity {
  id: string;
  name: string;
  uen: string;
  displayAlias: string | null;
}

export interface CompanyAssistantOfficer {
  name: string;
  role: string;
  appointmentDate: string | null;
  cessationDate: string | null;
  isCurrent: boolean;
}

export interface CompanyAssistantShareholder {
  name: string;
  shareholderType: string | null;
  shareClass: string | null;
  numberOfShares: number;
  percentageHeld: string | null;
  currency: string | null;
  allotmentDate: string | null;
  isCurrent: boolean;
}

export interface CompanyAssistantCharge {
  chargeNumber: string | null;
  chargeType: string | null;
  chargeHolderName: string;
  registrationDate: string | null;
  isFullyDischarged: boolean;
}

export interface CompanyAssistantProfileSnapshot extends CompanyAssistantIdentity {
  entityType: string;
  status: string;
  statusDate: string | null;
  incorporationDate: string | null;
  financialYearEndDay: number | null;
  financialYearEndMonth: number | null;
  registeredAddress: {
    fullAddress: string;
    effectiveFrom: string | null;
  } | null;
  officers: CompanyAssistantOfficer[];
  shareholders: CompanyAssistantShareholder[];
  auditor: {
    name: string;
    appointmentDate: string | null;
  } | null;
  activeCharges: CompanyAssistantCharge[];
  gst: {
    registered: boolean;
    registrationNumber: string | null;
    registrationDate: string | null;
  };
}

export type CompanyAssistantIdentityResult =
  | { kind: 'FOUND'; company: CompanyAssistantIdentity }
  | { kind: 'UNAVAILABLE' };

export type CompanyAssistantProfileResult =
  | { kind: 'FOUND'; company: CompanyAssistantProfileSnapshot }
  | { kind: 'UNAVAILABLE' };

export type CompanyAssistantResolutionResult =
  | { kind: 'FOUND'; company: CompanyAssistantIdentity }
  | { kind: 'NONE' }
  | { kind: 'AMBIGUOUS' };

function date(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

async function canReadCompany(actor: CompanyAssistantReadActor, companyId: string): Promise<boolean> {
  try {
    const decision = await evaluateFreshAuthorization({
      userId: actor.userId,
      workspaceId: actor.tenantId,
      permission: { resource: 'company', action: 'read' },
      resource: { kind: 'company', id: companyId },
    });
    return decision.allowed;
  } catch {
    return false;
  }
}

export async function readAuthorizedCompanyAssistantIdentity(
  actor: CompanyAssistantReadActor,
  companyId: string,
): Promise<CompanyAssistantIdentityResult> {
  if (!(await canReadCompany(actor, companyId))) return { kind: 'UNAVAILABLE' };
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, name: true, uen: true, displayAlias: true },
  });
  if (!company) return { kind: 'UNAVAILABLE' };
  return {
    kind: 'FOUND',
    company: {
      id: company.id,
      name: company.name,
      uen: company.uen,
      displayAlias: company.displayAlias,
    },
  };
}

export async function readAuthorizedCompanyAssistantProfile(
  actor: CompanyAssistantReadActor,
  companyId: string,
): Promise<CompanyAssistantProfileResult> {
  if (!(await canReadCompany(actor, companyId))) return { kind: 'UNAVAILABLE' };
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId: actor.tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      uen: true,
      displayAlias: true,
      entityType: true,
      status: true,
      statusDate: true,
      incorporationDate: true,
      financialYearEndDay: true,
      financialYearEndMonth: true,
      isGstRegistered: true,
      gstRegistrationNumber: true,
      gstRegistrationDate: true,
      addresses: {
        where: { addressType: 'REGISTERED_OFFICE', isCurrent: true },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
        take: 1,
        select: { fullAddress: true, effectiveFrom: true },
      },
      officers: {
        where: { isCurrent: true },
        orderBy: [{ appointmentDate: 'asc' }, { name: 'asc' }],
        select: {
          name: true,
          role: true,
          appointmentDate: true,
          cessationDate: true,
          isCurrent: true,
        },
      },
      shareholders: {
        where: { isCurrent: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          name: true,
          shareholderType: true,
          shareClass: true,
          numberOfShares: true,
          percentageHeld: true,
          currency: true,
          allotmentDate: true,
          isCurrent: true,
        },
      },
      auditor: {
        select: { name: true, appointmentDate: true },
      },
      charges: {
        where: { isFullyDischarged: false },
        orderBy: [{ registrationDate: 'desc' }, { id: 'asc' }],
        select: {
          chargeNumber: true,
          chargeType: true,
          chargeHolderName: true,
          registrationDate: true,
          isFullyDischarged: true,
        },
      },
    },
  });
  if (!company) return { kind: 'UNAVAILABLE' };

  const registeredAddress = company.addresses.find((address) => Boolean(address.fullAddress));
  return {
    kind: 'FOUND',
    company: {
      id: company.id,
      name: company.name,
      uen: company.uen,
      displayAlias: company.displayAlias,
      entityType: company.entityType,
      status: company.status,
      statusDate: date(company.statusDate),
      incorporationDate: date(company.incorporationDate),
      financialYearEndDay: company.financialYearEndDay,
      financialYearEndMonth: company.financialYearEndMonth,
      registeredAddress: registeredAddress
        ? { fullAddress: registeredAddress.fullAddress, effectiveFrom: date(registeredAddress.effectiveFrom) }
        : null,
      officers: company.officers
        .filter((officer) => officer.isCurrent)
        .map((officer) => ({
          name: officer.name,
          role: officer.role,
          appointmentDate: date(officer.appointmentDate),
          cessationDate: date(officer.cessationDate),
          isCurrent: true,
        })),
      shareholders: company.shareholders
        .filter((shareholder) => shareholder.isCurrent)
        .map((shareholder) => ({
          name: shareholder.name,
          shareholderType: shareholder.shareholderType,
          shareClass: shareholder.shareClass,
          numberOfShares: shareholder.numberOfShares,
          percentageHeld: shareholder.percentageHeld == null ? null : shareholder.percentageHeld.toString(),
          currency: shareholder.currency,
          allotmentDate: date(shareholder.allotmentDate),
          isCurrent: true,
        })),
      auditor: company.auditor
        ? { name: company.auditor.name, appointmentDate: date(company.auditor.appointmentDate) }
        : null,
      activeCharges: company.charges
        .filter((charge) => !charge.isFullyDischarged)
        .map((charge) => ({
          chargeNumber: charge.chargeNumber,
          chargeType: charge.chargeType,
          chargeHolderName: charge.chargeHolderName,
          registrationDate: date(charge.registrationDate),
          isFullyDischarged: false,
        })),
      gst: {
        registered: company.isGstRegistered,
        registrationNumber: company.isGstRegistered ? company.gstRegistrationNumber : null,
        registrationDate: company.isGstRegistered ? date(company.gstRegistrationDate) : null,
      },
    },
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractUenCandidate(message: string): string | null {
  const tokens = message.toUpperCase().match(/\b[A-Z0-9]{8,20}\b/g) ?? [];
  return tokens.find((token) => /\d/.test(token)) ?? null;
}

const COMPANY_LOOKUP_STOP_WORDS = new Set([
  'a', 'about', 'active', 'address', 'are', 'audit', 'auditor', 'charges', 'charge', 'company',
  'current', 'date', 'director', 'directors', 'does', 'end', 'financial', 'for', 'fye', 'gst',
  'has', 'inc', 'incorporated', 'incorporation', 'is', 'limited', 'llc', 'llp', 'ltd', 'me', 'of',
  'office', 'officer', 'officers', 'on', 'please', 'private', 'pte', 'registered', 'registration',
  'shareholder', 'shareholders', 'status', 'tell', 'the', 'this', 'what', 'when', 'who', 'year',
]);

function extractNameCandidate(message: string): string | null {
  const quoted = message.match(/["“']([^"”']{2,160})["”']/)?.[1]?.trim();
  if (quoted) return quoted;
  const tokens = normalizeSearchText(message)
    .split(' ')
    .filter((token) => token && !COMPANY_LOOKUP_STOP_WORDS.has(token));
  const value = tokens.join(' ').trim();
  return value.length >= 2 ? value : null;
}

async function filterAuthorizedIdentities(
  actor: CompanyAssistantReadActor,
  companies: readonly CompanyAssistantIdentity[],
): Promise<CompanyAssistantIdentity[]> {
  const authorized: CompanyAssistantIdentity[] = [];
  for (const company of companies) {
    if (await canReadCompany(actor, company.id)) authorized.push(company);
  }
  return authorized;
}

async function searchCompanyIdentities(
  actor: CompanyAssistantReadActor,
  mode: 'EXACT' | 'CONTAINS',
  uen: string | null,
  name: string | null,
): Promise<CompanyAssistantIdentity[]> {
  const or = [];
  if (uen) or.push({ uen: { equals: uen, mode: 'insensitive' as const } });
  if (name) {
    const comparator = mode === 'EXACT'
      ? { equals: name, mode: 'insensitive' as const }
      : { contains: name, mode: 'insensitive' as const };
    or.push({ name: comparator }, { displayAlias: comparator });
  }
  if (or.length === 0) return [];
  const rows = await prisma.company.findMany({
    where: { tenantId: actor.tenantId, deletedAt: null, OR: or },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 20,
    select: { id: true, name: true, uen: true, displayAlias: true },
  });
  return filterAuthorizedIdentities(actor, rows);
}

export async function resolveAuthorizedCompanyFromAssistantMessage(
  actor: CompanyAssistantReadActor,
  message: string,
): Promise<CompanyAssistantResolutionResult> {
  const uen = extractUenCandidate(message);
  if (uen) {
    const byUen = await searchCompanyIdentities(actor, 'EXACT', uen, null);
    if (byUen.length === 1) return { kind: 'FOUND', company: byUen[0] };
    if (byUen.length > 1) return { kind: 'AMBIGUOUS' };
  }

  const name = extractNameCandidate(message);
  if (!name || name.length < 3) return { kind: 'NONE' };
  const exact = await searchCompanyIdentities(actor, 'EXACT', null, name);
  if (exact.length === 1) return { kind: 'FOUND', company: exact[0] };
  if (exact.length > 1) return { kind: 'AMBIGUOUS' };
  const broad = await searchCompanyIdentities(actor, 'CONTAINS', null, name);
  if (broad.length === 1) return { kind: 'FOUND', company: broad[0] };
  return broad.length > 1 ? { kind: 'AMBIGUOUS' } : { kind: 'NONE' };
}

export function messageStronglyIdentifiesCompany(message: string, company: CompanyAssistantIdentity): boolean {
  const normalizedMessage = ` ${normalizeSearchText(message)} `;
  const normalizedName = normalizeSearchText(company.name);
  const normalizedAlias = company.displayAlias ? normalizeSearchText(company.displayAlias) : '';
  if (company.uen && message.toUpperCase().includes(company.uen.toUpperCase())) return true;
  if (normalizedName.length >= 3 && normalizedMessage.includes(` ${normalizedName} `)) return true;
  return normalizedAlias.length >= 3 && normalizedMessage.includes(` ${normalizedAlias} `);
}

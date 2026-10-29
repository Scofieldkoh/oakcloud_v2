import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import {
  computeSectionVersion,
  type CompanyProfileSectionId,
} from '@/lib/company-profile-sections';
import { buildFullAddress } from '@/services/bizfile/normalizer';
import {
  companyProfileSectionSchemas,
  type CompanyProfileSectionData,
} from '@/lib/validations/company-profile';
import { normalizeCompanyAlias } from '@/lib/company-display-label';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation';
import { saveFirstFinancialPeriod } from '@/services/compliance-monitoring/financial-periods';
import { ValidationError } from '@/lib/errors';
import type { DateOnly } from '@/services/service-schedule';
import { normalYearOfAssessment } from '@/services/service-schedule/obligation-periods';

const profileCompanyArgs = {
  include: {
    addresses: { orderBy: { createdAt: 'asc' } },
    formerNames: { orderBy: { effectiveFrom: 'asc' } },
    officers: { orderBy: { appointmentDate: 'asc' } },
    shareholders: { orderBy: { createdAt: 'asc' } },
    shareCapital: { orderBy: { createdAt: 'asc' } },
    charges: { orderBy: { registrationDate: 'asc' } },
    auditor: true,
    financialPeriods: { where: { provenance: 'CONFIRMED' }, orderBy: { periodEnd: 'asc' }, take: 1 },
  },
} satisfies Prisma.CompanyDefaultArgs;
type ProfileCompany = Prisma.CompanyGetPayload<typeof profileCompanyArgs>;
type Tx = Prisma.TransactionClient;

export interface CompanyProfileSectionDto<T = CompanyProfileSectionData> {
  section: CompanyProfileSectionId;
  version: string;
  data: T;
}

export interface SaveCompanyProfileSectionArgs<T = unknown> {
  companyId: string;
  tenantId: string;
  userId: string;
  section: CompanyProfileSectionId;
  ifMatchVersion: string;
  data: T;
  reason?: string;
}

export class CompanyProfileConflictError<T = CompanyProfileSectionData> extends Error {
  readonly code = 'COMPANY_PROFILE_CONFLICT';
  constructor(public readonly latest: CompanyProfileSectionDto<T>) {
    super('This section changed after you opened it');
  }
}

export class CompanyProfileNotFoundError extends Error {
  readonly code = 'COMPANY_PROFILE_NOT_FOUND';
}

function date(value: Date | null | undefined): string | null {
  return value ? value.toISOString().split('T')[0] : null;
}

function dateOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function profileDateKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function profileScheduleSourceChanged(
  section: CompanyProfileSectionId,
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  if (section === 'identity') {
    return next.entityType !== current.entityType
      || profileDateKey(next.incorporationDate) !== profileDateKey(current.incorporationDate);
  }
  if (section === 'compliance') {
    return next.financialYearEndDay !== current.financialYearEndDay
      || next.financialYearEndMonth !== current.financialYearEndMonth
      || profileDateKey(next.accountsDueDate) !== profileDateKey(current.accountsDueDate)
      || firstPeriodChanged(current, next);
  }
  return false;
}

function hasFirstPeriodInput(data: Record<string, unknown>): boolean {
  return data.firstFinancialYearEndDate !== undefined;
}

function firstPeriodChanged(current: Record<string, unknown>, next: Record<string, unknown>): boolean {
  if (!hasFirstPeriodInput(next)) return false;
  return profileDateKey(next.firstFinancialYearEndDate) !== profileDateKey(current.firstFinancialYearEndDate);
}

function selectSection(company: ProfileCompany, section: CompanyProfileSectionId): CompanyProfileSectionData {
  switch (section) {
    case 'identity': return {
      uen: company.uen,
      name: company.name,
      displayAlias: normalizeCompanyAlias(company.displayAlias),
      entityType: company.entityType,
      status: company.status,
      statusDate: date(company.statusDate),
      incorporationDate: date(company.incorporationDate),
    };
    case 'addresses': {
      const mapAddress = (type: 'REGISTERED_OFFICE' | 'MAILING') => {
        const address = company.addresses.find((item) => item.addressType === type && item.isCurrent);
        return address ? {
          block: address.block,
          streetName: address.streetName,
          level: address.level,
          unit: address.unit,
          buildingName: address.buildingName,
          postalCode: address.postalCode,
          country: address.country,
          ...(type === 'REGISTERED_OFFICE' ? { effectiveFrom: date(address.effectiveFrom) } : {}),
        } : null;
      };
      return { registered: mapAddress('REGISTERED_OFFICE'), mailing: mapAddress('MAILING') };
    }
    case 'activities': return {
      primary: company.primarySsicCode || company.primarySsicDescription
        ? { code: company.primarySsicCode ?? '', description: company.primarySsicDescription ?? '' }
        : null,
      secondary: company.secondarySsicCode || company.secondarySsicDescription
        ? { code: company.secondarySsicCode ?? '', description: company.secondarySsicDescription ?? '' }
        : null,
    };
    case 'officers': return { officers: company.officers.map((officer) => ({
      id: officer.id,
      contactId: officer.contactId,
      name: officer.name,
      role: officer.role,
      identificationType: officer.identificationType,
      identificationNumber: officer.identificationNumber,
      nationality: officer.nationality,
      address: officer.address,
      appointmentDate: date(officer.appointmentDate),
      cessationDate: date(officer.cessationDate),
      isCurrent: officer.isCurrent,
    })) };
    case 'shareholders': return { shareholders: company.shareholders.map((shareholder) => ({
      id: shareholder.id,
      contactId: shareholder.contactId,
      name: shareholder.name,
      shareholderType: shareholder.shareholderType,
      isNominee: shareholder.isNominee,
      identificationType: shareholder.identificationType,
      identificationNumber: shareholder.identificationNumber,
      nationality: shareholder.nationality,
      placeOfOrigin: shareholder.placeOfOrigin,
      address: shareholder.address,
      shareClass: shareholder.shareClass,
      numberOfShares: shareholder.numberOfShares,
      percentageHeld: shareholder.percentageHeld == null ? null : Number(shareholder.percentageHeld),
      currency: shareholder.currency,
      isCurrent: shareholder.isCurrent,
    })) };
    case 'compliance': return {
      financialYearEndDay: company.financialYearEndDay,
      financialYearEndMonth: company.financialYearEndMonth,
      fyeAsAtLastAr: date(company.fyeAsAtLastAr),
      homeCurrency: company.homeCurrency,
      lastAgmDate: date(company.lastAgmDate),
      lastArFiledDate: date(company.lastArFiledDate),
      accountsDueDate: date(company.accountsDueDate),
      firstFinancialYearEndDate: date(company.financialPeriods[0]?.periodEnd),
    };
    case 'capital': return {
      paidUpCapitalCurrency: company.paidUpCapitalCurrency,
      paidUpCapitalAmount: company.paidUpCapitalAmount == null ? null : Number(company.paidUpCapitalAmount),
      issuedCapitalCurrency: company.issuedCapitalCurrency,
      issuedCapitalAmount: company.issuedCapitalAmount == null ? null : Number(company.issuedCapitalAmount),
      shareCapital: company.shareCapital.map((capital) => ({
        id: capital.id,
        shareClass: capital.shareClass,
        currency: capital.currency,
        numberOfShares: capital.numberOfShares,
        parValue: capital.parValue == null ? null : Number(capital.parValue),
        totalValue: Number(capital.totalValue),
        isPaidUp: capital.isPaidUp,
        isTreasury: capital.isTreasury,
      })),
    };
    case 'charges': return { charges: company.charges.map((charge) => ({
      id: charge.id,
      chargeNumber: charge.chargeNumber,
      chargeType: charge.chargeType,
      description: charge.description,
      chargeHolderName: charge.chargeHolderName,
      amountSecured: charge.amountSecured == null ? null : Number(charge.amountSecured),
      amountSecuredText: charge.amountSecuredText,
      currency: charge.currency,
      registrationDate: date(charge.registrationDate),
      dischargeDate: date(charge.dischargeDate),
      isFullyDischarged: charge.isFullyDischarged,
    })) };
    case 'additional': return {
      formerName: company.formerName,
      dateOfNameChange: date(company.dateOfNameChange),
      registrationDate: date(company.registrationDate),
      formerNames: company.formerNames.map((record) => ({
        id: record.id,
        formerName: record.formerName,
        effectiveFrom: date(record.effectiveFrom)!,
        effectiveTo: date(record.effectiveTo),
      })),
      auditor: company.auditor ? {
        name: company.auditor.name,
        address: company.auditor.address,
        appointmentDate: date(company.auditor.appointmentDate),
      } : null,
    };
  }
}

async function readCompany(
  companyId: string,
  tenantId: string,
  db: Pick<Tx, 'company'> | typeof prisma,
): Promise<ProfileCompany> {
  const company = await db.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
    ...profileCompanyArgs,
  });
  if (!company) throw new CompanyProfileNotFoundError('Company not found');
  return company as ProfileCompany;
}

export async function getCompanyProfileSection<T = CompanyProfileSectionData>(
  companyId: string,
  tenantId: string,
  section: CompanyProfileSectionId,
  db: Pick<Tx, 'company'> | typeof prisma = prisma,
): Promise<CompanyProfileSectionDto<T>> {
  const data = selectSection(await readCompany(companyId, tenantId, db), section) as T;
  return { section, version: computeSectionVersion(data), data };
}

async function replaceAddress(
  tx: Tx,
  companyId: string,
  type: 'REGISTERED_OFFICE' | 'MAILING',
  input: Record<string, unknown> | null,
) {
  const current = await tx.companyAddress.findFirst({
    where: { companyId, addressType: type, isCurrent: true },
    select: { id: true },
  });
  if (!input) {
    if (current) await tx.companyAddress.deleteMany({ where: { id: current.id } });
    return;
  }
  const address = input as {
    block?: string | null; streetName: string; level?: string | null; unit?: string | null;
    buildingName?: string | null; postalCode: string; country: string; effectiveFrom?: string | null;
  };
  const values = {
    block: address.block ?? null,
    streetName: address.streetName,
    level: address.level ?? null,
    unit: address.unit ?? null,
    buildingName: address.buildingName ?? null,
    postalCode: address.postalCode,
    country: address.country,
    fullAddress: buildFullAddress({
      block: address.block ?? undefined,
      streetName: address.streetName,
      level: address.level ?? undefined,
      unit: address.unit ?? undefined,
      buildingName: address.buildingName ?? undefined,
      postalCode: address.postalCode,
    }),
    effectiveFrom: dateOrNull(address.effectiveFrom),
    effectiveTo: null,
    isCurrent: true,
  };
  if (current) await tx.companyAddress.update({ where: { id: current.id }, data: values });
  else await tx.companyAddress.create({ data: { companyId, addressType: type, ...values } });
}

async function assertContactLinksBelongToCompany(tx: Tx, companyId: string, contactIds: Array<string | null | undefined>) {
  const ids = [...new Set(contactIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
  if (!company) throw new CompanyProfileNotFoundError('Company not found');
  const count = await tx.contact.count({ where: { id: { in: ids }, tenantId: company.tenantId, deletedAt: null } });
  if (count !== ids.length) throw new Error('One or more selected contacts are not available for this company');
}

export async function mutateCompanyProfileSection(tx: Tx, companyId: string, section: CompanyProfileSectionId, rawData: unknown) {
  switch (section) {
    case 'identity': {
      const data = companyProfileSectionSchemas.identity.parse(rawData);
      await tx.company.update({ where: { id: companyId }, data: {
        uen: data.uen, name: data.name, entityType: data.entityType, status: data.status,
        statusDate: dateOrNull(data.statusDate), incorporationDate: dateOrNull(data.incorporationDate),
        ...(Object.prototype.hasOwnProperty.call(data, 'displayAlias')
          ? { displayAlias: normalizeCompanyAlias(data.displayAlias) }
          : {}),
      } });
      // The first financial period always starts at incorporation.
      if (data.incorporationDate) {
        const incorporation = dateOrNull(data.incorporationDate)!;
        const first = await tx.companyFinancialPeriod.findFirst({
          where: { companyId, provenance: 'CONFIRMED' },
          orderBy: { periodEnd: 'asc' },
          select: { id: true, periodEnd: true },
        });
        if (first && first.periodEnd > incorporation) {
          await tx.companyFinancialPeriod.update({ where: { id: first.id }, data: { periodStart: incorporation } });
        }
      }
      break;
    }
    case 'addresses': {
      const data = companyProfileSectionSchemas.addresses.parse(rawData);
      await replaceAddress(tx, companyId, 'REGISTERED_OFFICE', data.registered);
      await replaceAddress(tx, companyId, 'MAILING', data.mailing);
      break;
    }
    case 'activities': {
      const data = companyProfileSectionSchemas.activities.parse(rawData);
      await tx.company.update({ where: { id: companyId }, data: {
        primarySsicCode: data.primary?.code ?? null,
        primarySsicDescription: data.primary?.description ?? null,
        secondarySsicCode: data.secondary?.code ?? null,
        secondarySsicDescription: data.secondary?.description ?? null,
      } });
      break;
    }
    case 'compliance': {
      const data = companyProfileSectionSchemas.compliance.parse(rawData);
      await tx.company.update({ where: { id: companyId }, data: {
        financialYearEndDay: data.financialYearEndDay,
        financialYearEndMonth: data.financialYearEndMonth,
        fyeAsAtLastAr: dateOrNull(data.fyeAsAtLastAr),
        homeCurrency: data.homeCurrency,
        lastAgmDate: dateOrNull(data.lastAgmDate),
        lastArFiledDate: dateOrNull(data.lastArFiledDate),
        accountsDueDate: dateOrNull(data.accountsDueDate),
      } });
      if (hasFirstPeriodInput(data)) {
        const firstFye = data.firstFinancialYearEndDate ?? null;
        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { tenantId: true, incorporationDate: true },
        });
        const incorporation = date(company.incorporationDate);
        if (firstFye && !incorporation) {
          throw new ValidationError('Record the incorporation date before the first financial year end.');
        }
        await saveFirstFinancialPeriod(tx, { tenantId: company.tenantId, companyId, userId: null }, firstFye ? {
          periodStart: incorporation as DateOnly,
          periodEnd: firstFye as DateOnly,
          yearOfAssessment: normalYearOfAssessment(firstFye as DateOnly),
        } : null);
      }
      break;
    }
    case 'officers': {
      const data = companyProfileSectionSchemas.officers.parse(rawData);
      await assertContactLinksBelongToCompany(tx, companyId, data.officers.map((officer) => officer.contactId));
      await tx.companyOfficer.deleteMany({ where: { companyId } });
      for (const officer of data.officers) await tx.companyOfficer.create({ data: {
        companyId, contactId: officer.contactId ?? null, name: officer.name, role: officer.role,
        identificationType: officer.identificationType, identificationNumber: officer.identificationNumber,
        nationality: officer.nationality, address: officer.address,
        appointmentDate: dateOrNull(officer.appointmentDate), cessationDate: dateOrNull(officer.cessationDate),
        // An officer is active as long as there is no cessation date.
        isCurrent: !officer.cessationDate,
      } });
      await tx.company.update({ where: { id: companyId }, data: { currentOfficerCount: data.officers.filter((item) => !item.cessationDate).length } });
      break;
    }
    case 'shareholders': {
      const data = companyProfileSectionSchemas.shareholders.parse(rawData);
      await assertContactLinksBelongToCompany(tx, companyId, data.shareholders.map((shareholder) => shareholder.contactId));
      await tx.companyShareholder.deleteMany({ where: { companyId } });
      for (const shareholder of data.shareholders) await tx.companyShareholder.create({ data: {
        companyId, contactId: shareholder.contactId ?? null, name: shareholder.name, shareholderType: shareholder.shareholderType,
        isNominee: shareholder.isNominee ?? false,
        identificationType: shareholder.identificationType, identificationNumber: shareholder.identificationNumber,
        nationality: shareholder.nationality, placeOfOrigin: shareholder.placeOfOrigin, address: shareholder.address,
        shareClass: shareholder.shareClass, numberOfShares: shareholder.numberOfShares,
        percentageHeld: shareholder.percentageHeld, currency: shareholder.currency,
        isCurrent: shareholder.isCurrent ?? true,
      } });
      await tx.company.update({ where: { id: companyId }, data: { currentShareholderCount: data.shareholders.filter((item) => item.isCurrent ?? true).length } });
      break;
    }
    case 'capital': {
      const data = companyProfileSectionSchemas.capital.parse(rawData);
      await tx.company.update({ where: { id: companyId }, data: {
        paidUpCapitalCurrency: data.paidUpCapitalCurrency, paidUpCapitalAmount: data.paidUpCapitalAmount,
        issuedCapitalCurrency: data.issuedCapitalCurrency, issuedCapitalAmount: data.issuedCapitalAmount,
      } });
      await tx.shareCapital.deleteMany({ where: { companyId } });
      for (const capital of data.shareCapital) await tx.shareCapital.create({ data: {
        companyId, shareClass: capital.shareClass, currency: capital.currency,
        numberOfShares: capital.numberOfShares, parValue: capital.parValue,
        totalValue: capital.totalValue, isPaidUp: capital.isPaidUp, isTreasury: capital.isTreasury,
      } });
      break;
    }
    case 'charges': {
      const data = companyProfileSectionSchemas.charges.parse(rawData);
      await tx.companyCharge.deleteMany({ where: { companyId } });
      for (const charge of data.charges) await tx.companyCharge.create({ data: {
        companyId, chargeNumber: charge.chargeNumber, chargeType: charge.chargeType,
        description: charge.description, chargeHolderName: charge.chargeHolderName,
        amountSecured: charge.amountSecured, amountSecuredText: charge.amountSecuredText,
        currency: charge.currency, registrationDate: dateOrNull(charge.registrationDate),
        dischargeDate: dateOrNull(charge.dischargeDate),
        isFullyDischarged: charge.isFullyDischarged ?? Boolean(charge.dischargeDate),
      } });
      await tx.company.update({ where: { id: companyId }, data: {
        hasCharges: data.charges.some((item) => !(item.isFullyDischarged ?? item.dischargeDate)),
        activeChargeCount: data.charges.filter((item) => !(item.isFullyDischarged ?? item.dischargeDate)).length,
      } });
      break;
    }
    case 'additional': {
      const data = companyProfileSectionSchemas.additional.parse(rawData);
      await tx.company.update({ where: { id: companyId }, data: {
        formerName: data.formerName, dateOfNameChange: dateOrNull(data.dateOfNameChange),
        registrationDate: dateOrNull(data.registrationDate),
      } });
      await tx.companyFormerName.deleteMany({ where: { companyId } });
      for (const record of data.formerNames) await tx.companyFormerName.create({ data: {
        companyId, formerName: record.formerName, effectiveFrom: dateOrNull(record.effectiveFrom)!, effectiveTo: dateOrNull(record.effectiveTo),
      } });
      if (data.auditor) await tx.companyAuditor.upsert({ where: { companyId }, create: {
        companyId, name: data.auditor.name, address: data.auditor.address,
        appointmentDate: dateOrNull(data.auditor.appointmentDate),
      }, update: {
        name: data.auditor.name, address: data.auditor.address,
        appointmentDate: dateOrNull(data.auditor.appointmentDate),
      } });
      else await tx.companyAuditor.deleteMany({ where: { companyId } });
      break;
    }
  }
}

export async function saveCompanyProfileSection<T = CompanyProfileSectionData>(
  args: SaveCompanyProfileSectionArgs<T>,
): Promise<CompanyProfileSectionDto<T>> {
  return prisma.$transaction(async (tx) => {
    const current = await getCompanyProfileSection<T>(args.companyId, args.tenantId, args.section, tx);
    if (current.version !== args.ifMatchVersion) throw new CompanyProfileConflictError(current);
    const parsedData = companyProfileSectionSchemas[args.section].parse(args.data) as Record<string, unknown>;
    await mutateCompanyProfileSection(tx, args.companyId, args.section, parsedData);
    if (profileScheduleSourceChanged(
      args.section,
      current.data as Record<string, unknown>,
      parsedData,
    )) {
      await enqueueScheduleReconciliation(tx, {
        tenantId: args.tenantId,
        scopeType: 'COMPANY',
        scopeId: args.companyId,
        triggerType: 'COMPANY_SOURCE_CHANGED',
        correlationId: `company-profile-${args.section}-${Date.now()}`,
        requestedById: args.userId,
      });
    }
    await tx.auditLog.create({ data: {
      tenantId: args.tenantId,
      userId: args.userId,
      companyId: args.companyId,
      action: 'UPDATE',
      entityType: 'CompanyProfileSection',
      entityId: `${args.companyId}:${args.section}`,
      changeSource: 'MANUAL',
      reason: args.reason,
      summary: `Updated company ${args.section}`,
    } });
    return getCompanyProfileSection<T>(args.companyId, args.tenantId, args.section, tx);
  });
}

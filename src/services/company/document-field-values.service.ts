/**
 * Company values a document template prints, and filling one that is
 * missing from document generation. Saving goes through the same services
 * as the company's Edit page and Compliance card, so validation, schedule
 * reconciliation and the audit log apply as they do there.
 */

import { ZodError } from 'zod';
import { buildOakDocResolutionValues } from '@/lib/document-editor/oakdoc-context';
import {
  companyFieldHome,
  companyFieldTagsToResolve,
  encodeYearEnd,
  normalizeCompanyFieldValue,
  parseAddressValue,
  parseMoneyValue,
  parseYearEnd,
  yearEndOfDate,
  type CompanyFieldHomeId,
} from '@/lib/document-editor/oakdoc-company-field-homes';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { getCompanyById } from '@/services/company.service';
import { toOakDocCompanyDetail } from '@/services/oakdoc-generation.service';
import {
  CompanyProfileConflictError,
  CompanyProfileNotFoundError,
  getCompanyProfileSection,
  saveCompanyProfileSection,
} from '@/services/company/profile-sections';
import { confirmFirstFinancialYearEnd } from '@/services/compliance-monitoring/financial-periods';
import type { DateOnly } from '@/services/service-schedule';

/** Resolved values of the `company.*` tags among `tags`, as a generated document prints them. */
export async function getCompanyDocumentFieldValues(
  companyId: string,
  tenantId: string,
  tags: readonly string[],
): Promise<Record<string, string>> {
  const fieldTags = companyFieldTagsToResolve(tags);
  const company = await getCompanyById(companyId, tenantId);
  if (!company) throw new NotFoundError('Company not found');
  if (fieldTags.length === 0) return {};
  const resolved = buildOakDocResolutionValues({
    company: toOakDocCompanyDetail(company),
    fieldTags,
  });
  return Object.fromEntries(fieldTags.map((tag) => [tag, resolved[tag] ?? '']));
}

export interface SaveCompanyDocumentFieldArgs {
  companyId: string;
  tenantId: string;
  userId: string;
  fieldId: CompanyFieldHomeId;
  value: string;
}

export interface SaveCompanyDocumentFieldResult {
  fieldId: CompanyFieldHomeId;
  value: string;
  values: Record<string, string>;
}

const REASON = 'Filled from document generation';

function alreadySet(label: string): never {
  throw new ConflictError(`${label} already has a value on record. Reload to use it.`);
}

/** The section data with the value filled in, refusing to replace a value already on record. */
function fillSection(fieldId: CompanyFieldHomeId, data: Record<string, unknown>, value: string): Record<string, unknown> {
  const { label } = companyFieldHome(fieldId);
  switch (fieldId) {
    case 'uen':
      if (typeof data.uen === 'string' && data.uen.trim()) alreadySet(label);
      return { ...data, uen: value };
    case 'incorporationDate':
      if (data.incorporationDate) alreadySet(label);
      return { ...data, incorporationDate: value };
    case 'financialYearEnd': {
      if (data.financialYearEndDay != null && data.financialYearEndMonth != null) alreadySet(label);
      const parsed = parseYearEnd(value);
      if (!parsed.ok) throw new ValidationError(parsed.error);
      // Leave the first financial period as it is.
      const rest = { ...data };
      delete rest.firstFinancialYearEndDate;
      return { ...rest, financialYearEndDay: parsed.value.day, financialYearEndMonth: parsed.value.month };
    }
    case 'registeredAddress': {
      if (data.registered) alreadySet(label);
      const parsed = parseAddressValue(value);
      if (!parsed.ok) throw new ValidationError(parsed.error);
      return { ...data, registered: { ...parsed.value, effectiveFrom: null } };
    }
    case 'paidUpCapital': {
      if (data.paidUpCapitalAmount != null) alreadySet(label);
      const parsed = parseMoneyValue(value);
      if (!parsed.ok) throw new ValidationError(parsed.error);
      return { ...data, paidUpCapitalCurrency: parsed.value.currency, paidUpCapitalAmount: parsed.value.amount };
    }
    case 'firstFinancialYearEnd':
      throw new Error('The first financial year end is saved as a financial period');
  }
}

/**
 * Save a value that was missing for the company to where it is kept: its
 * profile section, or (first FYE) its first confirmed financial period.
 * Only fills a blank value; a value recorded meanwhile is a conflict.
 */
export async function saveCompanyDocumentField(
  args: SaveCompanyDocumentFieldArgs,
): Promise<SaveCompanyDocumentFieldResult> {
  const home = companyFieldHome(args.fieldId);
  const normalized = normalizeCompanyFieldValue(args.fieldId, args.value);
  if (!normalized.ok) throw new ValidationError(normalized.error);
  const value = normalized.value;

  try {
    if (args.fieldId === 'firstFinancialYearEnd') {
      const current = await getCompanyProfileSection<Record<string, unknown>>(
        args.companyId, args.tenantId, 'compliance',
      );
      if (current.data.firstFinancialYearEndDate) alreadySet(home.label);
      await confirmFirstFinancialYearEnd(
        { tenantId: args.tenantId, companyId: args.companyId, userId: args.userId },
        value as DateOnly,
      );
      // A company with no year end on record takes it from the first FYE.
      const yearEnd = yearEndOfDate(value);
      const after = await getCompanyProfileSection<Record<string, unknown>>(
        args.companyId, args.tenantId, 'compliance',
      );
      if (yearEnd && (after.data.financialYearEndDay == null || after.data.financialYearEndMonth == null)) {
        await saveCompanyProfileSection({
          companyId: args.companyId,
          tenantId: args.tenantId,
          userId: args.userId,
          section: 'compliance',
          ifMatchVersion: after.version,
          reason: REASON,
          data: fillSection('financialYearEnd', after.data, encodeYearEnd(yearEnd.day, yearEnd.month)),
        });
      }
    } else {
      const current = await getCompanyProfileSection<Record<string, unknown>>(
        args.companyId, args.tenantId, home.section,
      );
      await saveCompanyProfileSection({
        companyId: args.companyId,
        tenantId: args.tenantId,
        userId: args.userId,
        section: home.section,
        ifMatchVersion: current.version,
        reason: REASON,
        data: fillSection(args.fieldId, current.data, value),
      });
    }
  } catch (error) {
    if (error instanceof CompanyProfileNotFoundError) throw new NotFoundError('Company not found');
    if (error instanceof ZodError) {
      throw new ValidationError(
        `${home.label} could not be saved: ${error.issues[0]?.message ?? 'invalid value'}`,
      );
    }
    if (error instanceof CompanyProfileConflictError) {
      throw new ConflictError('The company changed while saving. Try again.');
    }
    throw error;
  }

  return {
    fieldId: args.fieldId,
    value,
    values: await getCompanyDocumentFieldValues(args.companyId, args.tenantId, home.tags),
  };
}

import { describe, expect, it } from 'vitest';
import {
  COMPANY_STATUSES,
  ENTITY_TYPES,
  getCompanyStatusLabel,
  getEntityTypeLabel,
  getIdentificationTypeLabel,
  getOfficerRoleLabel,
  getShareholderTypeLabel,
} from '@/lib/constants';
import {
  CompanyStatus,
  ContactType,
  EntityType,
  IdentificationType,
  OfficerRole,
} from '@/generated/prisma/enums';

describe('enum label casing', () => {
  it('keeps company status constants aligned with the schema and properly cased', () => {
    expect(COMPANY_STATUSES.map((status) => status.value)).toEqual(Object.values(CompanyStatus));
    expect(getCompanyStatusLabel('WINDING_UP')).toBe('Winding Up');
    expect(getCompanyStatusLabel('OTHER')).toBe('Other');
    for (const status of Object.values(CompanyStatus)) {
      expect(getCompanyStatusLabel(status)).not.toBe(status);
      expect(getCompanyStatusLabel(status)).not.toMatch(/[A-Z]{2,}/);
    }
  });

  it('keeps entity type constants aligned with the schema and properly cased', () => {
    expect(ENTITY_TYPES.map((type) => type.value)).toEqual(Object.values(EntityType));
    expect(getEntityTypeLabel('PUBLIC_COMPANY_LIMITED_BY_GUARANTEE')).toBe('Public Company Limited by Guarantee');
    for (const type of Object.values(EntityType)) {
      expect(getEntityTypeLabel(type)).not.toBe(type);
      expect(getEntityTypeLabel(type)).not.toMatch(/[A-Z]{2,}/);
    }
  });

  it('labels the remaining enum-backed dropdown values with proper casing', () => {
    const acronymRoles = new Set(['CEO', 'CFO']);
    for (const role of Object.values(OfficerRole)) {
      if (acronymRoles.has(role)) {
        expect(getOfficerRoleLabel(role)).toBe(role);
      } else {
        expect(getOfficerRoleLabel(role)).not.toBe(role);
      }
    }
    for (const type of Object.values(ContactType)) {
      expect(getShareholderTypeLabel(type)).not.toBe(type);
    }
    expect(getIdentificationTypeLabel('OTHER')).toBe('Other');
    expect(getIdentificationTypeLabel('PASSPORT')).toBe('Passport');
  });
});

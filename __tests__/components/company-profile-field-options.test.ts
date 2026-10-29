import { describe, expect, it } from 'vitest';
import { COMPANY_PROFILE_FIELD_OPTIONS } from '@/components/companies/company-edit/company-profile-field-options';
import {
  CompanyStatus,
  ContactType,
  EntityType,
  IdentificationType,
  OfficerRole,
} from '@/generated/prisma/enums';

describe('company profile field options', () => {
  it('covers every schema enum value for dropdown-backed fields', () => {
    expect(COMPANY_PROFILE_FIELD_OPTIONS.entityType.map((option) => option.value)).toEqual(Object.values(EntityType));
    expect(COMPANY_PROFILE_FIELD_OPTIONS.status.map((option) => option.value)).toEqual(Object.values(CompanyStatus));
    expect(COMPANY_PROFILE_FIELD_OPTIONS.role.map((option) => option.value)).toEqual(Object.values(OfficerRole));
    expect(COMPANY_PROFILE_FIELD_OPTIONS.identificationType.map((option) => option.value)).toEqual(Object.values(IdentificationType));
    expect(COMPANY_PROFILE_FIELD_OPTIONS.shareholderType.map((option) => option.value)).toEqual(Object.values(ContactType));
  });

  it('renders every dropdown label with proper casing', () => {
    expect(COMPANY_PROFILE_FIELD_OPTIONS.status.find((option) => option.value === 'WINDING_UP')?.label).toBe('Winding Up');
    expect(COMPANY_PROFILE_FIELD_OPTIONS.status.find((option) => option.value === 'OTHER')?.label).toBe('Other');
    expect(COMPANY_PROFILE_FIELD_OPTIONS.entityType.find((option) => option.value === 'PUBLIC_COMPANY_LIMITED_BY_GUARANTEE')?.label).toBe('Public Company Limited by Guarantee');
  });
});

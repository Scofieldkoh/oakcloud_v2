import {
  getCompanyStatusLabel,
  getEntityTypeLabel,
  IDENTIFICATION_TYPES,
  OFFICER_ROLES,
  SHAREHOLDER_TYPES,
} from '@/lib/constants';
import {
  BIZFILE_ENTITY_TYPE_OPTIONS,
  BIZFILE_STATUS_OPTIONS,
} from '@/services/bizfile/canonical-values';
import type { SelectOption } from '@/components/ui/searchable-select';

/**
 * Options for company profile fields backed by schema enums.
 * Values must match the enums accepted by company profile validation.
 */
export const COMPANY_PROFILE_FIELD_OPTIONS: Record<string, SelectOption[]> = {
  entityType: BIZFILE_ENTITY_TYPE_OPTIONS.map((value) => ({
    value,
    label: getEntityTypeLabel(value),
  })),
  status: BIZFILE_STATUS_OPTIONS.map((value) => ({
    value,
    label: getCompanyStatusLabel(value),
  })),
  role: OFFICER_ROLES.map(({ value, label }) => ({ value, label })),
  shareholderType: SHAREHOLDER_TYPES.map(({ value, label }) => ({ value, label })),
  identificationType: IDENTIFICATION_TYPES.map(({ value, label }) => ({ value, label })),
};

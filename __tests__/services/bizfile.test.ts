/**
 * BizFile Service Tests
 *
 * Tests for BizFile extraction, normalization, and diff generation.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock AI library
vi.mock('@/lib/ai', () => ({
  callAI: vi.fn(),
  callAIWithConnector: vi.fn(),
  getBestAvailableModel: vi.fn(() => 'gpt-4o'),
  getBestAvailableModelForWorkspace: vi.fn(() => Promise.resolve('gpt-4o')),
  getModelConfig: vi.fn(() => ({ name: 'GPT-4o', provider: 'openai' })),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  safeErrorMessage: (e: unknown) => e instanceof Error ? e.message : 'Unknown error',
  sanitizeError: (e: unknown) => ({ message: e instanceof Error ? e.message : 'Unknown error', type: 'Error' }),
  getPrismaLogConfig: () => ['warn', 'error'],
  getCurrentLogLevel: () => 'info',
  isLogLevelEnabled: () => true,
}));

import {
  normalizeExtractedData,
  buildFullAddress,
  mapEntityType,
  mapCompanyStatus,
  mapOfficerRole,
  mapIdentificationType,
} from '@/services/bizfile';
import type { ExtractedBizFileData } from '@/services/bizfile';
import {
  BIZFILE_ENTITY_TYPE_OPTIONS,
  BIZFILE_IDENTIFICATION_TYPE_OPTIONS,
  BIZFILE_OFFICER_ROLE_OPTIONS,
  BIZFILE_STATUS_OPTIONS,
} from '@/services/bizfile/canonical-values';
import { CompanyStatus, EntityType, IdentificationType, OfficerRole } from '@/generated/prisma/enums';

describe('BizFile Service', () => {
  it('keeps canonical review values in parity with Prisma-backed mappers', () => {
    expect(BIZFILE_ENTITY_TYPE_OPTIONS).toEqual(Object.values(EntityType));
    expect(BIZFILE_STATUS_OPTIONS).toEqual(Object.values(CompanyStatus));
    expect(BIZFILE_OFFICER_ROLE_OPTIONS).toEqual(Object.values(OfficerRole));
    expect(BIZFILE_IDENTIFICATION_TYPE_OPTIONS).toEqual(Object.values(IdentificationType));
    expect(BIZFILE_ENTITY_TYPE_OPTIONS.map(mapEntityType)).toEqual([...BIZFILE_ENTITY_TYPE_OPTIONS]);
    expect(BIZFILE_STATUS_OPTIONS.map(mapCompanyStatus)).toEqual([...BIZFILE_STATUS_OPTIONS]);
    expect(BIZFILE_OFFICER_ROLE_OPTIONS.map(mapOfficerRole)).toEqual([...BIZFILE_OFFICER_ROLE_OPTIONS]);
    expect(BIZFILE_IDENTIFICATION_TYPE_OPTIONS.map(mapIdentificationType)).toEqual([...BIZFILE_IDENTIFICATION_TYPE_OPTIONS]);
  });
  describe('Entity Type Mapping', () => {
    it('should map PRIVATE_LIMITED correctly', () => {
      expect(mapEntityType('PRIVATE_LIMITED')).toBe('PRIVATE_LIMITED');
      expect(mapEntityType('PRIVATE LIMITED')).toBe('PRIVATE_LIMITED');
      expect(mapEntityType('private limited')).toBe('PRIVATE_LIMITED');
    });

    it('should map PUBLIC_LIMITED correctly', () => {
      expect(mapEntityType('PUBLIC_LIMITED')).toBe('PUBLIC_LIMITED');
      expect(mapEntityType('PUBLIC LIMITED')).toBe('PUBLIC_LIMITED');
      expect(mapEntityType('PUBLIC_COMPANY_LIMITED_BY_GUARANTEE')).toBe('PUBLIC_COMPANY_LIMITED_BY_GUARANTEE');
      expect(mapEntityType('PUBLIC COMPANY LIMITED BY GUARANTEE')).toBe('PUBLIC_COMPANY_LIMITED_BY_GUARANTEE');
    });

    it('should map LLP abbreviation', () => {
      expect(mapEntityType('LLP')).toBe('LIMITED_LIABILITY_PARTNERSHIP');
      expect(mapEntityType('LIMITED_LIABILITY_PARTNERSHIP')).toBe('LIMITED_LIABILITY_PARTNERSHIP');
    });

    it('should map VCC abbreviation', () => {
      expect(mapEntityType('VCC')).toBe('VARIABLE_CAPITAL_COMPANY');
    });

    it('should return OTHER for unknown types', () => {
      expect(mapEntityType('UNKNOWN_TYPE')).toBe('OTHER');
      expect(mapEntityType('')).toBe('OTHER');
    });
  });

  describe('Company Status Mapping', () => {
    it('should map LIVE correctly', () => {
      expect(mapCompanyStatus('LIVE')).toBe('LIVE');
      expect(mapCompanyStatus('LIVE COMPANY')).toBe('LIVE');
      expect(mapCompanyStatus('live')).toBe('LIVE');
    });

    it('should map STRUCK_OFF correctly', () => {
      expect(mapCompanyStatus('STRUCK_OFF')).toBe('STRUCK_OFF');
      expect(mapCompanyStatus('STRUCK OFF')).toBe('STRUCK_OFF');
    });

    it('should map liquidation statuses', () => {
      expect(mapCompanyStatus('WINDING_UP')).toBe('WINDING_UP');
      expect(mapCompanyStatus('IN LIQUIDATION')).toBe('IN_LIQUIDATION');
      expect(mapCompanyStatus('IN RECEIVERSHIP')).toBe('IN_RECEIVERSHIP');
    });

    it('should return OTHER for unknown statuses', () => {
      expect(mapCompanyStatus('UNKNOWN_STATUS')).toBe('OTHER');
    });
  });

  describe('Officer Role Mapping', () => {
    it('should map DIRECTOR correctly', () => {
      expect(mapOfficerRole('DIRECTOR')).toBe('DIRECTOR');
      expect(mapOfficerRole('director')).toBe('DIRECTOR');
    });

    it('should include and map NOMINEE_DIRECTOR correctly', () => {
      expect(BIZFILE_OFFICER_ROLE_OPTIONS).toContain('NOMINEE_DIRECTOR');
      expect(mapOfficerRole('NOMINEE_DIRECTOR')).toBe('NOMINEE_DIRECTOR');
      expect(mapOfficerRole('NOMINEE DIRECTOR')).toBe('NOMINEE_DIRECTOR');
    });

    it('should map MANAGING_DIRECTOR correctly', () => {
      expect(mapOfficerRole('MANAGING_DIRECTOR')).toBe('MANAGING_DIRECTOR');
      expect(mapOfficerRole('MANAGING DIRECTOR')).toBe('MANAGING_DIRECTOR');
    });

    it('should map SECRETARY correctly', () => {
      expect(mapOfficerRole('SECRETARY')).toBe('SECRETARY');
      expect(mapOfficerRole('COMPANY SECRETARY')).toBe('SECRETARY');
    });

    it('should map CEO correctly', () => {
      expect(mapOfficerRole('CEO')).toBe('CEO');
      expect(mapOfficerRole('CHIEF EXECUTIVE OFFICER')).toBe('CEO');
    });

    it('should default to DIRECTOR for unknown roles', () => {
      expect(mapOfficerRole('UNKNOWN_ROLE')).toBe('DIRECTOR');
    });
  });

  describe('Identification Type Mapping', () => {
    it('should map NRIC correctly', () => {
      expect(mapIdentificationType('NRIC')).toBe('NRIC');
      expect(mapIdentificationType('nric')).toBe('NRIC');
    });

    it('should map FIN correctly', () => {
      expect(mapIdentificationType('FIN')).toBe('FIN');
    });

    it('should map PASSPORT correctly', () => {
      expect(mapIdentificationType('PASSPORT')).toBe('PASSPORT');
    });

    it('should map UEN correctly', () => {
      expect(mapIdentificationType('UEN')).toBe('UEN');
    });

    it('should return null for undefined', () => {
      expect(mapIdentificationType(undefined)).toBeNull();
    });

    it('should return OTHER for unknown types', () => {
      expect(mapIdentificationType('UNKNOWN')).toBe('OTHER');
    });
  });

  describe('buildFullAddress', () => {
    it('should build full address with all components', () => {
      const address = buildFullAddress({
        block: '123',
        streetName: 'Sample Road',
        level: '05',
        unit: '01',
        buildingName: 'Sample Tower',
        postalCode: '123456',
      });

      expect(address).toContain('123');
      expect(address).toContain('Sample Road');
      expect(address).toContain('#05-01');
      expect(address).toContain('Sample Tower');
      expect(address).toContain('Singapore 123456');
    });

    it('should handle missing optional fields', () => {
      const address = buildFullAddress({
        streetName: 'Simple Road',
        postalCode: '654321',
      });

      expect(address).toContain('Simple Road');
      expect(address).toContain('Singapore 654321');
      expect(address).not.toContain('#');
    });

    it('should handle unit without level', () => {
      const address = buildFullAddress({
        streetName: 'Test Street',
        unit: '10',
        postalCode: '111111',
      });

      expect(address).toContain('#10');
    });
  });

  describe('normalizeExtractedData', () => {
    it('defaults the registered country to Singapore and derives missing share par value', () => {
      const result = normalizeExtractedData({
        entityDetails: { uen: '202312345A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
        registeredAddress: { streetName: 'Sample Road', postalCode: '123456' },
        shareCapital: [{ shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 168, totalValue: 168, isPaidUp: true }],
      });

      expect(result.registeredAddress?.country).toBe('Singapore');
      expect(result.shareCapital?.[0].parValue).toBe(1);
    });

    it('corrects the calculated par value and leaves the extracted total untouched', () => {
      const result = normalizeExtractedData({
        entityDetails: { uen: '202312345A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
        shareCapital: [{ shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 150000, parValue: 1, totalValue: 1, isPaidUp: true }],
      });

      expect(result.shareCapital?.[0].totalValue).toBe(1);
      expect(result.shareCapital?.[0].parValue).toBeCloseTo(1 / 150000, 10);
      expect(result.shareCapital?.[0].reviewFlags).toHaveLength(1);
      expect(result.shareCapital?.[0].reviewFlags?.[0]).toContain('par value corrected from SGD 1 to SGD 0.0000066667');
      expect(result.shareCapital?.[0].reviewFlags?.[0]).not.toContain('total corrected');
    });

    it('leaves consistent share capital totals untouched', () => {
      const result = normalizeExtractedData({
        entityDetails: { uen: '202312345A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
        shareCapital: [{ shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 150000, parValue: 1, totalValue: 150000, isPaidUp: true }],
      });

      expect(result.shareCapital?.[0].totalValue).toBe(150000);
      expect(result.shareCapital?.[0].reviewFlags).toBeUndefined();
    });

    it('always derives par value strictly from the extracted total, ignoring the extracted per-share value', () => {
      const result = normalizeExtractedData({
        entityDetails: { uen: '202312345A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
        shareCapital: [{ shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 50, parValue: 1, totalValue: 100, isPaidUp: true }],
      });

      expect(result.shareCapital?.[0].totalValue).toBe(100);
      expect(result.shareCapital?.[0].parValue).toBe(2);
      expect(result.shareCapital?.[0].reviewFlags).toHaveLength(1);
      expect(result.shareCapital?.[0].reviewFlags?.[0]).toContain('par value corrected from SGD 1 to SGD 2');
    });

    it('does not derive totals for treasury share capital rows', () => {
      const result = normalizeExtractedData({
        entityDetails: { uen: '202312345A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
        shareCapital: [{ shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 150000, parValue: 1, totalValue: 0, isPaidUp: false, isTreasury: true }],
      });

      expect(result.shareCapital?.[0].totalValue).toBe(0);
      expect(result.shareCapital?.[0].reviewFlags).toBeUndefined();
    });

    it('preserves short leading brand acronyms and normalizes legal suffix casing', () => {
      const result = normalizeExtractedData({
        entityDetails: { uen: '202312345A', name: 'DAP ATELIER PTE LTD', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
      });

      expect(result.entityDetails.name).toBe('DAP Atelier Pte Ltd');
    });

    it('limits an extracted alias to ten characters', () => {
      const result = normalizeExtractedData({
        entityDetails: {
          uen: '202312345A',
          name: 'Example Pte. Ltd.',
          displayAlias: ' ABCDEFGHIJK ',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      });

      expect(result.entityDetails.displayAlias).toBe('ABCDEFGHIJ');
    });

    it('should normalize company name to title case', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'SAMPLE COMPANY PTE LTD',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      };

      const result = normalizeExtractedData(data);

      // Should normalize company name
      expect(result.entityDetails.name).not.toBe('SAMPLE COMPANY PTE LTD');
    });

    it('should normalize officer names', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
        officers: [
          {
            name: 'JOHN TAN WEI MING',
            role: 'DIRECTOR',
            nationality: 'SINGAPOREAN',
          },
        ],
      };

      const result = normalizeExtractedData(data);

      expect(result.officers).toBeDefined();
      expect(result.officers![0].name).not.toBe('JOHN TAN WEI MING');
    });

    it('should normalize shareholder names based on type', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
        shareholders: [
          {
            name: 'JANE DOE',
            type: 'INDIVIDUAL',
            shareClass: 'ORDINARY',
            numberOfShares: 1000,
          },
          {
            name: 'HOLDING COMPANY PTE LTD',
            type: 'CORPORATE',
            shareClass: 'ORDINARY',
            numberOfShares: 5000,
          },
        ],
      };

      const result = normalizeExtractedData(data);

      expect(result.shareholders).toBeDefined();
      expect(result.shareholders).toHaveLength(2);
    });

    it('should normalize addresses', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
        registeredAddress: {
          streetName: 'SAMPLE ROAD',
          postalCode: '123456',
        },
      };

      const result = normalizeExtractedData(data);

      expect(result.registeredAddress).toBeDefined();
    });

    it('should preserve data structure', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
          incorporationDate: '2023-01-15',
        },
        ssicActivities: {
          primary: { code: '62011', description: 'SOFTWARE DEVELOPMENT' },
        },
        shareCapital: [
          {
            shareClass: 'ORDINARY',
            currency: 'SGD',
            numberOfShares: 100000,
            totalValue: 100000,
            isPaidUp: true,
          },
        ],
      };

      const result = normalizeExtractedData(data);

      expect(result.entityDetails.uen).toBe('202312345A');
      expect(result.entityDetails.incorporationDate).toBe('2023-01-15');
      expect(result.ssicActivities?.primary?.code).toBe('62011');
      expect(result.shareCapital).toHaveLength(1);
      expect(result.shareCapital![0].numberOfShares).toBe(100000);
    });

    it('should normalize currency names to ISO codes', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
        homeCurrency: 'SINGAPORE DOLLAR',
        paidUpCapital: {
          amount: 1000,
          currency: 'Singapore Dollar',
        },
        issuedCapital: {
          amount: 1000,
          currency: 'sgd',
        },
        shareCapital: [
          {
            shareClass: 'ORDINARY',
            currency: 'SINGAPORE DOLLAR',
            numberOfShares: 1000,
            totalValue: 1000,
            isPaidUp: true,
          },
        ],
      };

      const result = normalizeExtractedData(data);

      expect(result.homeCurrency).toBe('SGD');
      expect(result.paidUpCapital?.currency).toBe('SGD');
      expect(result.issuedCapital?.currency).toBe('SGD');
      expect(result.shareCapital?.[0]?.currency).toBe('SGD');
    });
  });

  describe('Extraction Data Validation', () => {
    it('should handle empty officers array', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
        officers: [],
      };

      const result = normalizeExtractedData(data);
      expect(result.officers).toEqual([]);
    });

    it('should handle missing optional sections', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      };

      const result = normalizeExtractedData(data);

      expect(result.ssicActivities).toBeUndefined();
      expect(result.registeredAddress).toBeUndefined();
      expect(result.officers).toBeUndefined();
      expect(result.shareholders).toBeUndefined();
    });

    it('should preserve charge information', () => {
      const data: ExtractedBizFileData = {
        entityDetails: {
          uen: '202312345A',
          name: 'Test Company',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
        charges: [
          {
            chargeNumber: 'CHG001',
            chargeHolderName: 'DBS BANK LTD',
            amountSecuredText: 'All Monies',
            registrationDate: '2023-06-01',
          },
        ],
      };

      const result = normalizeExtractedData(data);

      expect(result.charges).toHaveLength(1);
      expect(result.charges![0].chargeNumber).toBe('CHG001');
    });
  });
});

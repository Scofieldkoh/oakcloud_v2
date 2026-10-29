import { describe, expect, it } from 'vitest';
import {
  defaultServiceRosterPreference,
  parseServiceRosterPreference,
} from '@/components/services/roster/service-roster';

describe('service roster table preferences', () => {
  it('defensively restores the complete versioned table contract', () => {
    const parsed = parseServiceRosterPreference({
      version: 1,
      columnWidths: { company: 340, service: 10, unknown: 900 },
      columnOrder: ['service', 'company', 'service', 'unknown'],
      columnVisibility: { company: false, service: true, unknown: true },
      sortBy: 'service',
      sortOrder: 'desc',
      pageSize: 50,
    });

    expect(parsed).toEqual(expect.objectContaining({
      version: 1,
      columnWidths: expect.objectContaining({ company: 340 }),
      columnOrder: ['service', 'company', 'family', 'status', 'cadence', 'nextDeadline', 'startEnd', 'warnings', 'billing', 'actions'],
      columnVisibility: expect.objectContaining({ company: false, service: true, actions: true }),
      sortBy: 'service',
      sortOrder: 'desc',
      pageSize: 50,
    }));
    expect(parsed.columnWidths.service).toBeGreaterThanOrEqual(96);
    expect(parsed.columnWidths.unknown).toBeUndefined();
  });

  it('falls back to safe defaults for malformed preference data', () => {
    expect(parseServiceRosterPreference({ version: 99, columnOrder: ['unknown'], pageSize: -1 }))
      .toEqual(defaultServiceRosterPreference);
  });

  it('rejects preference page sizes outside the roster API contract', () => {
    expect(parseServiceRosterPreference({ version: 1, pageSize: 200 }).pageSize).toBe(20);
    expect(parseServiceRosterPreference({ version: 1, pageSize: 100 }).pageSize).toBe(100);
  });
});

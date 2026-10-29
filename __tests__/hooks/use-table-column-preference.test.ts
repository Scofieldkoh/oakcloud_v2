import { describe, expect, it } from 'vitest';
import { parseTableColumnPreference } from '@/hooks/use-table-column-preference';

const COLUMNS = ['name', 'category', 'updated', 'actions'] as const;

describe('parseTableColumnPreference', () => {
  it('starts from the default order with hidden-by-default columns off', () => {
    expect(parseTableColumnPreference(undefined, COLUMNS, { hiddenByDefault: ['updated'] })).toEqual({
      version: 1,
      columnOrder: ['name', 'category', 'updated', 'actions'],
      columnVisibility: { name: true, category: true, updated: false, actions: true },
      columnWidths: {},
    });
  });

  it('keeps the saved layout, drops unknown columns, appends new ones and keeps locked columns shown', () => {
    const parsed = parseTableColumnPreference(
      {
        version: 1,
        columnOrder: ['updated', 'gone', 'name'],
        columnVisibility: { category: false, actions: false },
        columnWidths: { name: 2000, category: 10, gone: 200, updated: 'wide' },
      },
      COLUMNS,
      { locked: ['actions'], minWidth: 80 },
    );

    expect(parsed.columnOrder).toEqual(['updated', 'name', 'category', 'actions']);
    expect(parsed.columnVisibility).toEqual({ name: true, category: false, updated: true, actions: true });
    expect(parsed.columnWidths).toEqual({ name: 800, category: 80 });
  });

  it('ignores a layout from another version', () => {
    expect(parseTableColumnPreference({ version: 2, columnOrder: ['actions'] }, COLUMNS).columnOrder)
      .toEqual(['name', 'category', 'updated', 'actions']);
  });
});

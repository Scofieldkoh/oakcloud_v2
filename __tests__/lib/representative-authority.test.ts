import { describe, expect, it } from 'vitest';
import {
  insertRepresentativeByAuthority,
  moveRepresentative,
} from '@/lib/representative-authority';

describe('representative authority ordering', () => {
  it('inserts a new representative by authority while preserving the existing order', () => {
    const roles = {
      manager: 'Manager',
      shareholder: 'Shareholder',
      ceo: 'CEO',
    };

    expect(insertRepresentativeByAuthority(
      ['manager', 'shareholder'],
      'ceo',
      roles,
    )).toEqual(['ceo', 'manager', 'shareholder']);
  });

  it('moves only the selected representative by one position', () => {
    expect(moveRepresentative(['director', 'ceo', 'manager'], 'manager', 'up'))
      .toEqual(['director', 'manager', 'ceo']);
    expect(moveRepresentative(['director', 'ceo', 'manager'], 'director', 'up'))
      .toEqual(['director', 'ceo', 'manager']);
  });
});

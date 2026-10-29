import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('processing counterparty identity fields', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/app/(dashboard)/processing/[id]/_components/extracted-header-fields.tsx'),
    'utf8',
  );

  it('associates every identity label with a stable control id', () => {
    for (const id of [
      'counterparty-identification-type', 'counterparty-identification-number',
      'counterparty-address', 'counterparty-email', 'counterparty-phone',
    ]) {
      expect(source).toContain(`htmlFor="${id}"`);
      expect(source).toContain(`id="${id}"`);
    }
  });

  it('renders identification-type confidence in read mode', () => {
    expect(source).toContain("getFieldConfidence('counterpartyIdentificationType')");
  });
});

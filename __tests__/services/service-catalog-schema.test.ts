import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service catalog Prisma schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('defines additive catalog and composition contracts', () => {
    expect(schema).toContain('enum DocumentTemplateCompositionType');
    expect(schema).toContain('enum ServiceCadence');
    expect(schema).toContain('enum BillingFrequency');
    expect(schema).toContain('model ServiceFamily');
    expect(schema).toContain('model ServiceVariant');
    expect(schema).toContain('model ServiceVariantFeeTemplate');
    expect(schema).toMatch(
      /^\s*compositionType\s+DocumentTemplateCompositionType\s+@default\(STANDARD\)(?:\s+@map\("[^"]+"\))?\s*$/m,
    );
    expect(schema).toMatch(/^\s*version\s+Int\s+@default\(1\)\s*$/m);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service agreement draft schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('stores normalized draft selections beside generated documents', () => {
    const serviceAgreement = schema.match(/model ServiceAgreement\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
    for (const model of [
      'ServiceAgreement',
      'ServiceAgreementEntity',
      'ServiceAgreementItem',
      'ServiceAgreementItemEntity',
      'ServiceAgreementFeeLine',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(serviceAgreement).toMatch(/^\s*generatedDocumentId\s+String\s+@unique(?:\s+@map\("[^"]+"\))?\s*$/m);
    expect(schema).toContain('@@unique([itemId, agreementEntityId])');
  });
});

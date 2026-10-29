import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('form URL health Prisma schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('stores stable warning state by tenant, form, and field key', () => {
    expect(schema).toContain('model FormUrlHealth');
    expect(schema).toContain('@@unique([tenantId, formId, fieldKey])');
    expect(schema).toContain('consecutiveFailures');
    expect(schema).toContain('warningActivatedAt');
    expect(schema).toContain('formUrlHealth');
  });
});

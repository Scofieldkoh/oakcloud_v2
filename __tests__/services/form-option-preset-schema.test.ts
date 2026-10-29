import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('form option preset Prisma schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('stores workspace presets and links dropdown fields to them', () => {
    const optionPreset = schema.match(/model FormOptionPreset\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(schema).toContain('model FormOptionPreset');
    expect(schema).toContain('optionPresetId');
    expect(schema).toContain('@@unique([tenantId, normalizedKey])');
    expect(optionPreset).toMatch(/^\s*options\s+Json(?!\?)\s*$/m);
    expect(schema).toContain('onDelete: Restrict');
  });
});

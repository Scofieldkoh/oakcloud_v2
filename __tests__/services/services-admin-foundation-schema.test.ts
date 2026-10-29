import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('services administration foundation schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20260817090000_services_admin_foundation/migration.sql',
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

  it('adds optional company aliases and required family colors', () => {
    expect(schema).toContain('displayAlias');
    expect(schema).toContain('@map("display_alias") @db.VarChar(10)');
    expect(schema).toContain('displayColor');
    expect(schema).toContain('@default("#2F6F5E")');
    expect(migration).toContain('service_families_display_color_hex');
    expect(migration).toContain('UPDATE "service_families"');
  });

  it('limits existing company aliases to ten characters', () => {
    const migrationPath = resolve(
      process.cwd(),
      'prisma/migrations/20260901000000_limit_company_alias_length/migration.sql',
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('ALTER COLUMN "display_alias" TYPE VARCHAR(10)');
    expect(migration).toContain('USING LEFT("display_alias", 10)');
  });

  it('backfills families with the stable tenant palette and preserves existing data', () => {
    expect(migration).toContain('PARTITION BY "tenant_id"');
    expect(migration).toContain('ORDER BY "display_order", "name", "id"');
    expect(migration).toMatch(
      /'#2F6F5E',\s*'#3F6DA8',\s*'#8A5AA5',\s*'#B0653C',\s*'#467A43',\s*'#9A6A18',\s*'#9B4D67',\s*'#4E7180'/,
    );
    expect(migration).toContain('CHECK ("display_color" ~ \'^#[0-9A-F]{6}$\')');
    expect(migration).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE)\b/i);
  });
});

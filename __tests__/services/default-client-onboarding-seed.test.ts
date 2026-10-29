import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8');

describe('default Client Onboarding pipeline seed', () => {
  it('creates one immutable version for every active tenant', () => {
    expect(seed).toContain("name: 'Client Onboarding'");
    expect(seed).toMatch(/workspace\.findMany\(\{[\s\S]*deletedAt:\s*null/);
    expect(seed).toContain('prisma.$transaction');
    expect(seed).toContain('taskPipelineVersion.findFirst');
    expect(seed).toContain('const versionNumber = existingVersion ? existingVersion.version + 1 : 1');
    expect(seed).toMatch(/publishedAt:\s*null/);
    expect(seed).toMatch(/publishedAt:\s*new Date\(\)/);
  });

  it('uses the registry-compatible required stage actions and curated icons', () => {
    expect(seed).toContain("name: 'Company Profile'");
    expect(seed).toContain("actionType: 'COMPANY_PROFILE'");
    expect(seed).toContain("icon: 'Building2'");
    expect(seed).toContain('allowCreate: true');

    expect(seed).toContain("name: 'Generate Resolution'");
    expect(seed).toContain("templateId: templateIds.resolution");

    expect(seed).toContain("name: 'Generate Contract'");
    expect(seed).toContain("actionType: 'DOCUMENT_GENERATION'");
    expect(seed).toContain("icon: 'FileText'");
    expect(seed).toContain('templateIds.contract');

    expect(seed).toContain("name: 'E-signing'");
    expect(seed).toContain("actionType: 'ESIGNING'");
    expect(seed).toContain("icon: 'PenLine'");
    expect(seed).toContain("signingOrder: 'PARALLEL'");
    expect(seed).toContain('expiresInDays: 30');

    expect(seed.match(/isRequired:\s*true/g)).toHaveLength(4);
  });

  it('resolves the tenant-owned active contract and resolution templates', () => {
    expect(seed).toMatch(/documentTemplate\.findMany\(\{[\s\S]*category:\s*\{\s*in:/);
    expect(seed).toContain("'CONTRACT'");
    expect(seed).toContain("'RESOLUTION'");
    expect(seed).toContain('isActive: true');
    expect(seed).toContain('deletedAt: null');
  });

  it('wires canonical contract and resolution records and retires the legacy agreement', () => {
    expect(seed).toContain('CLIENT_ONBOARDING_DOCUMENT_TEMPLATES');
    expect(seed).toContain('ensureSeededDocumentTemplate(tx, tenantId, createdById, definition)');
    expect(seed).toContain('seedClientOnboardingDocumentTemplates(tx, workspace.id, createdById)');
    expect(seed).toContain("'Oaktree Local Master Services Agreement v1'");
    expect(seed).toContain('documentTemplate.updateMany');
  });

  it('does not persist user-defined pipeline or stage colours', () => {
    expect(seed).not.toMatch(/\b(?:color|colour|backgroundColor|textColor)\s*:/i);
  });
});

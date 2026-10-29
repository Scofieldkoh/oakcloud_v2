import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Prisma } from '@/generated/prisma';
import {
  CLIENT_ONBOARDING_DOCUMENT_TEMPLATES,
  ensureSeededDocumentTemplate,
  type SeedDocumentTemplate,
} from '../../prisma/seed-document-templates';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const canonicalDefinition: SeedDocumentTemplate = {
  name: 'Canonical template',
  description: '',
  category: 'RESOLUTION',
  compositionType: 'STANDARD',
  content: '<p style="font-size: 11pt">Canonical content</p>',
  contentJson: {
    version: 1,
    layout: {
      version: 1,
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '10pt',
      lineHeight: 1.15,
      paragraphSpacing: '0.5em',
      marginsMm: { top: 15, right: 20, bottom: 15, left: 20 },
    },
  },
  placeholders: [],
};

function templateRepository(
  initial: Record<string, unknown> | null,
  linkedReplacement: Record<string, unknown> | null = null,
) {
  let record = initial ? structuredClone(initial) : null;

  return {
    get record() {
      return record;
    },
    transaction: {
      documentTemplate: {
        async findFirst({ where }: { where: Record<string, unknown> }) {
          return where.contentJson ? linkedReplacement : record;
        },
        async update({ data }: { data: Record<string, unknown> }) {
          if (!record) throw new Error('Template does not exist');
          const version = data.version as { increment?: number } | undefined;
          record = {
            ...record,
            ...data,
            version: Number(record.version) + (version?.increment ?? 0),
          };
          return record;
        },
        async create({ data }: { data: Record<string, unknown> }) {
          record = { id: 'created-template', version: 1, ...data };
          return record;
        },
      },
    } as unknown as Prisma.TransactionClient,
  };
}

describe('canonical Client Onboarding document template seed', () => {
  it('preserves the exact Docker HTML and A4 layout for both templates', () => {
    const templates = Object.fromEntries(
      CLIENT_ONBOARDING_DOCUMENT_TEMPLATES.map((template) => [template.name, template]),
    );

    expect(sha256(templates['DR_Appointment of Corp Sec'].content)).toBe(
      '2ee3dc303814ede32b041a2ad8f8219859263a23878412f6a7107eabec504657',
    );
    expect(templates['DR_Appointment of Corp Sec'].contentJson).toEqual({
      version: 1,
      layout: {
        version: 1,
        fontSize: '10pt',
        marginsMm: { top: 15, left: 20, right: 20, bottom: 15 },
        fontFamily: 'Arial, Helvetica, sans-serif',
        lineHeight: 1.15,
        paragraphSpacing: '0.5em',
      },
    });
    expect(templates['DR_Appointment of Corp Sec']).toMatchObject({
      description: '',
      category: 'RESOLUTION',
      compositionType: 'STANDARD',
      placeholders: [{
        key: 'custom.resolution_date',
        path: 'custom.resolution_date',
        type: 'date',
        label: 'Resolution date',
        source: 'custom',
        category: 'custom',
        required: true,
      }],
    });

    expect(sha256(templates['Oaktree Master Services Agreement'].content)).toBe(
      '5420ccdd66874fce790d76e471af2188eb19eb289c1ea2e6a8d082f5d4f61e6d',
    );
    expect(templates['Oaktree Master Services Agreement'].contentJson).toEqual({
      version: 1,
      layout: {
        version: 1,
        fontSize: '10pt',
        marginsMm: { top: 15, left: 20, right: 20, bottom: 15 },
        fontFamily: 'Arial, Helvetica, sans-serif',
        lineHeight: 1.5,
        paragraphSpacing: '0.5em',
      },
    });
    expect(templates['Oaktree Master Services Agreement']).toMatchObject({
      description: 'Service Agreement template',
      category: 'CONTRACT',
      compositionType: 'SERVICE_AGREEMENT',
      placeholders: [
        {
          key: 'custom.agreementDate',
          path: 'custom.agreementDate',
          type: 'text',
          label: 'agreement Date',
          source: 'custom',
          category: 'custom',
          required: false,
        },
        {
          key: 'custom.effectiveDate',
          path: 'custom.effectiveDate',
          type: 'text',
          label: 'effective Date',
          source: 'custom',
          category: 'custom',
          required: false,
        },
        {
          key: 'custom.termMonths',
          path: 'custom.termMonths',
          type: 'text',
          label: 'term Months',
          source: 'custom',
          category: 'custom',
          required: false,
        },
      ],
    });
  });

  it('reconciles an active stale template to every canonical field', async () => {
    const repository = templateRepository({
      id: 'existing-template',
      tenantId: 'tenant-1',
      createdById: 'user-1',
      name: canonicalDefinition.name,
      description: 'stale',
      category: 'OTHER',
      compositionType: 'STANDARD',
      content: '<p>stale</p>',
      contentJson: null,
      placeholders: [{ key: 'stale' }],
      isActive: true,
      deletedAt: null,
      version: 6,
    });

    await ensureSeededDocumentTemplate(
      repository.transaction,
      'tenant-1',
      'user-1',
      canonicalDefinition,
    );

    expect(repository.record).toMatchObject({
      id: 'existing-template',
      tenantId: 'tenant-1',
      createdById: 'user-1',
      ...canonicalDefinition,
      isActive: true,
      deletedAt: null,
      version: 7,
    });
  });

  it('creates the A4 template for a new workspace but not once a Word template covers its category', async () => {
    const fresh = templateRepository(null);
    await ensureSeededDocumentTemplate(fresh.transaction, 'tenant-1', 'user-1', canonicalDefinition);
    expect(fresh.record).toMatchObject({ id: 'created-template', name: canonicalDefinition.name });

    const retired = templateRepository(null, { id: 'word-template' });
    await expect(ensureSeededDocumentTemplate(retired.transaction, 'tenant-1', 'user-1', canonicalDefinition))
      .resolves.toBeNull();
    expect(retired.record).toBeNull();
  });

  it('never overwrites a Word template or an A4 template with a linked Word replacement', async () => {
    const stale = {
      id: 'existing-template',
      tenantId: 'tenant-1',
      name: canonicalDefinition.name,
      description: 'customised',
      category: 'RESOLUTION',
      compositionType: 'STANDARD',
      content: '<p>customised</p>',
      contentJson: null,
      placeholders: [],
      isActive: true,
      deletedAt: null,
      version: 4,
    };
    const word = templateRepository({ ...stale, contentJson: { oakDoc: { schemaVersion: 1 } } });
    await ensureSeededDocumentTemplate(word.transaction, 'tenant-1', 'user-1', canonicalDefinition);
    expect(word.record).toMatchObject({ content: '<p>customised</p>', version: 4 });

    const linked = templateRepository(stale, { id: 'word-replacement' });
    await ensureSeededDocumentTemplate(linked.transaction, 'tenant-1', 'user-1', canonicalDefinition);
    expect(linked.record).toMatchObject({ content: '<p>customised</p>', version: 4 });
  });

  it('creates a fresh template with its canonical content and layout', async () => {
    const repository = templateRepository(null);

    await ensureSeededDocumentTemplate(
      repository.transaction,
      'tenant-1',
      'user-1',
      canonicalDefinition,
    );

    expect(repository.record).toMatchObject({
      id: 'created-template',
      tenantId: 'tenant-1',
      createdById: 'user-1',
      ...canonicalDefinition,
      isActive: true,
      deletedAt: null,
      version: 1,
    });
  });

  it('does not increment the version when every canonical field already matches', async () => {
    const repository = templateRepository({
      id: 'existing-template',
      tenantId: 'tenant-1',
      createdById: 'user-1',
      ...canonicalDefinition,
      isActive: true,
      deletedAt: null,
      version: 7,
    });

    await ensureSeededDocumentTemplate(
      repository.transaction,
      'tenant-1',
      'user-1',
      canonicalDefinition,
    );

    expect(repository.record).toMatchObject({ version: 7 });
  });
});

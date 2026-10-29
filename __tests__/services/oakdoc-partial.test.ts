// @vitest-environment node
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  templatePartial: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const objects = vi.hoisted(() => new Map<string, Buffer>());
const storageMock = vi.hoisted(() => ({
  upload: vi.fn(async (key: string, body: Buffer) => { objects.set(key, Buffer.from(body)); }),
  download: vi.fn(async (key: string) => {
    const value = objects.get(key);
    if (!value) throw new Error('missing');
    return value;
  }),
  delete: vi.fn(),
}));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: storageMock,
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn(async () => undefined) }));

import {
  createOakDocPartial,
  expandPinnedOakDocPartials,
  pinOakDocPartials,
  updateOakDocPartial,
  type OakDocPartialPin,
} from '@/services/oakdoc-partial.service';
import { oakDocPartialTag } from '@/lib/document-editor/oakdoc-partials';

const tenantId = 'tenant-1';
const actor = { tenantId, userId: 'user-1' };
const P = '11111111-1111-4111-8111-111111111111';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(body: string): Buffer {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr/></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
  }));
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const reference = (id: string) => `<w:sdt><w:sdtPr><w:tag w:val="${oakDocPartialTag(id)}"/></w:sdtPr><w:sdtContent>${paragraph('[partial]')}</w:sdtContent></w:sdt>`;

let rows: Map<string, Record<string, any>>;

beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  rows = new Map();
  prismaMock.templatePartial.findMany.mockImplementation(async ({ where }: any) =>
    Array.from(rows.values()).filter((row) => where.id.in.includes(row.id) && row.tenantId === where.tenantId && !row.deletedAt));
  prismaMock.templatePartial.findFirst.mockImplementation(async ({ where }: any) => {
    if (where.name) return Array.from(rows.values()).find((row) => row.name === where.name) ?? null;
    const row = rows.get(where.id);
    return row && row.tenantId === where.tenantId ? row : null;
  });
  prismaMock.templatePartial.findFirstOrThrow.mockImplementation(async ({ where }: any) => rows.get(where.id));
  prismaMock.templatePartial.create.mockImplementation(async ({ data }: any) => {
    const row = { version: 1, deletedAt: null, ...data };
    rows.set(row.id, row);
    return row;
  });
  prismaMock.templatePartial.updateMany.mockImplementation(async ({ where, data }: any) => {
    const row = rows.get(where.id);
    if (!row || row.version !== where.version) return { count: 0 };
    rows.set(where.id, { ...row, ...data, version: row.version + 1 });
    return { count: 1 };
  });
  prismaMock.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(prismaMock));
});

async function seedPartial(text: string) {
  return createOakDocPartial({ id: P, name: 'scope', fileName: 'scope.docx', buffer: docx(paragraph(text)) }, actor);
}

describe('native partials', () => {
  it('stores each version under its own hash and keeps older versions for pinned templates', async () => {
    await seedPartial('Version one');
    const firstKey = rows.get(P)!.contentJson.oakDoc.storageKey;
    expect(firstKey.startsWith(`${tenantId}/template-partials/${P}/oakdoc/`)).toBe(true);

    await updateOakDocPartial({ id: P, expectedRevision: 1, fileName: 'scope.docx', buffer: docx(paragraph('Version two')) }, actor);
    expect(rows.get(P)!.version).toBe(2);
    expect(rows.get(P)!.contentJson.oakDoc.storageKey).not.toBe(firstKey);
    expect(objects.has(firstKey)).toBe(true);
    expect(storageMock.delete).not.toHaveBeenCalled();

    await expect(updateOakDocPartial({ id: P, expectedRevision: 1, fileName: 'scope.docx', buffer: docx(paragraph('Stale')) }, actor))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('keeps a template on its pinned version until the pin is refreshed', async () => {
    await seedPartial('Version one');
    const master = new Uint8Array(docx(reference(P)));
    const pins = await pinOakDocPartials({ bytes: master, tenantId });
    expect(pins).toMatchObject([{ partialId: P, version: 1 }]);

    await updateOakDocPartial({ id: P, expectedRevision: 1, fileName: 'scope.docx', buffer: docx(paragraph('Version two')) }, actor);
    const kept = await pinOakDocPartials({ bytes: master, tenantId, existingPins: pins });
    expect(kept).toEqual(pins);

    const expanded = await expandPinnedOakDocPartials({ bytes: master, pins: kept, tenantId });
    const text = strFromU8(unzipSync(expanded.bytes)['word/document.xml']);
    expect(text).toContain('Version one');
    expect(text).not.toContain('Version two');

    const refreshed = await pinOakDocPartials({ bytes: master, tenantId, existingPins: pins, refresh: 'all' });
    expect(refreshed).toMatchObject([{ partialId: P, version: 2 }]);
    const latest = await expandPinnedOakDocPartials({ bytes: master, pins: refreshed, tenantId });
    expect(strFromU8(unzipSync(latest.bytes)['word/document.xml'])).toContain('Version two');
  });

  it('refuses missing, HTML-only and self-referencing partials', async () => {
    const master = new Uint8Array(docx(reference(P)));
    await expect(pinOakDocPartials({ bytes: master, tenantId }))
      .rejects.toMatchObject({ details: { reason: 'OAKDOC_PARTIAL_MISSING', partialIds: [P] } });

    rows.set(P, { id: P, tenantId, version: 3, contentJson: null, deletedAt: null });
    await expect(pinOakDocPartials({ bytes: master, tenantId }))
      .rejects.toMatchObject({ details: { reason: 'OAKDOC_PARTIAL_MISSING' } });

    await expect(pinOakDocPartials({ bytes: master, tenantId, selfPartialId: P }))
      .rejects.toMatchObject({ details: { reason: 'OAKDOC_PARTIAL_CYCLE' } });
  });

  it('never expands bytes that fail integrity or tenant scope checks', async () => {
    await seedPartial('Version one');
    const master = new Uint8Array(docx(reference(P)));
    const [pin] = await pinOakDocPartials({ bytes: master, tenantId });

    objects.set(pin.storageKey, docx(paragraph('Tampered')));
    await expect(expandPinnedOakDocPartials({ bytes: master, pins: [pin], tenantId }))
      .rejects.toMatchObject({ details: { reason: 'OAKDOC_PARTIAL_INTEGRITY' } });

    const foreign: OakDocPartialPin = { ...pin, storageKey: `other-tenant/template-partials/${P}/oakdoc/${pin.sha256}.docx` };
    await expect(expandPinnedOakDocPartials({ bytes: master, pins: [foreign], tenantId }))
      .rejects.toMatchObject({ details: { reason: 'OAKDOC_PARTIAL_SCOPE_INVALID' } });
  });

  it('rejects a partial package with content that cannot be inserted elsewhere', async () => {
    const buffer = Buffer.from(zipSync({
      ...unzipSync(new Uint8Array(docx('<w:p><w:r><w:object r:id="rIdOle"/></w:r></w:p>'))),
      'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/x.bin"/></Relationships>'),
    }));
    await expect(createOakDocPartial({ id: P, name: 'ole', fileName: 'ole.docx', buffer }, actor))
      .rejects.toMatchObject({ details: { reason: 'OAKDOC_PARTIAL_UNSUPPORTED' } });
    expect(rows.size).toBe(0);
  });
});

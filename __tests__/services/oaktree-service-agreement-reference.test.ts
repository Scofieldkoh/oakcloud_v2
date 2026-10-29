// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOaktreeServiceAgreementReferenceOakDoc } from '@/content/service-agreement/oaktree-service-agreement-reference-oakdoc';
import {
  REFERENCE_SOW_PARTIALS,
  buildCorporateSecretarialSowOakDoc,
  buildFinancialStatementsTaxSowOakDoc,
} from '@/content/service-agreement/oaktree-service-agreement-reference-sows';
import {
  REFERENCE_TERMS,
  REFERENCE_WORDING_CORRECTIONS,
} from '@/content/service-agreement/oaktree-service-agreement-reference-wording';
import { classifyOakDocTag } from '@/lib/document-editor/oakdoc-field-registry';
import { encodeOakDocSowSnapshot } from '@/lib/document-editor/oakdoc-partials';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import { OAKDOC_SIGNATURE_TAGS } from '@/lib/document-editor/oakdoc-signatures';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement/types';

/*
 * The reference-layout master reproduces the approved agreement's page,
 * typography, tables and keep-together rules. All client data here is
 * fictional; the reference agreement itself is never stored in the repo.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const master = buildOaktreeServiceAgreementReferenceOakDoc();

const templateRow = {
  id: 'template-reference',
  name: 'Oaktree Master Services Agreement (OakDoc)',
  version: 1,
  compositionType: 'SERVICE_AGREEMENT',
  contentJson: {
    oakDoc: {
      schemaVersion: 1,
      storageKey: 'tenant-1/templates/oakdoc/assets/reference.docx',
      fileName: 'reference.docx',
      fileSize: master.byteLength,
      sha256: createHash('sha256').update(master).digest('hex'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: [],
    },
  },
};

const PREPARER_ID = '77777777-7777-4777-8777-777777777777';
const getServiceAgreementDraftById = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentTemplate: { findFirst: vi.fn(async () => templateRow) },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (
        where.id === PREPARER_ID ? { firstName: 'Robin', lastName: 'Teo' } : null
      )),
    },
  },
}));
vi.mock('@/services/company.service', () => ({
  getCompanyById: vi.fn(async () => ({
    id: 'company-1',
    name: 'Example Holdings Pte. Ltd.',
    uen: '202600001A',
    addresses: [{
      addressType: 'REGISTERED_OFFICE',
      block: '10',
      streetName: 'Sample Street 1',
      level: '02',
      unit: '34',
      buildingName: 'Sample Court',
      postalCode: '123456',
      country: 'Singapore',
      isCurrent: true,
    }],
    officers: [],
    shareholders: [],
  })),
}));
vi.mock('@/services/oakdoc-template.service', () => ({
  downloadOakDocTemplate: vi.fn(async () => ({
    buffer: Buffer.from(master),
    metadata: templateRow.contentJson.oakDoc,
  })),
}));
// Word scopes come from storage in the app; here they are built in memory.
const wordScopes = new Map<string, Uint8Array>();
vi.mock('@/services/oakdoc-partial.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/oakdoc-partial.service')>();
  const { expandOakDocPartials } = await import('@/lib/document-editor/oakdoc-partials');
  return {
    ...actual,
    expandPinnedOakDocPartials: async (input: { bytes: Uint8Array; pins: Array<{ partialId: string }> }) =>
      input.pins.length === 0
        ? { bytes: input.bytes, diagnostics: [], expanded: [] }
        : expandOakDocPartials({ docxBytes: input.bytes, fragments: wordScopes }),
  };
});
vi.mock('@/services/service-agreement/draft.service', () => ({
  getServiceAgreementDraftById: (...args: unknown[]) => getServiceAgreementDraftById(...args),
}));

const { generateOakDocBytes } = await import('@/services/oakdoc-generation.service');

function parse(bytes: Uint8Array, part = 'word/document.xml'): Document {
  return new DOMParser().parseFromString(strFromU8(unzipSync(bytes)[part]), 'application/xml');
}

function all(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(W, name));
}

function child(element: Element | undefined, name: string): Element | undefined {
  return element
    ? Array.from(element.childNodes).find(
      (node): node is Element => node.nodeType === 1 && (node as Element).localName === name,
    )
    : undefined;
}

function val(element: Element | undefined, name = 'val'): string | null {
  return element?.getAttributeNS(W, name) ?? null;
}

function text(element: Element): string {
  return all(element, 't').map((node) => node.textContent ?? '').join('');
}

function bodyParagraphs(document: Document): Element[] {
  return all(document, 'p');
}

function tags(document: Document): string[] {
  return all(document, 'tag').map((tag) => val(tag) ?? '');
}

function fee(id: string, entityId: string, description: string, amount: string, displayOrder = 0) {
  return {
    id,
    agreementEntityId: entityId,
    companyId: entityId === 'entity-1' ? 'company-1' : 'company-2',
    description,
    amount,
    currency: 'SGD',
    billingFrequency: 'ANNUALLY',
    customFrequencyLabel: null,
    billingStartDate: '2026-07-09',
    displayOrder,
  };
}

function item(id: string, name: string, displayOrder: number, feeLines: ReturnType<typeof fee>[]) {
  return {
    id,
    serviceVariantId: `variant-${id}`,
    variantVersion: 1,
    familyNameSnapshot: name,
    variantNameSnapshot: name,
    serviceCadence: 'ANNUALLY',
    customCadenceLabel: null,
    sowPartialId: `partial-${id}`,
    partialVersion: 1,
    partialContentSnapshot: `<p>${name} scope</p>`,
    partialPlaceholdersSnapshot: [],
    partialDependencySnapshot: [],
    startDate: '2026-07-09',
    endDate: null,
    fieldValues: {},
    displayOrder,
    entityIds: Array.from(new Set(feeLines.map((line) => line.agreementEntityId))),
    feeLines,
    staleVariantVersion: false,
    stalePartialVersion: false,
  };
}

function agreement(overrides: Partial<ServiceAgreementDraftDto> = {}): ServiceAgreementDraftDto {
  return {
    id: 'agreement-1',
    generatedDocumentId: 'document-1',
    primaryCompanyId: 'company-1',
    authorizedContactIds: ['contact-1', 'contact-2'],
    signerContactIds: ['contact-1'],
    authorizedRepresentativeSnapshots: [
      { id: 'contact-1', name: 'Jamie Lim', role: 'Director', email: 'jamie@example.com', phone: '+65 6000 0001' },
      { id: 'contact-2', name: 'Casey Ng', role: 'Finance Manager', email: null, phone: '+65 6000 0002' },
    ],
    agreementDate: '2026-07-09',
    effectiveDate: null,
    termMonths: 12,
    status: 'DRAFT',
    entities: [
      { id: 'entity-1', companyId: 'company-1', nameSnapshot: 'Example Holdings Pte. Ltd.', uenSnapshot: '202600001A', displayOrder: 0 },
      { id: 'entity-2', companyId: 'company-2', nameSnapshot: 'Example Trading Pte. Ltd.', uenSnapshot: '202600002B', displayOrder: 1 },
    ],
    items: [
      item('cs', 'Corporate Secretarial Services', 0, [
        fee('fee-1', 'entity-1', 'Corporate Secretarial Services', '1500.00'),
        fee('fee-2', 'entity-2', 'Corporate Secretarial Services', '1200.00'),
      ]),
      item('fs', 'Unaudited Financial Statements and Corporate Tax Services', 1, [
        fee('fee-3', 'entity-1', 'Unaudited financial statements', '2500.00', 0),
        fee('fee-4', 'entity-1', 'Corporate income tax filing', '800.50', 1),
      ]),
    ],
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  } as ServiceAgreementDraftDto;
}

async function generate(draft = agreement(), generatedBy: string = PREPARER_ID) {
  getServiceAgreementDraftById.mockResolvedValue(draft);
  return generateOakDocBytes({
    templateId: 'template-reference',
    companyId: 'company-1',
    serviceAgreementId: 'agreement-1',
    generatedBy,
  }, { tenantId: 'tenant-1' });
}

beforeEach(() => getServiceAgreementDraftById.mockReset());

describe('reference-layout master', () => {
  const document = parse(master);

  it('is a valid master package', () => {
    expect(() => inspectOakDocPackage(master, 'master')).not.toThrow();
  });

  it('uses the reference page: A4, 1-inch margins and no header or footer', () => {
    const sections = all(document, 'sectPr');
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      const size = child(section, 'pgSz');
      const margin = child(section, 'pgMar');
      expect([val(size, 'w'), val(size, 'h')]).toEqual(['11910', '16840']);
      expect(['top', 'right', 'bottom', 'left'].map((side) => val(margin, side))).toEqual(['1440', '1440', '1440', '1440']);
      expect(child(section, 'headerReference')).toBeUndefined();
      expect(child(section, 'footerReference')).toBeUndefined();
    }
    const files = Object.keys(unzipSync(master));
    expect(files.some((file) => /header|footer/.test(file))).toBe(false);
  });

  it('writes every run in black 10 pt Arial', () => {
    const runs = all(document, 'r').filter((runElement) => child(runElement, 't'));
    expect(runs.length).toBeGreaterThan(200);
    for (const runElement of runs) {
      const properties = child(runElement, 'rPr');
      const fonts = child(properties, 'rFonts');
      expect(val(fonts, 'ascii')).toBe('Arial');
      expect(val(child(properties, 'sz'))).toBe('20');
    }
    const styles = parse(master, 'word/styles.xml');
    expect(strFromU8(unzipSync(master)['word/styles.xml'])).not.toMatch(/Aptos|Carlito/);
    expect(all(styles, 'style').length).toBeGreaterThan(5);
  });

  it('keeps headings with their text and ends every keep chain', () => {
    const paragraphs = bodyParagraphs(document);
    const keepNext = paragraphs.filter((p) => {
      const flag = child(child(p, 'pPr'), 'keepNext');
      return flag && val(flag) !== '0';
    });
    expect(keepNext.length).toBeGreaterThan(20);
    // A chain that never ends would drag the rest of the document with it.
    let run = 0;
    let longest = 0;
    for (const p of paragraphs) {
      const flag = child(child(p, 'pPr'), 'keepNext');
      run = flag && val(flag) !== '0' ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(12);
    expect(all(document, 'cantSplit').length).toBeGreaterThan(0);
    expect(all(document, 'tblHeader').length).toBeGreaterThan(0);
  });

  it('carries the verbatim terms and every signature marker', () => {
    const body = text(document.documentElement);
    for (const group of REFERENCE_TERMS) {
      expect(body).toContain(group.heading);
    }
    const tagList = tags(document);
    expect(OAKDOC_SIGNATURE_TAGS.size).toBe(4);
    for (const signatureTag of OAKDOC_SIGNATURE_TAGS) {
      expect(tagList).toContain(signatureTag);
    }
  });

  it('uses only field tags the registry understands', () => {
    const unknown = tags(document).filter((tag) => classifyOakDocTag(tag) === 'unknown');
    expect(unknown).toEqual([]);
  });

  it('applies the approved wording corrections', () => {
    const body = text(document.documentElement);
    expect(REFERENCE_WORDING_CORRECTIONS).toHaveLength(8);
    for (const correction of REFERENCE_WORDING_CORRECTIONS) {
      if (correction.location.includes('Corporate Secretarial')) continue;
      expect(body).toContain(correction.corrected);
      if (!correction.corrected.includes(correction.asWritten)) expect(body).not.toContain(correction.asWritten);
    }
    const scope = text(parse(buildCorporateSecretarialSowOakDoc()).documentElement);
    expect(scope).toContain('based on the time required and we will provide');
  });
});

describe('reference scope-of-work partials', () => {
  it('builds Word scopes with lettered lists and square register bullets', () => {
    const secretarial = buildCorporateSecretarialSowOakDoc();
    const numbering = strFromU8(unzipSync(secretarial)['word/numbering.xml']);
    expect(numbering).toContain('w:val="lowerLetter"');
    expect(numbering).toContain('Wingdings');
    expect(numbering).toContain('w:val="%1)"');
    const document = parse(secretarial);
    expect(text(document.documentElement)).toContain('Corporate Secretarial Services');
    expect(all(document, 'headerReference')).toEqual([]);
  });

  it('restarts the lettering under each tax subsection', () => {
    const numbering = parse(buildFinancialStatementsTaxSowOakDoc(), 'word/numbering.xml');
    expect(all(numbering, 'num').length).toBe(3);
    expect(REFERENCE_SOW_PARTIALS.map((partial) => partial.replacesPartialName)).toEqual([
      'service-agreement-corporate-secretarial-v1',
      'service-agreement-unaudited-fs-tax-v1',
    ]);
  });
});

describe('reference-layout generation', () => {
  it('generates without blocking diagnostics', async () => {
    const result = await generate();
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('writes long dates, the term in words and the effective date fallback', async () => {
    const result = await generate();
    const body = text(parse(new Uint8Array(result.bytes)).documentElement);
    expect(body).toContain('9 July 2026');
    expect(body).not.toContain('9 Jul 2026');
    expect(body).toContain('1 year');
    expect(result.values['agreement.effectiveDate']).toBe('9 Jul 2026');
  });

  it('signs for the firm as the preparer, whether given by id or by name', async () => {
    const byId = text(parse(new Uint8Array((await generate()).bytes)).documentElement);
    expect(byId.split('Robin Teo').length - 1).toBe(2);
    expect(byId).toContain('Oaktree Accounting and Corporate Solutions Pte Ltd');
    const byName = text(parse(new Uint8Array((await generate(agreement(), 'Sam Lee')).bytes)).documentElement);
    expect(byName.split('Sam Lee').length - 1).toBe(2);
    // Generates two agreements, which can exceed the default timeout under a full parallel run.
  }, 20_000);

  it('prints the letter address on separate lines, building first', async () => {
    const result = await generate();
    const document = parse(new Uint8Array(result.bytes));
    const addressParagraph = bodyParagraphs(document).find((p) => text(p).startsWith('Sample Court'));
    expect(addressParagraph).toBeDefined();
    expect(all(addressParagraph!, 'br').length).toBe(2);
    expect(text(addressParagraph!)).toContain('10 Sample Street 1, #02-34');
  });

  it('links representative emails and puts phones on the line below', async () => {
    const result = await generate();
    const xml = strFromU8(unzipSync(new Uint8Array(result.bytes))['word/document.xml']);
    expect(xml).toContain('HYPERLINK "mailto:jamie@example.com"');
    const body = text(parse(new Uint8Array(result.bytes)).documentElement);
    const cell = all(parse(new Uint8Array(result.bytes)), 'tc').find((element) => text(element).startsWith('jamie@example.com'))!;
    expect(all(cell, 'p').map(text)).toEqual(['jamie@example.com', '+65 6000 0001']);
    expect(body).not.toContain(' / +65');
    expect(body).toContain('+65 6000 0002');
    expect(xml).not.toContain('mailto:"');
  });

  it('lists every company, SOW and charge in one centred SOW/Amount table', async () => {
    const result = await generate();
    const document = parse(new Uint8Array(result.bytes));
    const feeTables = all(document, 'tbl').filter((table) => {
      const header = all(table, 'tr')[0];
      return header && text(header) === 'SOWAmount';
    });
    expect(feeTables).toHaveLength(1);

    const rows = all(feeTables[0], 'tr').slice(1).map((row) => all(row, 'tc').map(text));
    expect(rows).toEqual([
      ['', ''],
      ['Example Holdings Pte. Ltd.:', ''],
      ['Statement of Work – Corporate Secretarial Services', ''],
      ['Corporate Secretarial Services', 'S$1,500 per year'],
      ['Statement of Work – Unaudited Financial Statements and Corporate Tax Services', ''],
      ['Unaudited financial statements', 'S$2,500 per year'],
      ['Corporate income tax filing', 'S$800.50 per year'],
      ['', ''],
      ['Example Trading Pte. Ltd.:', ''],
      ['Statement of Work – Corporate Secretarial Services', ''],
      ['Corporate Secretarial Services', 'S$1,200 per year'],
      ['', ''],
    ]);
    for (const cell of all(feeTables[0], 'tc')) {
      expect(val(child(child(cell, 'tcPr'), 'vAlign'))).toBe('center');
    }
    const companyRun = all(feeTables[0], 'r').find((runElement) => text(runElement) === 'Example Holdings Pte. Ltd.');
    expect(child(child(companyRun!, 'rPr'), 'u')).toBeDefined();
    expect(tags(document).filter((tag) => tag.startsWith('agreement.feeTable.'))).toEqual([]);
  });

  it('keeps the company row for a single-company agreement', async () => {
    const draft = agreement();
    const result = await generate({
      ...draft,
      entities: draft.entities.slice(0, 1),
      items: draft.items.map((entry) => ({
        ...entry,
        feeLines: entry.feeLines.filter((line) => line.agreementEntityId === 'entity-1'),
      })),
    } as ServiceAgreementDraftDto);
    const headings = bodyParagraphs(parse(new Uint8Array(result.bytes))).map(text);
    expect(headings).toContain('Example Holdings Pte. Ltd.:');
    expect(headings).not.toContain('Example Trading Pte. Ltd.:');
  });

  it('lists each entity with its UEN in the appendix', async () => {
    const result = await generate();
    const body = bodyParagraphs(parse(new Uint8Array(result.bytes))).map(text);
    expect(body).toContain('Example Holdings Pte. Ltd. (UEN: 202600001A)');
    expect(body).toContain('Example Trading Pte. Ltd. (UEN: 202600002B)');
  });

  it('merges the Word scopes with their own lettered lists and bullets', async () => {
    const scopes = [buildCorporateSecretarialSowOakDoc(), buildFinancialStatementsTaxSowOakDoc()];
    const draft = agreement();
    const items = draft.items.map((entry, index) => {
      const partialId = `9999999${index}-0000-4000-8000-000000000000`;
      wordScopes.set(partialId, scopes[index]);
      return {
        ...entry,
        partialContentSnapshot: encodeOakDocSowSnapshot({
          pin: {
            partialId,
            version: 1,
            sha256: createHash('sha256').update(scopes[index]).digest('hex'),
            storageKey: `tenant-1/partials/${partialId}.docx`,
            nested: [],
          },
          fieldTags: [],
        }),
      };
    });
    const result = await generate({ ...draft, items } as ServiceAgreementDraftDto);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

    const bytes = new Uint8Array(result.bytes);
    const document = parse(bytes);
    const paragraphs = bodyParagraphs(document);
    const titles = paragraphs.filter((p) => val(child(child(p, 'pPr'), 'pStyle')) === 'Heading1');
    const scopeTitles = titles.filter((p) => text(p).startsWith('Statement of Work – '));
    expect(scopeTitles).toHaveLength(2);
    for (const title of scopeTitles) {
      expect(child(child(title, 'pPr'), 'pageBreakBefore')).toBeDefined();
    }
    const numbering = strFromU8(unzipSync(bytes)['word/numbering.xml']);
    expect(numbering).toContain('lowerLetter');
    expect(numbering).toContain('Wingdings');
    expect(tags(document).filter((tag) => tag.startsWith('oakdoc.partial:'))).toEqual([]);
  });

  it('starts every service on a new page without a blank first line', async () => {
    const result = await generate();
    const document = parse(new Uint8Array(result.bytes));
    for (const name of ['Corporate Secretarial Services scope', 'Unaudited Financial Statements and Corporate Tax Services scope']) {
      const index = bodyParagraphs(document).findIndex((p) => text(p) === name);
      expect(index).toBeGreaterThan(-1);
    }
    const breaks = bodyParagraphs(document).filter((p) => child(child(p, 'pPr'), 'pageBreakBefore'));
    expect(breaks.every((p) => text(p).trim().length > 0)).toBe(true);
  });
});

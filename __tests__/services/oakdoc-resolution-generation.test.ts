// @vitest-environment node
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBoardResolutionOakDocMaster, buildMembersResolutionOakDocMaster } from '@/content/resolution/board-resolution-oakdoc';
import { deriveOakDocTemplateFieldTags } from '@/lib/document-editor/oakdoc-field-manifest';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import { ensureA4ServerDomGlobals } from '@/lib/document-editor/a4-server-dom';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import { writeOakDocRepeaterSections } from '@/lib/document-editor/oakdoc-custom-fields';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: { findFirst: vi.fn() },
  templatePartial: { findMany: vi.fn(async () => [] as unknown[]) },
  user: { findFirst: vi.fn() },
  contact: { findMany: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const storageMock = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: storageMock,
}));

const companyMock = vi.hoisted(() => ({ getCompanyById: vi.fn() }));
vi.mock('@/services/company.service', () => companyMock);

const templateMock = vi.hoisted(() => ({ downloadOakDocTemplate: vi.fn() }));
vi.mock('@/services/oakdoc-template.service', () => templateMock);

const { generateOakDocBytes, previewOakDocMaster } = await import('@/services/oakdoc-generation.service');

ensureA4ServerDomGlobals();
const tenantId = 'tenant-1';
const partialId = '33333333-3333-4333-8333-333333333333';
const master = buildBoardResolutionOakDocMaster();
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const asset = {
  schemaVersion: 1,
  storageKey: `${tenantId}/templates/oakdoc/assets/board.docx`,
  fileName: 'Board.docx',
  fileSize: master.byteLength,
  sha256: sha(master),
  mimeType: OAKDOC_MIME_TYPE,
  fieldTags: deriveOakDocTemplateFieldTags(master),
};
const stored = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Board Resolution (Numbered)',
  version: 1,
  contentJson: { oakDoc: asset },
  compositionType: 'RESOLUTION',
};

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const partialBytes = zipSync({
  '[Content_Types].xml': encodeOakDocZipText('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': encodeOakDocZipText('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': encodeOakDocZipText(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>RESOLVED that all necessary documents be lodged with ACRA.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`),
  'word/_rels/document.xml.rels': encodeOakDocZipText('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
});
const partialKey = `${tenantId}/template-partials/${partialId}/oakdoc/${sha(partialBytes)}.docx`;

function documentText(bytes: Uint8Array): string {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g), (match) => match[1] ?? '\t').join('');
}

const context = { companyId: 'company-1', generatedBy: 'Test User', resolutionDate: '2026-07-09' };

describe('Resolution template generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.documentTemplate.findFirst.mockResolvedValue(stored);
    prismaMock.templatePartial.findMany.mockResolvedValue([{
      id: partialId,
      version: 3,
      contentJson: {
        oakDoc: { ...asset, storageKey: partialKey, sha256: sha(partialBytes), fileSize: partialBytes.byteLength, fieldTags: [] },
      },
    }]);
    storageMock.download.mockResolvedValue(Buffer.from(partialBytes));
    companyMock.getCompanyById.mockResolvedValue({
      id: 'company-1',
      name: '96 Fruit Avenue Pte. Ltd.',
      uen: '202425961Z',
      addresses: [],
      officers: [],
      shareholders: [],
    });
    templateMock.downloadOakDocTemplate.mockResolvedValue({ buffer: Buffer.from(master), metadata: asset });
  });

  it('numbers custom and partial resolutions in the order chosen', async () => {
    const result = await generateOakDocBytes({
      templateId: stored.id,
      ...context,
      resolution: {
        subject: 'CHANGE IN COMPANY SECRETARY',
        sections: [
          { id: 'a', kind: 'CUSTOM', heading: 'APPOINTMENT OF SECRETARY', body: 'RESOLVED that Tan Wei Jie be appointed as Secretary.' },
          { id: 'b', kind: 'PARTIAL', heading: 'NOTIFICATION AND LODGEMENT', partialId },
        ],
      },
    }, { tenantId });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    const text = documentText(result.bytes);
    expect(text).toContain('96 Fruit Avenue Pte. Ltd.');
    expect(text).toContain('CHANGE IN COMPANY SECRETARY1.\tAPPOINTMENT OF SECRETARYRESOLVED that Tan Wei Jie be appointed as Secretary.2.\tNOTIFICATION AND LODGEMENTRESOLVED that all necessary documents be lodged with ACRA.');
    expect(text).toContain('Dated this 9 day of July, 2026');
    expect(text).not.toContain('Numbered resolutions');
    expect(result.resolutionPartialPins).toEqual([expect.objectContaining({ partialId, version: 3 })]);
  });

  it('fills the custom fields of a chosen partial with their types', async () => {
    const field = (tag: string) => `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent><w:r><w:t>{{${tag}}}</w:t></w:r></w:sdtContent></w:sdt>`;
    const feeBytes = zipSync({
      ...unzipSync(partialBytes),
      'word/document.xml': encodeOakDocZipText(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">RESOLVED that a fee of S$</w:t></w:r>${field('custom.fee')}<w:r><w:t xml:space="preserve"> be paid on </w:t></w:r>${field('custom.pay_date')}<w:r><w:t>.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`),
    });
    const feeKey = `${tenantId}/template-partials/${partialId}/oakdoc/${sha(feeBytes)}.docx`;
    prismaMock.templatePartial.findMany.mockResolvedValue([{
      id: partialId,
      version: 4,
      contentJson: {
        oakDoc: { ...asset, storageKey: feeKey, sha256: sha(feeBytes), fileSize: feeBytes.byteLength, fieldTags: ['custom.fee', 'custom.pay_date'] },
      },
      placeholders: [
        { key: 'custom.fee', path: 'custom.fee', label: 'Fee', type: 'currency', source: 'custom', category: 'custom', required: true },
        { key: 'custom.pay_date', path: 'custom.pay_date', label: 'Pay date', type: 'date', source: 'custom', category: 'custom', required: true },
      ],
    }]);
    storageMock.download.mockResolvedValue(Buffer.from(feeBytes));

    const result = await generateOakDocBytes({
      templateId: stored.id,
      ...context,
      customData: { fee: '2500', pay_date: '2026-11-03' },
      resolution: {
        subject: '',
        sections: [{ id: 'a', kind: 'PARTIAL', heading: 'DIRECTORS FEE', partialId }],
      },
    }, { tenantId });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'OAKDOC_CUSTOM_FIELD_UNDEFINED')).toEqual([]);
    expect(documentText(result.bytes)).toContain('RESOLVED that a fee of S$2,500.00 be paid on 3 Nov 2026.');
  });

  it('prints the name and details of the contact picked for a Contact field', async () => {
    const field = (tag: string) => `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent><w:r><w:t>{{${tag}}}</w:t></w:r></w:sdtContent></w:sdt>`;
    const tags = ['custom.secretary', 'custom.secretary.identificationNumber', 'custom.secretary.nationality'];
    const secretaryBytes = zipSync({
      ...unzipSync(partialBytes),
      'word/document.xml': encodeOakDocZipText(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">RESOLVED that </w:t></w:r>${field(tags[0])}<w:r><w:t xml:space="preserve"> (</w:t></w:r>${field(tags[1])}<w:r><w:t xml:space="preserve">, </w:t></w:r>${field(tags[2])}<w:r><w:t>) be appointed as Secretary.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`),
    });
    const secretaryKey = `${tenantId}/template-partials/${partialId}/oakdoc/${sha(secretaryBytes)}.docx`;
    prismaMock.templatePartial.findMany.mockResolvedValue([{
      id: partialId,
      version: 5,
      contentJson: {
        oakDoc: { ...asset, storageKey: secretaryKey, sha256: sha(secretaryBytes), fileSize: secretaryBytes.byteLength, fieldTags: tags },
      },
      placeholders: [{
        key: 'custom.secretary',
        path: 'custom.secretary',
        label: 'Secretary',
        type: 'text',
        fieldKind: 'contact',
        options: [{ value: 'contact-1', label: 'Tan Wei Jie' }, { value: 'contact-2', label: 'Lim Mei Ling' }],
        source: 'custom',
        category: 'custom',
        required: true,
      }],
    }]);
    storageMock.download.mockResolvedValue(Buffer.from(secretaryBytes));
    prismaMock.contact.findMany.mockResolvedValue([{
      id: 'contact-2',
      fullName: 'Lim Mei Ling',
      contactType: 'INDIVIDUAL',
      fullAddress: null,
      identificationNumber: 'S7654321B',
      nationality: 'Singaporean',
      contactDetails: [],
      companyRelations: [],
      officerPositions: [],
    }]);
    const generate = (secretary: string) => generateOakDocBytes({
      templateId: stored.id,
      ...context,
      customData: { secretary },
      resolution: {
        subject: '',
        sections: [{ id: 'a', kind: 'PARTIAL', heading: 'APPOINTMENT OF SECRETARY', partialId }],
      },
    }, { tenantId });

    const result = await generate('contact-2');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'OAKDOC_CUSTOM_FIELD_UNDEFINED')).toEqual([]);
    expect(documentText(result.bytes)).toContain('RESOLVED that Lim Mei Ling (S7654321B, Singaporean) be appointed as Secretary.');
    expect(prismaMock.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['contact-2'] }, tenantId }),
    }));

    // A contact that is not on the field's shortlist is never looked up.
    prismaMock.contact.findMany.mockClear();
    const outside = await generate('contact-9');
    expect(prismaMock.contact.findMany).not.toHaveBeenCalled();
    expect(documentText(outside.bytes)).toContain('RESOLVED that  (, ) be appointed as Secretary.');
  });

  it('prints a partial\'s officers of its roles and only its shortlisted contacts', async () => {
    const field = (tag: string) => `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent><w:r><w:t>{{${tag}}}</w:t></w:r></w:sdtContent></w:sdt>`;
    const repeater = (tag: string, body: string) => `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w15:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w15:repeatingSectionItem/></w:sdtPr><w:sdtContent>${body}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
    const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
    const bytes = zipSync({
      ...unzipSync(partialBytes),
      'word/document.xml': encodeOakDocZipText(`<w:document xmlns:w="${W}" xmlns:w15="${W15}"><w:body>`
        + repeater('repeat.officers.secretary', `<w:p><w:r><w:t xml:space="preserve">Secretary: </w:t></w:r>${field('officer.name')}</w:p>`)
        + repeater('repeat.contacts', `<w:p><w:r><w:t xml:space="preserve">Copy to: </w:t></w:r>${field('contact.name')}</w:p>`)
        + '<w:sectPr/></w:body></w:document>'),
    });
    const tags = deriveOakDocTemplateFieldTags(bytes);
    expect(tags).toEqual(expect.arrayContaining(['repeat.officers.secretary', 'repeat.contacts']));
    prismaMock.templatePartial.findMany.mockResolvedValue([{
      id: partialId,
      version: 6,
      contentJson: {
        oakDoc: { ...asset, storageKey: `${tenantId}/template-partials/${partialId}/oakdoc/${sha(bytes)}.docx`, sha256: sha(bytes), fileSize: bytes.byteLength, fieldTags: tags },
      },
      placeholders: [{
        key: 'repeat.contacts',
        path: 'repeat.contacts',
        label: 'Contacts shortlist',
        type: 'text',
        source: 'repeater',
        category: 'repeater',
        fieldKind: 'contactShortlist',
        options: [{ value: 'contact-1', label: 'Tan Wei Jie' }, { value: 'contact-2', label: 'Lim Mei Ling' }],
      }],
    }]);
    storageMock.download.mockResolvedValue(Buffer.from(bytes));
    companyMock.getCompanyById.mockResolvedValue({
      id: 'company-1',
      name: '96 Fruit Avenue Pte. Ltd.',
      uen: '202425961Z',
      addresses: [],
      officers: [
        { id: 'o1', name: 'Dana Director', role: 'DIRECTOR', isCurrent: true },
        { id: 'o2', name: 'Sam Secretary', role: 'SECRETARY', isCurrent: true },
      ],
      shareholders: [],
    });
    prismaMock.contact.findMany.mockResolvedValue([{
      id: 'contact-2',
      fullName: 'Lim Mei Ling',
      contactType: 'INDIVIDUAL',
      fullAddress: null,
      contactDetails: [],
      companyRelations: [],
      officerPositions: [],
    }]);

    const result = await generateOakDocBytes({
      templateId: stored.id,
      ...context,
      selectedOfficerIds: ['o1', 'o2'],
      contactIds: ['contact-9', 'contact-2'],
      resolution: {
        subject: '',
        sections: [{ id: 'a', kind: 'PARTIAL', heading: 'NOTICES', partialId }],
      },
    }, { tenantId });

    const text = documentText(result.bytes);
    // The master's directors still sign; the secretary repeater lists only secretaries.
    expect(text).toContain('Secretary: Sam SecretaryCopy to:');
    expect(text).toContain('Copy to: Lim Mei Ling');
    // A contact outside the shortlist is never looked up.
    expect(prismaMock.contact.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['contact-2'] }, tenantId }),
    }));
  });

  it("prints each of a partial's named contacts lists with only its own ticked contacts", async () => {
    const field = (tag: string) => `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent><w:r><w:t>{{${tag}}}</w:t></w:r></w:sdtContent></w:sdt>`;
    const repeater = (tag: string, label: string) => `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w15:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w15:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:r><w:t xml:space="preserve">${label}: </w:t></w:r>${field('contact.name')}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
    const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
    const bytes = zipSync({
      ...unzipSync(partialBytes),
      'word/document.xml': encodeOakDocZipText(`<w:document xmlns:w="${W}" xmlns:w15="${W15}"><w:body>`
        + repeater('repeat.contacts.corporate-secretary-to-be-appointed', 'New secretary')
        + repeater('repeat.contacts.auditor', 'Auditor')
        + repeater('repeat.contacts', 'Copy to')
        + '<w:sectPr/></w:body></w:document>'),
    });
    const tags = deriveOakDocTemplateFieldTags(bytes);
    expect(tags).toEqual(expect.arrayContaining(['repeat.contacts.corporate-secretary-to-be-appointed', 'repeat.contacts.auditor']));
    const secretaryTag = 'repeat.contacts.corporate-secretary-to-be-appointed';
    prismaMock.templatePartial.findMany.mockResolvedValue([{
      id: partialId,
      version: 7,
      contentJson: {
        oakDoc: { ...asset, storageKey: `${tenantId}/template-partials/${partialId}/oakdoc/${sha(bytes)}.docx`, sha256: sha(bytes), fileSize: bytes.byteLength, fieldTags: tags },
      },
      // As the Word partial editor saves them.
      placeholders: writeOakDocRepeaterSections([], {
        names: { [secretaryTag]: 'Corporate secretary to be appointed', 'repeat.contacts.auditor': 'Auditor' },
        shortlists: { [secretaryTag]: [{ id: 'contact-1', name: 'Tan Wei Jie' }, { id: 'contact-2', name: 'Lim Mei Ling' }] },
      }, tags),
    }]);
    storageMock.download.mockResolvedValue(Buffer.from(bytes));
    const row = (id: string, fullName: string) => ({
      id, fullName, contactType: 'INDIVIDUAL', fullAddress: null, contactDetails: [], companyRelations: [], officerPositions: [],
    });
    prismaMock.contact.findMany.mockResolvedValue([
      row('contact-1', 'Tan Wei Jie'),
      row('contact-2', 'Lim Mei Ling'),
      row('contact-3', 'Ong Audit'),
    ]);

    const result = await generateOakDocBytes({
      templateId: stored.id,
      ...context,
      contactIds: ['contact-1'],
      selectedContactListIds: {
        // contact-9 is not on this list's shortlist, so it is dropped.
        'corporate-secretary-to-be-appointed': ['contact-9', 'contact-2', 'contact-1'],
        // No shortlist: any contact.
        auditor: ['contact-3'],
      },
      resolution: {
        subject: '',
        sections: [{ id: 'a', kind: 'PARTIAL', heading: 'CHANGE OF OFFICERS', partialId }],
      },
    }, { tenantId });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    const text = documentText(result.bytes);
    expect(text).toContain('New secretary: Lim Mei LingNew secretary: Tan Wei JieAuditor: Ong AuditCopy to: Tan Wei Jie');
    expect(prismaMock.contact.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['contact-1', 'contact-2', 'contact-3'] }, tenantId }),
    }));
  });

  it('fills {field} tokens in custom resolution text', async () => {
    const result = await generateOakDocBytes({
      templateId: stored.id,
      ...context,
      resolution: {
        subject: '',
        sections: [{
          id: 'a',
          kind: 'CUSTOM',
          heading: 'REGISTERED OFFICE',
          body: 'RESOLVED that {company.name} (UEN {company.uen}) keep its {unknown.tag} office.',
        }],
      },
    }, { tenantId });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(documentText(result.bytes)).toContain('RESOLVED that 96 Fruit Avenue Pte. Ltd. (UEN 202425961Z) keep its {unknown.tag} office.');
  });

  it('generates the members resolution signed by every shareholder', async () => {
    const members = buildMembersResolutionOakDocMaster();
    const membersAsset = { ...asset, sha256: sha(members), fileSize: members.byteLength, fieldTags: deriveOakDocTemplateFieldTags(members) };
    prismaMock.documentTemplate.findFirst.mockResolvedValue({ ...stored, contentJson: { oakDoc: membersAsset } });
    templateMock.downloadOakDocTemplate.mockResolvedValue({ buffer: Buffer.from(members), metadata: membersAsset });
    companyMock.getCompanyById.mockResolvedValue({
      id: 'company-1',
      name: '96 Fruit Avenue Pte. Ltd.',
      uen: '202425961Z',
      addresses: [],
      officers: [],
      shareholders: [
        { id: 'sh-1', name: 'Mary Lee', shareholderType: 'INDIVIDUAL', isCurrent: true },
        { id: 'sh-2', name: 'Oak Holdings Pte. Ltd.', shareholderType: 'CORPORATE', isCurrent: true },
      ],
    });
    const result = await generateOakDocBytes({
      templateId: stored.id,
      ...context,
      resolution: { subject: '', sections: [{ id: 'a', kind: 'CUSTOM', heading: 'APPROVAL OF ACCOUNTS', body: 'RESOLVED that the accounts be approved.' }] },
    }, { tenantId });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    const text = documentText(result.bytes);
    expect(text).toContain('MEMBERS’ RESOLUTIONS IN WRITING PURSUANT TO SECTION 184A OF THE COMPANIES ACT 1967');
    expect(text).toContain('1.\tAPPROVAL OF ACCOUNTS');
    expect(text).toMatch(/Mary Lee[^]*Member[^]*Oak Holdings Pte\. Ltd\.[^]*Member/);
  });

  it('reports a resolution template generated without its resolutions', async () => {
    const result = await generateOakDocBytes({ templateId: stored.id, ...context }, { tenantId });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'This resolution template needs the resolutions chosen on Configure.',
    }));
  });

  it('blocks a custom resolution without text', async () => {
    const result = await generateOakDocBytes({
      templateId: stored.id,
      ...context,
      resolution: { subject: '', sections: [{ id: 'a', kind: 'CUSTOM', heading: 'APPOINTMENT', body: '  ' }] },
    }, { tenantId });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'Resolution 1 needs its text.',
    }));
  });

  it('previews sample resolutions in the editor', async () => {
    const preview = await previewOakDocMaster({
      ...context,
      bytes: new Uint8Array(master),
      fileName: 'Board.docx',
      compositionType: 'RESOLUTION',
    }, { tenantId });
    expect(preview.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(documentText(preview.bytes)).toContain('1.\tFIRST RESOLUTION');
  });
});

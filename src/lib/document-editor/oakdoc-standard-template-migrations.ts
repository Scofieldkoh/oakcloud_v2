import { createHash } from 'node:crypto';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import type { DocumentTemplateCategory } from '@/generated/prisma';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import {
  buildOakDocResolutionValues,
  type OakDocCompanyDetail,
} from '@/lib/document-editor/oakdoc-context';
import { resolveOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { resolveOakDocRepeaters } from '@/lib/document-editor/oakdoc-repeaters';

export interface OakDocLegacyFieldMapping {
  legacyField: string;
  oakDocTag: string;
  repeaterTag?: string;
}

export interface OakDocMigrationPlaceholderDefinition {
  key: string;
  path: string;
  type: 'text' | 'date' | 'number' | 'currency' | 'percentage' | 'boolean';
  label: string;
  source: 'custom';
  category: 'custom';
  required: boolean;
}

export interface OakDocStandardTemplateMigrationDefinition {
  migrationId: string;
  migrationVersion: number;
  legacyTemplateName: string;
  oakDocTemplateName: string;
  fileName: string;
  description: string;
  category: DocumentTemplateCategory;
  fieldMappings: readonly OakDocLegacyFieldMapping[];
  expectedFieldTags: readonly string[];
  uniqueFieldTags: readonly string[];
  expectedRepeaters: readonly string[];
  expectedConditions: readonly string[];
  placeholders: readonly OakDocMigrationPlaceholderDefinition[];
  buildDocx: () => Uint8Array;
}

export const OAKDOC_SEED_MIGRATION_METADATA_KEY = 'oakDocSeedMigration';

export interface OakDocTemplateMigrationMetadata {
  migrationId: string;
  migrationVersion: number;
  legacyTemplateName: string;
  sourceSha256: string;
}

export interface OakDocMigrationValidationResult {
  valid: boolean;
  errors: string[];
  fieldTags: string[];
  repeaterTags: string[];
  conditionTags: string[];
  legacyPlaceholders: string[];
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
</w:styles>`;

function runProperties(options: { bold?: boolean; sizeHalfPoints?: number } = {}): string {
  if (!options.bold && !options.sizeHalfPoints) return '';
  return `<w:rPr>${options.bold ? '<w:b/>' : ''}${options.sizeHalfPoints ? `<w:sz w:val="${options.sizeHalfPoints}"/><w:szCs w:val="${options.sizeHalfPoints}"/>` : ''}</w:rPr>`;
}

function fieldSdt(
  id: number,
  tag: string,
  label: string,
  sample: string,
  options: { bold?: boolean; sizeHalfPoints?: number } = {},
): string {
  return `<w:sdt><w:sdtPr><w:alias w:val="${label}"/><w:tag w:val="${tag}"/><w:id w:val="${id}"/><w:text/></w:sdtPr><w:sdtContent><w:r>${runProperties(options)}<w:t xml:space="preserve">${sample}</w:t></w:r></w:sdtContent></w:sdt>`;
}

function paragraph(
  content = '',
  options: {
    center?: boolean;
    bold?: boolean;
    heading?: boolean;
    sizeHalfPoints?: number;
  } = {},
): string {
  const pPr = options.center || options.heading
    ? `<w:pPr>${options.center ? '<w:jc w:val="center"/>' : ''}${options.heading ? '<w:pStyle w:val="Heading1"/>' : ''}</w:pPr>`
    : '';
  const run = content
    ? `<w:r>${runProperties(options)}<w:t xml:space="preserve">${content}</w:t></w:r>`
    : '';
  return `<w:p>${pPr}${run}</w:p>`;
}

export function buildCorpSecAppointmentOakDocMaster(): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  mc:Ignorable="w15">
  <w:body>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr>${fieldSdt(101, 'company.name', 'Company Name', 'SAMPLE COMPANY PTE. LTD.', { bold: true, sizeHalfPoints: 22 })}</w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${runProperties({ sizeHalfPoints: 22 })}<w:t xml:space="preserve">(Registration Number </w:t></w:r>${fieldSdt(102, 'company.uen', 'Company UEN', '202600001A', { sizeHalfPoints: 22 })}<w:r>${runProperties({ sizeHalfPoints: 22 })}<w:t>)</w:t></w:r></w:p>
    ${paragraph('(Incorporated in the Republic of Singapore)', { center: true, sizeHalfPoints: 22 })}
    ${paragraph('(“Company”)', { center: true, bold: true, sizeHalfPoints: 22 })}
    ${paragraph()}
    ${paragraph('DIRECTORS’ RESOLUTIONS IN WRITING PURSUANT TO ARTICLE 90 OF THE COMPANY’S ARTICLES OF ASSOCIATION', { bold: true, heading: true })}
    ${paragraph('______________________________________________________________________________________')}
    ${paragraph()}
    ${paragraph('We, the undersigned, being all the directors of the Company (“Directors”) for the time being entitled to make any decision that may be made in a meeting of the Board of Directors, hereby unanimously consent to the adoption and approval of the following resolutions:')}
    ${paragraph()}
    ${paragraph('1.\tAPPOINTMENT OF SECRETARY', { bold: true })}
    ${paragraph()}
    ${paragraph('RESOLVED that the appointment of Tan Wei Jie (S9101817I) as Secretary of the Company be hereby approved with effect from his date of consent to act.')}
    ${paragraph()}
    ${paragraph('2.\tCORPORATE SERVICE PROVIDER', { bold: true })}
    ${paragraph()}
    ${paragraph('RESOLVED that Oaktree Accounting &amp; Corporate Solutions Pte. Ltd. (UEN: 202437906H) be hereby appointed as corporate secretarial agent of the Company with immediate effect.')}
    ${paragraph()}
    ${paragraph('3.\tNOTIFICATION AND LODGEMENT', { bold: true })}
    ${paragraph()}
    ${paragraph('RESOLVED that all necessary documents and forms be completed, signed and lodged with the Accounting and Corporate Regulatory Authority.')}
    ${paragraph()}
    <w:p><w:r><w:t xml:space="preserve">Dated this </w:t></w:r>${fieldSdt(103, 'resolution.date', 'Resolution Date', '25 Sep 2026')}</w:p>
    ${paragraph()}
    <w:sdt>
      <w:sdtPr><w:alias w:val="Directors"/><w:tag w:val="repeat.directors"/><w:id w:val="104"/><w15:repeatingSection/></w:sdtPr>
      <w:sdtContent>
        <w:sdt>
          <w:sdtPr><w:id w:val="105"/><w15:repeatingSectionItem/></w:sdtPr>
          <w:sdtContent>
            ${paragraph()}
            ${paragraph()}
            ${paragraph('________________________')}
            <w:p>${fieldSdt(106, 'director.name', 'Director Name', 'Director Name')}</w:p>
            <w:p>${fieldSdt(107, 'director.role', 'Director Role', 'DIRECTOR')}</w:p>
          </w:sdtContent>
        </w:sdt>
      </w:sdtContent>
    </w:sdt>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="850" w:right="1134" w:bottom="850" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return zipSync({
    '[Content_Types].xml': encodeOakDocZipText(CONTENT_TYPES),
    '_rels/.rels': encodeOakDocZipText(ROOT_RELS),
    'word/document.xml': encodeOakDocZipText(documentXml),
    'word/_rels/document.xml.rels': encodeOakDocZipText(DOCUMENT_RELS),
    'word/styles.xml': encodeOakDocZipText(STYLES),
  }, { level: 6 });
}

export const DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION: OakDocStandardTemplateMigrationDefinition = {
  migrationId: 'standard-template:dr-appointment-of-corp-sec',
  migrationVersion: 1,
  legacyTemplateName: 'DR_Appointment of Corp Sec',
  oakDocTemplateName: 'DR_Appointment of Corp Sec (OakDoc)',
  fileName: 'DR_Appointment_of_Corp_Sec_OakDoc.docx',
  description: 'OakDoc-native migration of DR_Appointment of Corp Sec',
  category: 'RESOLUTION',
  fieldMappings: [
    { legacyField: 'company.name', oakDocTag: 'company.name' },
    { legacyField: 'company.uen', oakDocTag: 'company.uen' },
    { legacyField: 'custom.resolution_date', oakDocTag: 'resolution.date' },
    { legacyField: 'directors[].name', oakDocTag: 'director.name', repeaterTag: 'repeat.directors' },
    { legacyField: 'directors[].role', oakDocTag: 'director.role', repeaterTag: 'repeat.directors' },
  ],
  expectedFieldTags: [
    'company.name',
    'company.uen',
    'resolution.date',
    'director.name',
    'director.role',
  ],
  uniqueFieldTags: [
    'company.name',
    'company.uen',
    'resolution.date',
    'director.name',
    'director.role',
  ],
  expectedRepeaters: ['repeat.directors'],
  expectedConditions: [],
  placeholders: [
    {
      key: 'custom.resolution_date',
      path: 'custom.resolution_date',
      type: 'date',
      label: 'Resolution date',
      source: 'custom',
      category: 'custom',
      required: true,
    },
  ],
  buildDocx: buildCorpSecAppointmentOakDocMaster,
};

export const OAKDOC_STANDARD_TEMPLATE_MIGRATIONS = [
  DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
] as const;

function contentControlTags(documentXml: string): string[] {
  return Array.from(documentXml.matchAll(/<w:tag\s+w:val="([^"]+)"\s*\/>/g), (match) => match[1]);
}

export function sha256OakDocSource(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateOakDocMigrationMaster(
  definition: OakDocStandardTemplateMigrationDefinition,
  bytes: Uint8Array = definition.buildDocx(),
): OakDocMigrationValidationResult {
  const errors: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return {
      valid: false,
      errors: ['DOCX package is not readable'],
      fieldTags: [],
      repeaterTags: [],
      conditionTags: [],
      legacyPlaceholders: [],
    };
  }

  const contentTypes = files['[Content_Types].xml'];
  const documentPart = files['word/document.xml'];
  if (!contentTypes) errors.push('DOCX has no [Content_Types].xml part');
  if (!documentPart) errors.push('DOCX has no word/document.xml part');
  if (!documentPart) {
    return {
      valid: false,
      errors,
      fieldTags: [],
      repeaterTags: [],
      conditionTags: [],
      legacyPlaceholders: [],
    };
  }

  if (
    contentTypes
    && !strFromU8(contentTypes).includes('wordprocessingml.document.main+xml')
  ) {
    errors.push('DOCX does not declare a WordprocessingML main document');
  }

  const documentXml = strFromU8(documentPart);
  if (!documentXml.includes('<w:document') || !documentXml.includes('<w:body')) {
    errors.push('word/document.xml is not a WordprocessingML document body');
  }

  const tags = contentControlTags(documentXml);
  const fieldTags = tags.filter(
    (tag) => !tag.startsWith('repeat.') && !tag.startsWith('oakdoc.condition.'),
  );
  const repeaterTags = tags.filter((tag) => tag.startsWith('repeat.'));
  const conditionTags = tags.filter((tag) => tag.startsWith('oakdoc.condition.'));
  const legacyPlaceholders = Array.from(
    documentXml.matchAll(/\{\{[^{}]+\}\}/g),
    (match) => match[0],
  );

  for (const tag of definition.expectedFieldTags) {
    if (!fieldTags.includes(tag)) errors.push(`Missing required OakDoc field tag: ${tag}`);
  }
  for (const tag of definition.uniqueFieldTags) {
    const count = fieldTags.filter((candidate) => candidate === tag).length;
    if (count !== 1) {
      errors.push(`Expected OakDoc field tag ${tag} exactly once, found ${count}`);
    }
  }
  for (const tag of definition.expectedRepeaters) {
    const count = repeaterTags.filter((candidate) => candidate === tag).length;
    if (count !== 1) {
      errors.push(`Expected OakDoc repeater tag ${tag} exactly once, found ${count}`);
    }
  }
  for (const tag of definition.expectedConditions) {
    if (!conditionTags.includes(tag)) {
      errors.push(`Missing required OakDoc condition tag: ${tag}`);
    }
  }

  const unexpectedConditions = conditionTags.filter(
    (tag) => !definition.expectedConditions.includes(tag),
  );
  if (unexpectedConditions.length > 0) {
    errors.push(`Unexpected OakDoc condition tags: ${unexpectedConditions.join(', ')}`);
  }
  if (legacyPlaceholders.length > 0) {
    errors.push(`Unresolved legacy placeholders remain: ${legacyPlaceholders.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    fieldTags: Array.from(new Set(fieldTags)).sort(),
    repeaterTags: Array.from(new Set(repeaterTags)).sort(),
    conditionTags: Array.from(new Set(conditionTags)).sort(),
    legacyPlaceholders,
  };
}

export function migrationMetadataFor(
  definition: OakDocStandardTemplateMigrationDefinition,
  sourceBytes: Uint8Array = definition.buildDocx(),
): OakDocTemplateMigrationMetadata {
  return {
    migrationId: definition.migrationId,
    migrationVersion: definition.migrationVersion,
    legacyTemplateName: definition.legacyTemplateName,
    sourceSha256: sha256OakDocSource(sourceBytes),
  };
}

function parseSeedMigrationMetadata(raw: unknown): OakDocTemplateMigrationMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.migrationId !== 'string'
    || !value.migrationId
    || typeof value.migrationVersion !== 'number'
    || !Number.isInteger(value.migrationVersion)
    || value.migrationVersion < 1
    || typeof value.legacyTemplateName !== 'string'
    || typeof value.sourceSha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(value.sourceSha256)
  ) return null;

  return {
    migrationId: value.migrationId,
    migrationVersion: value.migrationVersion,
    legacyTemplateName: value.legacyTemplateName,
    sourceSha256: value.sourceSha256.toLowerCase(),
  };
}

export function readOakDocSeedMigrationMetadata(
  contentJson: unknown,
): OakDocTemplateMigrationMetadata | null {
  if (!contentJson || typeof contentJson !== 'object' || Array.isArray(contentJson)) return null;
  const record = contentJson as Record<string, unknown>;

  // Stage 3 originally stored source/seed identity under `oakDocMigration`.
  // Stage 7 later assigned that key to parity/preference metadata. Read the
  // original shape as a backwards-compatible fallback, but write only to the
  // dedicated seed key from now on.
  return parseSeedMigrationMetadata(record[OAKDOC_SEED_MIGRATION_METADATA_KEY])
    ?? parseSeedMigrationMetadata(record.oakDocMigration);
}

export function mergeOakDocSeedMigrationMetadata(
  contentJson: unknown,
  metadata: OakDocTemplateMigrationMetadata,
): Record<string, unknown> {
  const base = contentJson && typeof contentJson === 'object' && !Array.isArray(contentJson)
    ? { ...(contentJson as Record<string, unknown>) }
    : {};
  return {
    ...base,
    [OAKDOC_SEED_MIGRATION_METADATA_KEY]: { ...metadata },
  };
}

/** @deprecated Use readOakDocSeedMigrationMetadata. */
export const readOakDocMigrationMetadata = readOakDocSeedMigrationMetadata;

export function buildOakDocMigrationContentJson(
  definition: OakDocStandardTemplateMigrationDefinition,
  sourceBytes: Uint8Array = definition.buildDocx(),
): Record<string, unknown> {
  return mergeOakDocSeedMigrationMetadata(
    null,
    migrationMetadataFor(definition, sourceBytes),
  );
}

export function generateOakDocMigrationDocument(input: {
  definition: OakDocStandardTemplateMigrationDefinition;
  company: OakDocCompanyDetail;
  resolutionDate: Date | string;
  generatedBy?: string;
}): { bytes: Uint8Array; unresolvedTags: string[] } {
  const source = input.definition.buildDocx();
  const repeated = resolveOakDocRepeaters({
    docxBytes: source,
    company: input.company,
  });
  const values = buildOakDocResolutionValues({
    company: input.company,
    fieldTags: input.definition.expectedFieldTags,
    resolution: { date: input.resolutionDate },
    generatedBy: input.generatedBy,
  });
  const resolved = resolveOakDocFields(repeated.bytes, values);
  return {
    bytes: resolved.bytes,
    unresolvedTags: resolved.unresolvedTags,
  };
}

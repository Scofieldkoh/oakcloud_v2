import {
  OAKDOC_AGREEMENT_PROTOTYPE_TAGS,
  OAKDOC_AGREEMENT_SLOT_TAGS,
} from '@/lib/document-editor/oakdoc-field-registry';
import {
  ControlIds,
  blockControl,
  buildReferencePackage,
  documentXml,
  emailFieldControl,
  fieldControl,
  numberingXml,
  paragraph,
  repeatingSection,
  richRuns,
  run,
  sectionProperties,
  table,
  tableCell,
  tableRow,
  type ParagraphFormat,
} from './oakdoc-reference-ooxml';
import {
  REFERENCE_ACCEPTANCE,
  REFERENCE_COVER,
  REFERENCE_ENTITY_APPENDIX_TITLE,
  REFERENCE_FEES,
  REFERENCE_INSTRUCTIONS,
  REFERENCE_PROVIDER,
  REFERENCE_STATEMENT_OF_WORK,
  REFERENCE_TERMS,
  REFERENCE_TERMS_TITLE,
} from './oaktree-service-agreement-reference-wording';

/** Word date pattern for every printed agreement date (9 July 2026). */
export const REFERENCE_DATE_FORMAT = 'd MMMM yyyy';

/** The firm signs by whoever prepares the agreement. */
const PREPARER_TAG = 'system.preparerName';

/** Twips of one blank body line (10 pt Arial at 1.15 line spacing). */
const LINE = 267;
/** Blank lines reserved above each signer's name for the signature. */
const SIGNATURE_SPACE_LINES = 4;
const ENTITY_LIST_NUM_ID = 1;

const BODY: ParagraphFormat = { style: 'BodyText', align: 'both', left: 100, after: LINE };

function bodyParagraph(content: string, format: ParagraphFormat = {}): string {
  return paragraph(content, { ...BODY, ...format });
}

function blankLine(format: ParagraphFormat = {}): string {
  return paragraph('', { style: 'BodyText', ...format });
}

/**
 * One signing block: reserved signature space holding the signing marker,
 * then the name lines. Every paragraph keeps its lines together and with
 * the next, except the last, which explicitly stops the chain so the next
 * signer can start on a new page.
 */
function signingBlock(
  ids: ControlIds,
  input: {
    signatureTag: string;
    signatureLabel: string;
    lines: string[];
    left?: number;
  },
): string {
  const keep: ParagraphFormat = { style: 'BodyText', left: input.left ?? 100, keepNext: true, keepLines: true };
  const space = Array.from({ length: SIGNATURE_SPACE_LINES }, () => blankLine(keep)).join('');
  const marker = blockControl(ids, input.signatureTag, input.signatureLabel, blankLine(keep));
  const lines = input.lines.map((content, index) => paragraph(content, {
    ...keep,
    keepNext: index < input.lines.length - 1,
  }));
  return [space, marker, ...lines].join('');
}

function cover(ids: ControlIds): string {
  return [
    paragraph(run(REFERENCE_COVER.confidentiality, { bold: true }), { style: 'BodyText', after: LINE }),
    paragraph(fieldControl(ids, 'company.name'), { style: 'BodyText' }),
    paragraph(fieldControl(ids, 'company.address.letter'), { style: 'BodyText', after: LINE }),
    paragraph(`${run('Attention: ')}${fieldControl(ids, 'selectedContact.name')}`, { style: 'BodyText', after: LINE }),
    paragraph(run(REFERENCE_COVER.title, { bold: true }), { style: 'BodyText', keepNext: true }),
    ...REFERENCE_COVER.paragraphs.map((text) => bodyParagraph(richRuns(text), { left: 0 })),
    bodyParagraph(run(REFERENCE_COVER.closing), { left: 0 }),
    paragraph(run(REFERENCE_COVER.providerSigningLabel), { style: 'BodyText', after: LINE, keepNext: true, keepLines: true }),
    paragraph(run(REFERENCE_PROVIDER.legalName, { bold: true }), { style: 'BodyText', keepNext: true, keepLines: true }),
    signingBlock(ids, {
      signatureTag: 'oakdoc.signature.v1.provider',
      signatureLabel: 'Oaktree / provider signature',
      left: 0,
      lines: [
        fieldControl(ids, PREPARER_TAG),
        run(REFERENCE_PROVIDER.signatoryRole),
        fieldControl(ids, 'agreement.agreementDate', {}, { dateFormat: REFERENCE_DATE_FORMAT }),
      ],
    }),
    paragraph('', { style: 'BodyText', section: sectionProperties() }),
  ].join('');
}

function acceptance(ids: ControlIds): string {
  return [
    ...REFERENCE_ACCEPTANCE.appendices.map((text, index) => paragraph(run(text, { bold: true }), {
      style: 'BodyText',
      left: 100,
      before: index === 0 ? 0 : 240,
    })),
    paragraph(run(REFERENCE_ACCEPTANCE.title, { bold: true }), {
      style: 'BodyText',
      left: 100,
      before: LINE * 3,
      after: LINE,
      keepNext: true,
    }),
    bodyParagraph(run(REFERENCE_ACCEPTANCE.statement)),
    paragraph(run(REFERENCE_ACCEPTANCE.clientSigningLabel), {
      style: 'BodyText',
      left: 100,
      keepNext: true,
      keepLines: true,
    }),
    repeatingSection(ids, 'repeat.signers', 'Client signers', signingBlock(ids, {
      signatureTag: 'oakdoc.signature.v1.client-acceptance',
      signatureLabel: 'Client acceptance signature',
      lines: [
        fieldControl(ids, 'signer.name'),
        fieldControl(ids, 'signer.role'),
        fieldControl(ids, 'agreement.agreementDate', {}, { dateFormat: REFERENCE_DATE_FORMAT }),
      ],
    })),
  ].join('');
}

function termsOfBusiness(): string {
  const numberWidth = 567;
  const textWidth = 8505;
  const cell = (content: string, width: number, format: ParagraphFormat) => tableCell(
    paragraph(content, { style: 'TableParagraph', left: 108, after: 120, ...format }),
    { width, borderless: true },
  );
  const rows = REFERENCE_TERMS.flatMap((group, groupIndex) => [
    ...(groupIndex > 0
      ? [tableRow(cell('', numberWidth, {}) + cell('', textWidth, {}), { cantSplit: true })]
      : []),
    tableRow(
      cell(run(`${group.number}.`, { bold: true }), numberWidth, { keepNext: true })
        + cell(run(group.heading, { bold: true }), textWidth, { align: 'both', keepNext: true }),
      { cantSplit: true },
    ),
    ...group.clauses.map(([number, text]) => tableRow(
      cell(run(number), numberWidth, {}) + cell(richRuns(text), textWidth, { align: 'both' }),
    )),
  ]);
  return [
    paragraph(run(REFERENCE_TERMS_TITLE, { bold: true, underline: true }), {
      style: 'AppendixTitle',
      pageBreakBefore: true,
      after: LINE,
    }),
    table({ columns: [numberWidth, textWidth], rows: rows.join('') }),
    paragraph('', { style: 'BodyText', section: sectionProperties() }),
  ].join('');
}

/**
 * The fee table: one SOW/Amount table for the whole agreement. Each company
 * with fees gets a blank separator row and a bold, underlined name row, then
 * a row per SOW labelled like its scope heading, then a row per charge with
 * its amount. A blank row closes the table. Every cell is centred
 * vertically. The row controls are the prototypes the renderer repeats.
 */
function feePrototype(ids: ControlIds): string {
  const tags = OAKDOC_AGREEMENT_PROTOTYPE_TAGS;
  const sowWidth = 7265;
  const amountWidth = 1800;
  const cellParagraph = (content: string, format: ParagraphFormat = {}) => paragraph(content, {
    style: 'TableParagraph',
    before: 60,
    after: 60,
    left: 107,
    right: 107,
    ...format,
  });
  const row = (
    sow: string,
    amount: string,
    options: { header?: boolean; keepNext?: boolean; indent?: number } = {},
  ) => tableRow(
    tableCell(
      cellParagraph(sow, { keepNext: options.keepNext, ...(options.indent ? { left: options.indent } : {}) }),
      { width: sowWidth, verticalAlign: 'center' },
    )
      + tableCell(cellParagraph(amount, { keepNext: options.keepNext }), { width: amountWidth, verticalAlign: 'center' }),
    { header: options.header, cantSplit: true },
  );
  const header = row(
    run(REFERENCE_FEES.columns[0], { bold: true }),
    run(REFERENCE_FEES.columns[1], { bold: true }),
    { header: true, keepNext: true },
  );
  const blank = row('', '');
  const companyName = row(
    `${fieldControl(ids, tags.feeCompanyName, { bold: true, underline: true })}${run(':', { bold: true, underline: true })}`,
    '',
    { keepNext: true },
  );
  // Charge descriptions sit one step in from the SOW label.
  const chargeRow = blockControl(ids, tags.feeChargeRow, 'Charge row', row(
    fieldControl(ids, tags.feeChargeDescription),
    fieldControl(ids, tags.feeChargeAmount),
    { indent: 391 },
  ));
  const sowRow = blockControl(ids, tags.feeSowRow, 'SOW fee row', row(
    `${run(REFERENCE_FEES.sowLabelPrefix)}${fieldControl(ids, tags.feeSowName)}`,
    fieldControl(ids, tags.feeSowAmount),
    { keepNext: true },
  ) + chargeRow);
  const company = blockControl(ids, tags.feeCompany, 'Company fee group', blank + companyName + sowRow);
  return table({ columns: [sowWidth, amountWidth], indent: 110, grid: true, rows: header + company + blank });
}

function statementOfWork(ids: ControlIds): string {
  const [beforeClient, beforeDate, afterDate] = REFERENCE_STATEMENT_OF_WORK.opening;
  return [
    paragraph(run(REFERENCE_STATEMENT_OF_WORK.title, { bold: true, underline: true }), {
      style: 'AppendixTitle',
      after: LINE,
    }),
    bodyParagraph([
      richRuns(beforeClient),
      fieldControl(ids, 'company.name'),
      run(beforeDate),
      fieldControl(ids, 'agreement.effectiveDate', {}, { dateFormat: REFERENCE_DATE_FORMAT }),
      richRuns(afterDate),
    ].join('')),
    ...REFERENCE_STATEMENT_OF_WORK.paragraphs.map((text) => bodyParagraph(richRuns(text))),
    // Every service starts on its own page: the slot paragraph breaks the page.
    blockControl(
      ids,
      OAKDOC_AGREEMENT_SLOT_TAGS.serviceSections,
      'Service Agreement service sections',
      paragraph(run('[Service sections inserted during generation]'), { style: 'BodyText', pageBreakBefore: true }),
    ),
    paragraph(run(REFERENCE_FEES.title, { bold: true }), { style: 'Heading1', left: 100, pageBreakBefore: true, after: LINE }),
    paragraph(run(REFERENCE_FEES.introduction), { style: 'BodyText', left: 100, after: LINE, keepNext: true }),
    blockControl(ids, OAKDOC_AGREEMENT_SLOT_TAGS.feeTable, 'Service Agreement fee table', feePrototype(ids)),
    ...REFERENCE_FEES.notes.map((text, index) => bodyParagraph(run(text), {
      after: index === REFERENCE_FEES.notes.length - 1 ? 0 : LINE,
    })),
    paragraph('', { style: 'BodyText', section: sectionProperties() }),
  ].join('');
}

function representativeTable(ids: ControlIds): string {
  // The email column is widened so a long address fits on one line.
  const columns = [1845, 1400, 3773, 2000] as const;
  const cellParagraph = (content: string) => paragraph(content, {
    style: 'TableParagraph',
    left: 107,
    right: 99,
  });
  const header = tableRow(
    REFERENCE_INSTRUCTIONS.columns
      .map((label, index) => tableCell(cellParagraph(run(label)), { width: columns[index] }))
      .join(''),
    { header: true, cantSplit: true },
  );
  const row = tableRow([
    tableCell(cellParagraph(fieldControl(ids, 'authorisedRepresentative.name')), { width: columns[0], verticalAlign: 'center' }),
    tableCell(cellParagraph(fieldControl(ids, 'authorisedRepresentative.role')), { width: columns[1], verticalAlign: 'center' }),
    tableCell(
      // Email and mobile on their own lines, so neither pushes the other out.
      cellParagraph(emailFieldControl(ids, 'authorisedRepresentative.email'))
        + cellParagraph(fieldControl(ids, 'authorisedRepresentative.phone')),
      { width: columns[2], verticalAlign: 'center' },
    ),
    tableCell(
      blockControl(
        ids,
        'oakdoc.signature.v1.authorised-representative-specimen',
        'Authorised representative specimen signature',
        cellParagraph(''),
      ),
      { width: columns[3], verticalAlign: 'center' },
    ),
  ].join(''), { cantSplit: true, minHeight: 593 });
  return table({
    columns,
    indent: 110,
    grid: true,
    rows: header + repeatingSection(ids, 'repeat.authorisedRepresentatives', 'Authorised representatives', row),
  });
}

function instructions(ids: ControlIds): string {
  const [beforeTerm, afterTerm] = REFERENCE_INSTRUCTIONS.term;
  return [
    paragraph(run(REFERENCE_INSTRUCTIONS.title, { bold: true }), { style: 'Heading1', left: 100, after: LINE }),
    paragraph(run(REFERENCE_INSTRUCTIONS.introduction), { style: 'BodyText', left: 100, after: LINE, keepNext: true }),
    representativeTable(ids),
    ...REFERENCE_INSTRUCTIONS.notes.map((text) => bodyParagraph(run(text), { before: LINE, after: 0 })),
    paragraph(run(REFERENCE_INSTRUCTIONS.variationsTitle, { bold: true }), {
      style: 'Heading1',
      left: 100,
      before: LINE * 2,
      after: LINE,
    }),
    bodyParagraph(run(REFERENCE_INSTRUCTIONS.variations)),
    paragraph(run(REFERENCE_INSTRUCTIONS.termTitle, { bold: true }), { style: 'Heading1', left: 100, after: LINE }),
    bodyParagraph(`${run(beforeTerm)}${fieldControl(ids, 'agreement.term')}${run(afterTerm)}`, { after: LINE * 3 }),
    paragraph(run(REFERENCE_INSTRUCTIONS.providerSigningLabel, { bold: true }), {
      style: 'BodyText',
      left: 100,
      after: LINE,
      keepNext: true,
      keepLines: true,
    }),
    paragraph(run(REFERENCE_PROVIDER.legalName), { style: 'BodyText', left: 100, keepNext: true, keepLines: true }),
    signingBlock(ids, {
      signatureTag: 'oakdoc.signature.v1.provider',
      signatureLabel: 'Oaktree / provider signature',
      lines: [fieldControl(ids, PREPARER_TAG), run(REFERENCE_PROVIDER.signatoryRole)],
    }),
    paragraph(run(REFERENCE_INSTRUCTIONS.clientSigningLabel, { bold: true }), {
      style: 'BodyText',
      left: 100,
      before: LINE * 2,
      keepNext: true,
      keepLines: true,
    }),
    repeatingSection(ids, 'repeat.signers', 'Client signers', signingBlock(ids, {
      signatureTag: 'oakdoc.signature.v1.sow-client',
      signatureLabel: 'Client SOW signature',
      lines: [fieldControl(ids, 'signer.name'), fieldControl(ids, 'signer.role')],
    })),
  ].join('');
}

function entityAppendix(ids: ControlIds): string {
  const tags = OAKDOC_AGREEMENT_PROTOTYPE_TAGS;
  return [
    paragraph(run(REFERENCE_ENTITY_APPENDIX_TITLE, { bold: true }), {
      style: 'AppendixTitle',
      pageBreakBefore: true,
      after: LINE,
    }),
    // One numbered line per entity; generation repeats this paragraph.
    blockControl(
      ids,
      OAKDOC_AGREEMENT_SLOT_TAGS.entityAppendix,
      'Service Agreement entity appendix',
      paragraph(
        `${fieldControl(ids, tags.entityName)}${run(' (UEN: ')}${fieldControl(ids, tags.entityUen)}${run(')')}`,
        { style: 'BodyText', align: 'both', numbering: { numId: ENTITY_LIST_NUM_ID } },
      ),
    ),
  ].join('');
}

/**
 * The Oaktree Local Master Services Agreement rebuilt natively from the
 * firm's reference agreement: Arial 10 pt black typography, the borderless
 * two-column Terms of Business table, the reference page geometry with no
 * header or footer, explicit page starts, signer blocks that never split
 * across pages, and template-owned fee and entity prototypes.
 */
export function buildOaktreeServiceAgreementReferenceOakDoc(): Uint8Array {
  const ids = new ControlIds(7000);
  const body = [
    cover(ids),
    acceptance(ids),
    termsOfBusiness(),
    statementOfWork(ids),
    instructions(ids),
    entityAppendix(ids),
    sectionProperties(),
  ].join('');
  return buildReferencePackage({
    documentXml: documentXml(body),
    numberingXml: numberingXml([
      { numId: ENTITY_LIST_NUM_ID, level: { format: 'decimal', text: '%1.', left: 715, hanging: 615 } },
    ]),
    title: 'Oaktree Local Master Services Agreement',
    subject: 'OakDoc Service Agreement master (reference layout)',
  });
}

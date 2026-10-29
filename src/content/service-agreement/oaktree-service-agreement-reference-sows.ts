import {
  buildReferencePackage,
  documentXml,
  numberingXml,
  paragraph,
  run,
  sectionProperties,
  type ListLevel,
  type ParagraphFormat,
} from './oakdoc-reference-ooxml';
import {
  REFERENCE_CORPORATE_SECRETARIAL_SOW,
  REFERENCE_FINANCIAL_STATEMENTS_TAX_SOW,
} from './oaktree-service-agreement-reference-wording';

/**
 * Word-native scope-of-work partials for the two reference services. They
 * use the master's named styles and their own list definitions, so lettered
 * items, the nested square register bullets and list restarts survive the
 * merge into the agreement. Section breaks are deliberately absent: the
 * master decides where each service starts.
 */

export interface ReferenceSowPartial {
  name: string;
  displayName: string;
  description: string;
  fileName: string;
  /** The HTML partial this Word partial replaces for the same variant. */
  replacesPartialName: string;
  build: () => Uint8Array;
}

const LINE = 267;
const LETTERED: Omit<ListLevel, 'left' | 'hanging'> = { format: 'lowerLetter', text: '%1)' };

function title(text: string): string {
  return paragraph(run(text, { bold: true }), { style: 'Heading1', left: 100, keepNext: true, after: LINE });
}

function listItem(text: string, numId: number, format: ParagraphFormat = {}): string {
  return paragraph(run(text), {
    style: 'ListParagraph',
    align: 'both',
    after: 120,
    line: 240,
    numbering: { numId },
    ...format,
  });
}

function corporateSecretarialBody(): string {
  const sow = REFERENCE_CORPORATE_SECRETARIAL_SOW;
  const lastInclusion = sow.inclusions.length - 1;
  return [
    title(sow.title),
    paragraph(run(sow.subsection, { bold: true }), {
      style: 'Heading2',
      align: 'both',
      left: 426,
      hanging: 358,
      numbering: { numId: 1 },
    }),
    paragraph(run(sow.introduction), { style: 'BodyText', align: 'both', left: 426, before: 251, after: LINE }),
    ...sow.inclusions.map((text, index) => listItem(text, 2, index === lastInclusion ? { after: 0, keepNext: true } : {})),
    ...sow.registers.map((text) => listItem(text, 3, { after: 0 })),
    paragraph(run(sow.scopeLimit), { style: 'BodyText', align: 'both', left: 426, before: 252 }),
    paragraph(run(sow.exclusionsTitle, { underline: true }), {
      style: 'BodyText',
      left: 426,
      before: 252,
      after: LINE,
      keepNext: true,
    }),
    paragraph(run(sow.exclusionsIntroduction), { style: 'BodyText', align: 'both', left: 426, after: LINE }),
    ...sow.exclusions.map((text) => listItem(text, 4)),
    paragraph(run(sow.closing), { style: 'BodyText', align: 'both', left: 426, before: 147 }),
  ].join('');
}

function financialStatementsTaxBody(): string {
  const sow = REFERENCE_FINANCIAL_STATEMENTS_TAX_SOW;
  return [
    title(sow.title),
    ...sow.paragraphs.map((text) => paragraph(run(text), { style: 'BodyText', align: 'both', left: 426, after: LINE })),
    ...sow.subsections.flatMap((subsection, index) => [
      paragraph(run(subsection.title, { bold: true }), {
        style: 'Heading2',
        left: 786,
        hanging: 360,
        after: LINE,
        numbering: { numId: 1 },
      }),
      ...subsection.items.map((text, itemIndex) => listItem(text, 2 + index, {
        line: 276,
        after: itemIndex === subsection.items.length - 1 ? LINE : 120,
      })),
    ]),
  ].join('');
}

function build(body: string, lists: ReadonlyArray<{ numId: number; level: ListLevel }>, subject: string): Uint8Array {
  return buildReferencePackage({
    documentXml: documentXml(`${body}${sectionProperties()}`),
    numberingXml: numberingXml(lists),
    title: subject,
    subject: 'OakDoc scope-of-work partial (reference layout)',
  });
}

export function buildCorporateSecretarialSowOakDoc(): Uint8Array {
  return build(corporateSecretarialBody(), [
    { numId: 1, level: { format: 'decimal', text: '%1.', left: 426, hanging: 358, bold: true } },
    { numId: 2, level: { ...LETTERED, left: 818, hanging: 358 } },
    { numId: 3, level: { format: 'bullet', text: '', left: 1180, hanging: 360, font: 'Wingdings' } },
    { numId: 4, level: { ...LETTERED, left: 816, hanging: 357 } },
  ], REFERENCE_CORPORATE_SECRETARIAL_SOW.title);
}

export function buildFinancialStatementsTaxSowOakDoc(): Uint8Array {
  return build(financialStatementsTaxBody(), [
    { numId: 1, level: { format: 'decimal', text: '%1.', left: 786, hanging: 360, bold: true } },
    { numId: 2, level: { ...LETTERED, left: 820, hanging: 360 } },
    { numId: 3, level: { ...LETTERED, left: 820, hanging: 360 } },
  ], REFERENCE_FINANCIAL_STATEMENTS_TAX_SOW.title);
}

export const REFERENCE_SOW_PARTIALS: readonly ReferenceSowPartial[] = [
  {
    name: 'service-agreement-corporate-secretarial-oakdoc-v1',
    displayName: 'Service Agreement - Corporate Secretarial Services (Word)',
    description: 'Corporate Secretarial Services scope from the reference agreement, with native lists.',
    fileName: 'Corporate Secretarial Services SOW.docx',
    replacesPartialName: 'service-agreement-corporate-secretarial-v1',
    build: buildCorporateSecretarialSowOakDoc,
  },
  {
    name: 'service-agreement-unaudited-fs-tax-oakdoc-v1',
    displayName: 'Service Agreement - Unaudited FS and Corporate Tax (Word)',
    description: 'Unaudited financial statements and corporate tax scope from the reference agreement, with native lists.',
    fileName: 'Unaudited FS and Corporate Tax SOW.docx',
    replacesPartialName: 'service-agreement-unaudited-fs-tax-v1',
    build: buildFinancialStatementsTaxSowOakDoc,
  },
];

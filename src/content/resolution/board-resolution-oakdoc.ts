import type { PlaceholderDefinition } from '@/lib/validations/document-template';
import {
  addOakDocConditionDefinitions,
  type OakDocConditionDefinition,
} from '@/lib/document-editor/oakdoc-conditions';
import {
  ControlIds,
  TIMES_11,
  conditionalBlock,
  packageOakDoc,
  repeatingSection,
  resolutionSlot,
  seededConditionId,
  wordWriter,
  type Typeface,
  type WordWriter,
} from './resolution-oakdoc-xml';

/**
 * Starter "Board Resolution" and "Members Resolution" masters for the
 * RESOLUTION template type, laid out like the firm's reference directors'
 * resolution (Cosec appointment, 9 Jul 2026): Times New Roman 11 pt, centred
 * company block, a ruled title, the numbered resolutions, then a signature
 * page with every selected director (or, for members, every shareholder).
 * The numbered resolutions are chosen per document on Configure.
 */

export const BOARD_RESOLUTION_TEMPLATE = {
  name: 'Board Resolution (Numbered)',
  description: 'Directors’ resolutions in writing. Pick saved partials or write custom resolutions on Configure; they are numbered in that order.',
  fileName: 'Board_Resolution_Numbered.docx',
  category: 'RESOLUTION' as const,
  compositionType: 'RESOLUTION' as const,
};

/** Starter members' (shareholders') written resolution, same numbered layout. */
export const MEMBERS_RESOLUTION_TEMPLATE = {
  name: 'Members Resolution (Numbered)',
  description: 'Members’ written resolutions under Section 184A of the Companies Act 1967, signed by every shareholder. Pick saved partials or write custom resolutions on Configure; they are numbered in that order.',
  fileName: 'Members_Resolution_Numbered.docx',
  category: 'RESOLUTION' as const,
  compositionType: 'RESOLUTION' as const,
};

export const BOARD_RESOLUTION_PLACEHOLDERS: PlaceholderDefinition[] = [
  {
    key: 'custom.resolution_date',
    path: 'custom.resolution_date',
    type: 'date',
    label: 'Resolution date',
    source: 'custom',
    category: 'custom',
    required: true,
  },
];

interface ResolutionVariant {
  title: string;
  intro: string;
  repeaterTag: string;
  repeaterAlias: string;
  /** Each signatory's block in the repeating section. */
  signature: (ids: ControlIds, writer: WordWriter) => string[];
  /** Conditions the signature blocks use. */
  conditions?: OakDocConditionDefinition[];
}

const SIGNATURE_LINE = '___________________________';

function signatureLine({ paragraph, run }: WordWriter): string[] {
  return [
    paragraph('', { keepNext: true, after: 600 }),
    paragraph(run(SIGNATURE_LINE), { keepNext: true, after: 0 }),
  ];
}

const DIRECTORS: ResolutionVariant = {
  title: 'DIRECTORS’ RESOLUTIONS IN WRITING PURSUANT TO ARTICLE 90 OF THE COMPANY’S ARTICLES OF ASSOCIATION',
  intro: 'We, the undersigned, being all the directors of the Company (“Directors”) for the time being entitled to make any decision that may be made in a meeting of the board of Directors, hereby unanimously consent to the adoption and approval of the following resolutions:',
  repeaterTag: 'repeat.directors',
  repeaterAlias: 'Directors',
  signature: (ids, writer) => [
    ...signatureLine(writer),
    writer.paragraph(writer.field(ids, 'director.name', 'Director Name', 'DIRECTOR NAME', { caps: true }), { keepNext: true, after: 0 }),
    writer.paragraph(writer.field(ids, 'director.role', 'Director Role', 'Director'), { after: 240 }),
  ],
};

const INDIVIDUAL_MEMBER: OakDocConditionDefinition = { field: 'shareholder.isCorporate', operator: 'equals', value: '' };
const CORPORATE_MEMBER: OakDocConditionDefinition = { field: 'shareholder.isCorporate', operator: 'truthy' };

const MEMBERS: ResolutionVariant = {
  title: 'MEMBERS’ RESOLUTIONS IN WRITING PURSUANT TO SECTION 184A OF THE COMPANIES ACT 1967',
  intro: 'We, the undersigned, being all the members of the Company (“Members”) for the time being entitled to attend and vote at general meetings of the Company, hereby agree to the following resolutions being passed as written resolutions of the Company:',
  repeaterTag: 'repeat.shareholders',
  repeaterAlias: 'Shareholders',
  // A person signs as a member; a corporate member through its authorised signatory.
  signature: (ids, writer) => {
    const { paragraph, field, run } = writer;
    const name = () => field(ids, 'shareholder.name', 'Shareholder Name', 'SHAREHOLDER NAME', { caps: true });
    return [
      conditionalBlock(ids, seededConditionId(INDIVIDUAL_MEMBER), [
        ...signatureLine(writer),
        paragraph(name(), { keepNext: true, after: 0 }),
        paragraph(run('Member'), { after: 240 }),
      ].join('')),
      conditionalBlock(ids, seededConditionId(CORPORATE_MEMBER), [
        paragraph('', { keepNext: true, after: 360 }),
        paragraph(run('For and on behalf of'), { keepNext: true, after: 0 }),
        paragraph(name(), { keepNext: true, after: 0 }),
        ...signatureLine(writer),
        paragraph(run('Name:'), { keepNext: true, after: 0 }),
        paragraph(run('Authorised Signatory'), { after: 240 }),
      ].join('')),
    ];
  },
  conditions: [INDIVIDUAL_MEMBER, CORPORATE_MEMBER],
};

export function buildBoardResolutionOakDocMaster(): Uint8Array {
  return buildResolutionMaster(DIRECTORS);
}

export function buildMembersResolutionOakDocMaster(options: ResolutionMasterOptions = {}): Uint8Array {
  return buildResolutionMaster(MEMBERS, options);
}

export interface ResolutionMasterOptions {
  /** Blocks between the opening paragraph and the numbered resolutions. */
  beforeResolutions?: string[];
  /** Extra word/styles.xml styles, such as the numbered heading style. */
  extraStyles?: string;
  /** Typeface of the whole master; Times New Roman 11 pt by default. */
  typeface?: Typeface;
}

/** The directors' layout with extra blocks, for masters built on it (First Resolution). */
export function buildDirectorsResolutionOakDocMaster(
  options: ResolutionMasterOptions,
  ids = new ControlIds(),
): Uint8Array {
  return buildResolutionMaster(DIRECTORS, options, ids);
}

function buildResolutionMaster(
  variant: ResolutionVariant,
  options: ResolutionMasterOptions = {},
  ids = new ControlIds(),
): Uint8Array {
  const typeface = options.typeface ?? TIMES_11;
  const writer = wordWriter(typeface);
  const { paragraph, run, field } = writer;
  const center = { align: 'center' as const, after: 0 };
  const body = [
    paragraph(field(ids, 'company.name', 'Company Name', 'SAMPLE COMPANY PTE. LTD.', { bold: true, caps: true }), center),
    paragraph(`${run('(Registration Number ')}${field(ids, 'company.uen', 'Company UEN', '202600001A')}${run(')')}`, center),
    paragraph(run('(Incorporated in the Republic of Singapore)'), center),
    paragraph(run('(“Company”)', { bold: true }), { align: 'center', after: 360 }),
    paragraph(
      run(variant.title, { bold: true }),
      { bottomBorder: true, after: 240, keepNext: true },
    ),
    paragraph(
      run(variant.intro),
      { align: 'both' },
    ),
    ...(options.beforeResolutions ?? []),
    resolutionSlot(ids, writer),
    paragraph(''),
    paragraph(run('[Signature Page Follow]', { italic: true }), { align: 'center' }),
    paragraph(
      [
        run('Dated this '),
        field(ids, 'resolution.date', 'Resolution Day', '9', {}, 'd'),
        run(' day of '),
        field(ids, 'resolution.date', 'Resolution Month', 'July', {}, 'MMMM'),
        run(', '),
        field(ids, 'resolution.date', 'Resolution Year', '2026', {}, 'yyyy'),
      ].join(''),
      { align: 'center', pageBreakBefore: true, after: 480 },
    ),
    repeatingSection(ids, variant.repeaterTag, variant.repeaterAlias, variant.signature(ids, writer).join('')),
  ].join('\n    ');

  const bytes = packageOakDoc(body, { extraStyles: options.extraStyles, typeface });
  return addOakDocConditionDefinitions(
    bytes,
    new Map((variant.conditions ?? []).map((condition) => [seededConditionId(condition), condition])),
  );
}

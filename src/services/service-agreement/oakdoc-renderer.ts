import { createHash } from 'node:crypto';
import { strFromU8, unzipSync, zipSync } from 'fflate';

import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import {
  resolveOakDocFields,
  writeOakDocControlValue,
} from '@/lib/document-editor/oakdoc-fields';
import {
  WORD_NS,
  appendTextRun,
  htmlToWordBlocks,
  wordElement,
} from '@/lib/document-editor/oakdoc-html-import';
import {
  OAKDOC_AGREEMENT_PROTOTYPE_TAGS,
  OAKDOC_AGREEMENT_SERVICE_ITEM_TAG_PREFIX,
  OAKDOC_AGREEMENT_SLOT_TAGS,
  isOakDocAgreementPrototypeTag,
} from '@/lib/document-editor/oakdoc-field-registry';
import {
  oakDocPartialTag,
  readOakDocSowSnapshot,
  type OakDocPartialPin,
  type OakDocSowSnapshot,
} from '@/lib/document-editor/oakdoc-partials';
import { canonicalJson } from '@/lib/document-generation-fingerprint';
import { resolvePlaceholders } from '@/lib/placeholder-resolver';
import {
  buildServiceAgreementItemPlaceholderContext,
  findMissingServiceAgreementItemPlaceholders,
  formatServiceAgreementCurrency,
  formatServiceAgreementFrequency,
  orderedServiceAgreementEntities,
  orderedServiceAgreementItems,
} from './renderer';
import { canonicalServiceAgreementData } from './canonical';
import type {
  AuthorizedRepresentativeSnapshot,
  ServiceAgreementDraftDto,
  ServiceAgreementFeeLineDto,
  ServiceAgreementItemDto,
} from './types';

const DOCUMENT_PART = 'word/document.xml';

export const OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS = OAKDOC_AGREEMENT_SLOT_TAGS;

const SLOT_TAG_ALIASES: Record<
  keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS,
  readonly string[]
> = {
  serviceSections: [
    OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS.serviceSections,
    '@agreement.serviceSections',
  ],
  feeTable: [
    OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS.feeTable,
    '@agreement.feeTable',
  ],
  entityAppendix: [
    OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS.entityAppendix,
    '@agreement.entityAppendix',
  ],
};

const SERVICE_ITEM_TAG_PREFIX = OAKDOC_AGREEMENT_SERVICE_ITEM_TAG_PREFIX;

export interface ServiceAgreementOakDocParty {
  contactId: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ServiceAgreementOakDocFieldContext {
  values: Readonly<Record<string, string>>;
  signers?: readonly ServiceAgreementOakDocParty[];
  authorizedRepresentatives?: readonly ServiceAgreementOakDocParty[];
}

export interface ServiceAgreementOakDocFieldResolutionInput {
  docxBytes: Uint8Array;
  agreement: ServiceAgreementDraftDto;
  values: Readonly<Record<string, string>>;
  signers: readonly ServiceAgreementOakDocParty[];
  authorizedRepresentatives: readonly ServiceAgreementOakDocParty[];
}

export interface ServiceAgreementOakDocFieldResolutionResult {
  bytes: Uint8Array;
  updated: number;
  unresolvedTags: string[];
  repeatersResolved?: number;
  signaturesResolved?: number;
  diagnostics?: string[];
}

export interface ServiceAgreementOakDocFieldResolutionAdapter {
  resolve(
    input: ServiceAgreementOakDocFieldResolutionInput,
  ): ServiceAgreementOakDocFieldResolutionResult;
}

export interface ServiceAgreementOakDocResolvedService {
  itemId: string;
  serviceVariantId: string;
  variantVersion: number;
  familyName: string;
  variantName: string;
  sowPartialId: string;
  partialVersion: number;
  partialDependencies: ServiceAgreementItemDto['partialDependencySnapshot'];
  entityIds: string[];
  missingRequiredPlaceholders: string[];
  staleVariantVersion: boolean;
  stalePartialVersion: boolean;
}

export interface ServiceAgreementOakDocDiagnostic {
  code:
    | 'INVALID_DOCX'
    | 'MISSING_STRUCTURAL_SLOT'
    | 'DUPLICATE_STRUCTURAL_SLOT'
    | 'INVALID_STRUCTURAL_SLOT_LOCATION'
    | 'MISSING_REQUIRED_SERVICE_FIELD'
    | 'STALE_SERVICE_VARIANT'
    | 'STALE_SERVICE_WORDING'
    | 'GENERATED_DOCUMENT_MISMATCH'
    | 'CANONICAL_HASH_MISMATCH'
    | 'INVALID_LAYOUT_PROTOTYPE'
    | 'FEE_ENTITY_MISSING'
    | 'FIELD_RESOLUTION';
  severity: 'error' | 'warning' | 'info';
  message: string;
  itemId?: string;
  slot?: keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS;
}

export interface ServiceAgreementOakDocSignatureMarker {
  part: string;
  tag: string;
  index: number;
}

export interface ServiceAgreementOakDocRenderResult {
  bytes: Uint8Array;
  diagnostics: ServiceAgreementOakDocDiagnostic[];
  resolvedServices: ServiceAgreementOakDocResolvedService[];
  unresolved: {
    structuralSlots: Array<keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS>;
    fieldTags: string[];
    serviceItems: Array<{
      itemId: string;
      placeholders: string[];
    }>;
  };
  agreementMetadata: {
    agreementId: string;
    generatedDocumentId: string;
    canonicalHash: string;
    status: ServiceAgreementDraftDto['status'];
    feeLineCount: number;
    entityCount: number;
  };
  fieldResolution: {
    updated: number;
    repeatersResolved: number;
    signaturesResolved: number;
  };
  signatureMarkers: {
    markers: ServiceAgreementOakDocSignatureMarker[];
    signerContactIds: string[];
    providedSignerCount: number;
  };
  /**
   * Word scope-of-work partials the rendered bytes reference. The caller
   * expands them from their pinned bytes before resolving fields.
   */
  sowPartialPins: OakDocPartialPin[];
}

function isWordElement(
  node: Node | null | undefined,
  localName: string,
): node is Element {
  return Boolean(
    node
      && node.nodeType === Node.ELEMENT_NODE
      && (node as Element).namespaceURI === WORD_NS
      && (node as Element).localName === localName,
  );
}

function wordChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === Node.ELEMENT_NODE,
  );
}

function wordChild(node: Node, localName: string): Element | undefined {
  return wordChildren(node).find((child) => isWordElement(child, localName));
}

function getWordVal(element: Element | undefined): string {
  return element
    ? (element.getAttributeNS(WORD_NS, 'val') || element.getAttribute('w:val') || '')
    : '';
}

function serializeXml(xml: XMLDocument): Uint8Array<ArrayBuffer> {
  return encodeOakDocZipText(new XMLSerializer().serializeToString(xml));
}

function parseWordXml(bytes: Uint8Array): XMLDocument {
  const xml = new DOMParser().parseFromString(
    strFromU8(bytes),
    'application/xml',
  );
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('OakDoc could not parse word/document.xml.');
  }
  return xml;
}

function contentControlTag(sdt: Element): string {
  const properties = wordChild(sdt, 'sdtPr');
  return properties ? getWordVal(wordChild(properties, 'tag')) : '';
}

function isRendererOwnedTag(tag: string): boolean {
  return Object.values(SLOT_TAG_ALIASES).some((aliases) => aliases.includes(tag))
    || tag.startsWith(SERVICE_ITEM_TAG_PREFIX)
    || isOakDocAgreementPrototypeTag(tag);
}

function defaultFieldResolver(
  input: ServiceAgreementOakDocFieldResolutionInput,
): ServiceAgreementOakDocFieldResolutionResult {
  const resolved = resolveOakDocFields(input.docxBytes, input.values);
  return {
    bytes: resolved.bytes,
    updated: resolved.updated,
    unresolvedTags: resolved.unresolvedTags.filter(
      (tag) => !isRendererOwnedTag(tag),
    ),
    repeatersResolved: 0,
    signaturesResolved: 0,
  };
}

export const DEFAULT_SERVICE_AGREEMENT_OAKDOC_FIELD_ADAPTER: ServiceAgreementOakDocFieldResolutionAdapter = {
  resolve: defaultFieldResolver,
};

function canonicalAgreementHash(agreement: ServiceAgreementDraftDto): string {
  return createHash('sha256')
    .update(canonicalJson(canonicalServiceAgreementData(agreement)))
    .digest('hex');
}


function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlSafeServiceContext(
  context: ReturnType<typeof buildServiceAgreementItemPlaceholderContext>,
): ReturnType<typeof buildServiceAgreementItemPlaceholderContext> {
  return {
    service: {
      ...context.service,
      familyName: escapeHtmlValue(context.service.familyName),
      variantName: escapeHtmlValue(context.service.variantName),
      entities: context.service.entities.map((entity) => ({
        ...entity,
        name: escapeHtmlValue(entity.name),
        uen: escapeHtmlValue(entity.uen),
      })),
      fields: Object.fromEntries(
        Object.entries(context.service.fields).map(([key, value]) => [
          key,
          escapeHtmlValue(value),
        ]),
      ),
    },
  };
}

function representativeParties(
  snapshots: readonly AuthorizedRepresentativeSnapshot[],
): ServiceAgreementOakDocParty[] {
  return snapshots.map((representative) => ({
    contactId: representative.id,
    name: representative.name,
    role: representative.role,
    email: representative.email,
    phone: representative.phone,
  }));
}

function serviceMetadata(
  agreement: ServiceAgreementDraftDto,
): ServiceAgreementOakDocResolvedService[] {
  return orderedServiceAgreementItems(agreement).map((item) => {
    const context = buildServiceAgreementItemPlaceholderContext({
      agreement,
      item,
    });
    return {
      itemId: item.id,
      serviceVariantId: item.serviceVariantId,
      variantVersion: item.variantVersion,
      familyName: item.familyNameSnapshot,
      variantName: item.variantNameSnapshot,
      sowPartialId: item.sowPartialId,
      partialVersion: item.partialVersion,
      partialDependencies: item.partialDependencySnapshot,
      entityIds: [...item.entityIds],
      missingRequiredPlaceholders: findMissingServiceAgreementItemPlaceholders({
        item,
        context,
      }),
      staleVariantVersion: item.staleVariantVersion,
      stalePartialVersion: item.stalePartialVersion,
    };
  });
}

function diagnosticForServices(
  services: readonly ServiceAgreementOakDocResolvedService[],
): ServiceAgreementOakDocDiagnostic[] {
  return services.flatMap((service) => {
    const diagnostics: ServiceAgreementOakDocDiagnostic[] = [];
    for (const placeholder of service.missingRequiredPlaceholders) {
      diagnostics.push({
        code: 'MISSING_REQUIRED_SERVICE_FIELD',
        severity: 'error',
        itemId: service.itemId,
        message: `Service item ${service.itemId} is missing required field ${placeholder}.`,
      });
    }
    if (service.staleVariantVersion) {
      diagnostics.push({
        code: 'STALE_SERVICE_VARIANT',
        severity: 'warning',
        itemId: service.itemId,
        message: `Service item ${service.itemId} was snapshotted from an older service variant version.`,
      });
    }
    if (service.stalePartialVersion) {
      diagnostics.push({
        code: 'STALE_SERVICE_WORDING',
        severity: 'warning',
        itemId: service.itemId,
        message: `Service item ${service.itemId} uses snapshotted SOW wording that is older than the current partial.`,
      });
    }
    return diagnostics;
  });
}

class WordIdAllocator {
  private nextId: number;

  constructor(document: XMLDocument) {
    const existing = Array.from(document.getElementsByTagNameNS(WORD_NS, 'id'))
      .map((element) => Number(getWordVal(element)))
      .filter((value) => Number.isInteger(value) && value >= 0);
    this.nextId = Math.max(100000, ...existing, 99999) + 1;
  }

  take(): number {
    const value = this.nextId;
    this.nextId += 1;
    return value;
  }
}

function createServiceItemControl(input: {
  document: XMLDocument;
  allocator: WordIdAllocator;
  agreement: ServiceAgreementDraftDto;
  item: ServiceAgreementItemDto;
  sowSnapshot: OakDocSowSnapshot | null;
  pageBreakBefore: boolean;
}): Element {
  const wrapper = wordElement(input.document, 'sdt');
  const properties = wordElement(input.document, 'sdtPr');
  properties.appendChild(
    wordElement(input.document, 'alias', {
      val: `${input.item.variantNameSnapshot} | variant v${input.item.variantVersion} | SOW v${input.item.partialVersion}`,
    }),
  );
  properties.appendChild(
    wordElement(input.document, 'tag', {
      val: `${SERVICE_ITEM_TAG_PREFIX}${input.item.id}`,
    }),
  );
  properties.appendChild(
    wordElement(input.document, 'id', { val: String(input.allocator.take()) }),
  );
  wrapper.appendChild(properties);

  const content = wordElement(input.document, 'sdtContent');
  if (input.pageBreakBefore) {
    const pageBreak = wordElement(input.document, 'p');
    const paragraphProperties = wordElement(input.document, 'pPr');
    paragraphProperties.appendChild(wordElement(input.document, 'pageBreakBefore'));
    pageBreak.appendChild(paragraphProperties);
    content.appendChild(pageBreak);
  }
  if (input.sowSnapshot) {
    content.appendChild(createPartialReference(input.document, input.allocator, input.sowSnapshot.pin.partialId));
  } else {
    const context = buildServiceAgreementItemPlaceholderContext({
      agreement: input.agreement,
      item: input.item,
    });
    const rendered = resolvePlaceholders(
      input.item.partialContentSnapshot,
      htmlSafeServiceContext(context),
      { missingPlaceholder: 'keep', dateFormat: 'dd MMMM yyyy' },
    );
    for (const block of htmlToWordBlocks(input.document, rendered.resolved)) {
      content.appendChild(block);
    }
  }
  wrapper.appendChild(content);
  return wrapper;
}

/** A block reference that generation replaces with the pinned Word partial. */
function createPartialReference(document: XMLDocument, allocator: WordIdAllocator, partialId: string): Element {
  const reference = wordElement(document, 'sdt');
  const properties = wordElement(document, 'sdtPr');
  properties.appendChild(wordElement(document, 'tag', { val: oakDocPartialTag(partialId) }));
  properties.appendChild(wordElement(document, 'id', { val: String(allocator.take()) }));
  reference.appendChild(properties);
  const content = wordElement(document, 'sdtContent');
  content.appendChild(wordElement(document, 'p'));
  reference.appendChild(content);
  return reference;
}

function rowProperties(
  document: XMLDocument,
  options: { header?: boolean; cantSplit?: boolean } = {},
): Element | null {
  if (!options.header && !options.cantSplit) return null;
  const properties = wordElement(document, 'trPr');
  if (options.header) properties.appendChild(wordElement(document, 'tblHeader'));
  if (options.cantSplit) properties.appendChild(wordElement(document, 'cantSplit'));
  return properties;
}

function createTableCell(input: {
  document: XMLDocument;
  width: number;
  text?: string;
  bold?: boolean;
  underline?: boolean;
  colspan?: number;
}): Element {
  const cell = wordElement(input.document, 'tc');
  const properties = wordElement(input.document, 'tcPr');
  properties.appendChild(
    wordElement(input.document, 'tcW', {
      w: String(input.width),
      type: 'dxa',
    }),
  );
  if (input.colspan && input.colspan > 1) {
    properties.appendChild(
      wordElement(input.document, 'gridSpan', { val: String(input.colspan) }),
    );
  }
  cell.appendChild(properties);
  const paragraph = wordElement(input.document, 'p');
  if (input.text !== undefined) {
    appendTextRun(input.document, paragraph, input.text, {
      bold: input.bold,
      underline: input.underline,
    });
  }
  cell.appendChild(paragraph);
  return cell;
}

function feeDisplay(
  fee: ServiceAgreementFeeLineDto,
  options: { wholeAmounts?: boolean } = {},
): string {
  const frequency = formatServiceAgreementFrequency(fee);
  return [
    formatServiceAgreementCurrency(fee.amount, fee.currency, options),
    frequency,
  ].filter(Boolean).join(' ');
}

function createFeeTable(
  document: XMLDocument,
  agreement: ServiceAgreementDraftDto,
): Element {
  const table = wordElement(document, 'tbl');
  const width = 9000;
  const descriptionWidth = 6300;
  const feeWidth = 2700;

  const properties = wordElement(document, 'tblPr');
  properties.appendChild(wordElement(document, 'tblW', { w: String(width), type: 'dxa' }));
  properties.appendChild(wordElement(document, 'tblLayout', { type: 'fixed' }));
  properties.appendChild(
    wordElement(document, 'tblLook', {
      val: '04A0',
      firstRow: '1',
      lastRow: '0',
      firstColumn: '0',
      lastColumn: '0',
      noHBand: '0',
      noVBand: '1',
    }),
  );
  table.appendChild(properties);

  const grid = wordElement(document, 'tblGrid');
  grid.appendChild(wordElement(document, 'gridCol', { w: String(descriptionWidth) }));
  grid.appendChild(wordElement(document, 'gridCol', { w: String(feeWidth) }));
  table.appendChild(grid);

  const header = wordElement(document, 'tr');
  const headerProperties = rowProperties(document, { header: true, cantSplit: true });
  if (headerProperties) header.appendChild(headerProperties);
  header.appendChild(
    createTableCell({
      document,
      width: descriptionWidth,
      text: 'Description',
      bold: true,
    }),
  );
  header.appendChild(
    createTableCell({
      document,
      width: feeWidth,
      text: 'Fee',
      bold: true,
    }),
  );
  table.appendChild(header);

  const entities = orderedServiceAgreementEntities(agreement);
  const items = orderedServiceAgreementItems(agreement);
  let hasPreviousGroup = false;

  const appendFee = (fee: ServiceAgreementFeeLineDto) => {
    const row = wordElement(document, 'tr');
    const properties = rowProperties(document, { cantSplit: true });
    if (properties) row.appendChild(properties);
    row.appendChild(
      createTableCell({
        document,
        width: descriptionWidth,
        text: fee.description,
      }),
    );
    row.appendChild(
      createTableCell({
        document,
        width: feeWidth,
        text: feeDisplay(fee),
      }),
    );
    table.appendChild(row);
  };

  for (const entity of entities) {
    const fees = items.flatMap((item) =>
      [...item.feeLines]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .filter((fee) => fee.agreementEntityId === entity.id),
    );
    if (fees.length === 0) continue;

    if (hasPreviousGroup) {
      const spacer = wordElement(document, 'tr');
      const properties = rowProperties(document, { cantSplit: true });
      if (properties) spacer.appendChild(properties);
      spacer.appendChild(
        createTableCell({
          document,
          width,
          text: '',
          colspan: 2,
        }),
      );
      table.appendChild(spacer);
    }
    hasPreviousGroup = true;

    const group = wordElement(document, 'tr');
    const groupProperties = rowProperties(document, { cantSplit: true });
    if (groupProperties) group.appendChild(groupProperties);
    group.appendChild(
      createTableCell({
        document,
        width,
        text: entity.nameSnapshot,
        underline: true,
        colspan: 2,
      }),
    );
    table.appendChild(group);
    fees.forEach(appendFee);
  }

  const knownEntityIds = new Set(entities.map((entity) => entity.id));
  const orphanFees = items.flatMap((item) =>
    [...item.feeLines]
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .filter((fee) => !knownEntityIds.has(fee.agreementEntityId)),
  );
  if (orphanFees.length > 0 && hasPreviousGroup) {
    const spacer = wordElement(document, 'tr');
    const properties = rowProperties(document, { cantSplit: true });
    if (properties) spacer.appendChild(properties);
    spacer.appendChild(
      createTableCell({
        document,
        width,
        text: '',
        colspan: 2,
      }),
    );
    table.appendChild(spacer);
  }
  orphanFees.forEach(appendFee);

  return table;
}

function createEntityAppendix(
  document: XMLDocument,
  agreement: ServiceAgreementDraftDto,
): Element[] {
  return orderedServiceAgreementEntities(agreement).map((entity, index) => {
    const paragraph = wordElement(document, 'p');
    const properties = wordElement(document, 'pPr');
    properties.appendChild(
      wordElement(document, 'ind', { left: '720', hanging: '360' }),
    );
    paragraph.appendChild(properties);
    appendTextRun(
      document,
      paragraph,
      `${index + 1}. ${entity.nameSnapshot} (UEN: ${entity.uenSnapshot})`,
    );
    return paragraph;
  });
}

function controlsTagged(root: Element, tag: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(WORD_NS, 'sdt'))
    .filter((sdt) => contentControlTag(sdt) === tag);
}

/** Replace a control with its own content. */
function unwrapControl(sdt: Element): void {
  const content = wordChild(sdt, 'sdtContent');
  const parent = sdt.parentNode;
  if (!parent) return;
  while (content?.firstChild) parent.insertBefore(content.firstChild, sdt);
  parent.removeChild(sdt);
}

/** Fill every prototype field with this tag under `root` and unwrap it. */
function fillPrototypeField(root: Element, tag: string, value: string): void {
  for (const sdt of controlsTagged(root, tag)) {
    writeOakDocControlValue(sdt, value);
    unwrapControl(sdt);
  }
}

/** The paragraph that holds a prototype field, if any. */
function paragraphHolding(root: Element, tag: string): Element | undefined {
  let node: Node | null | undefined = controlsTagged(root, tag)[0];
  while (node && !isWordElement(node, 'p')) node = node.parentNode;
  return node ?? undefined;
}

function reseedControlIds(root: Element, allocator: WordIdAllocator): void {
  for (const sdt of Array.from(root.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
    const properties = wordChild(sdt, 'sdtPr');
    const id = properties ? wordChild(properties, 'id') : undefined;
    if (id) id.setAttributeNS(WORD_NS, 'w:val', String(allocator.take()));
  }
}

function normalizedLabel(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Fill one SOW row prototype. A service with a single charge named like the
 * service shows its amount on the service line; otherwise each charge is a
 * labelled line under the service name with its amount beside it. Amounts
 * are never summed.
 */
function fillSowRow(
  row: Element,
  item: ServiceAgreementItemDto,
  fees: readonly ServiceAgreementFeeLineDto[],
): void {
  const tags = OAKDOC_AGREEMENT_PROTOTYPE_TAGS;
  const [chargeRowPrototype] = controlsTagged(row, tags.feeChargeRow);
  if (chargeRowPrototype) {
    // A charge row prototype lists every charge on its own row, even when
    // the service has only one.
    for (const fee of fees) {
      const chargeRow = chargeRowPrototype.cloneNode(true) as Element;
      fillPrototypeField(chargeRow, tags.feeChargeDescription, fee.description);
      fillPrototypeField(chargeRow, tags.feeChargeAmount, feeDisplay(fee, { wholeAmounts: true }));
      chargeRowPrototype.parentNode?.insertBefore(chargeRow, chargeRowPrototype);
      unwrapControl(chargeRow);
    }
    chargeRowPrototype.parentNode?.removeChild(chargeRowPrototype);
    fillPrototypeField(row, tags.feeSowName, item.variantNameSnapshot);
    fillPrototypeField(row, tags.feeSowAmount, '');
    return;
  }

  const descriptionPrototype = paragraphHolding(row, tags.feeChargeDescription);
  const amountPrototype = paragraphHolding(row, tags.feeChargeAmount);
  const compact = fees.length === 1
    && normalizedLabel(fees[0].description) === normalizedLabel(item.variantNameSnapshot);

  fillPrototypeField(row, tags.feeSowName, item.variantNameSnapshot);
  fillPrototypeField(row, tags.feeSowAmount, compact ? feeDisplay(fees[0], { wholeAmounts: true }) : '');
  if (!compact) {
    for (const fee of fees) {
      if (descriptionPrototype) {
        const line = descriptionPrototype.cloneNode(true) as Element;
        fillPrototypeField(line, tags.feeChargeDescription, fee.description);
        descriptionPrototype.parentNode?.insertBefore(line, descriptionPrototype);
      }
      if (amountPrototype) {
        const line = amountPrototype.cloneNode(true) as Element;
        fillPrototypeField(line, tags.feeChargeAmount, feeDisplay(fee, { wholeAmounts: true }));
        amountPrototype.parentNode?.insertBefore(line, amountPrototype);
      }
    }
  }
  descriptionPrototype?.parentNode?.removeChild(descriptionPrototype);
  amountPrototype?.parentNode?.removeChild(amountPrototype);
}

/**
 * Template-owned fee layout: the master's fee slot holds one company group
 * prototype with one SOW row prototype inside. The group can be a heading
 * with its own table, or rows within one shared table. Each agreement entity
 * with fees gets its own copy of the group, even when there is only one
 * entity, with one SOW row per service in agreement order. Returns null when
 * the slot has no prototype, so older masters keep the built-in table.
 */
function renderFeePrototype(input: {
  slot: Element;
  agreement: ServiceAgreementDraftDto;
  allocator: WordIdAllocator;
  diagnostics: ServiceAgreementOakDocDiagnostic[];
}): Element[] | null {
  const tags = OAKDOC_AGREEMENT_PROTOTYPE_TAGS;
  const [groupPrototype] = controlsTagged(input.slot, tags.feeCompany);
  if (!groupPrototype) return null;
  if (controlsTagged(groupPrototype, tags.feeSowRow).length !== 1) {
    input.diagnostics.push({
      code: 'INVALID_LAYOUT_PROTOTYPE',
      severity: 'error',
      slot: 'feeTable',
      message: 'The company fee group must contain exactly one SOW row prototype.',
    });
    return null;
  }

  const entities = orderedServiceAgreementEntities(input.agreement);
  const items = orderedServiceAgreementItems(input.agreement);
  const knownEntityIds = new Set(entities.map((entity) => entity.id));
  const orphanFees = items.flatMap((item) => item.feeLines)
    .filter((fee) => !knownEntityIds.has(fee.agreementEntityId));
  if (orphanFees.length > 0) {
    input.diagnostics.push({
      code: 'FEE_ENTITY_MISSING',
      severity: 'error',
      slot: 'feeTable',
      message: `${orphanFees.length} fee line${orphanFees.length === 1 ? ' belongs' : 's belong'} to a company that is not in this agreement.`,
    });
  }

  // Expand in place, so a group can be a heading and its own table or rows
  // inside one shared table.
  for (const entity of entities) {
    const services = items
      .map((item) => ({
        item,
        fees: [...item.feeLines]
          .filter((fee) => fee.agreementEntityId === entity.id)
          .sort((left, right) => left.displayOrder - right.displayOrder),
      }))
      .filter((service) => service.fees.length > 0);
    if (services.length === 0) continue;

    const group = groupPrototype.cloneNode(true) as Element;
    const [rowPrototype] = controlsTagged(group, tags.feeSowRow);
    for (const service of services) {
      const row = rowPrototype.cloneNode(true) as Element;
      fillSowRow(row, service.item, service.fees);
      rowPrototype.parentNode?.insertBefore(row, rowPrototype);
      unwrapControl(row);
    }
    rowPrototype.parentNode?.removeChild(rowPrototype);
    fillPrototypeField(group, tags.feeCompanyName, entity.nameSnapshot);
    groupPrototype.parentNode?.insertBefore(group, groupPrototype);
    unwrapControl(group);
  }
  groupPrototype.parentNode?.removeChild(groupPrototype);
  reseedControlIds(input.slot, input.allocator);
  const content = wordChild(input.slot, 'sdtContent');
  return content ? wordChildren(content) : [];
}

/**
 * Template-owned entity list: the entity slot's content is repeated once
 * per agreement entity with the name and UEN filled in, keeping its own
 * numbering and formatting. Returns null for masters without a prototype.
 */
function renderEntityPrototype(
  slot: Element,
  agreement: ServiceAgreementDraftDto,
  allocator: WordIdAllocator,
): Element[] | null {
  const tags = OAKDOC_AGREEMENT_PROTOTYPE_TAGS;
  const content = wordChild(slot, 'sdtContent');
  if (!content || controlsTagged(content, tags.entityName).length === 0) return null;
  return orderedServiceAgreementEntities(agreement).flatMap((entity) => {
    const copy = content.cloneNode(true) as Element;
    fillPrototypeField(copy, tags.entityName, entity.nameSnapshot);
    fillPrototypeField(copy, tags.entityUen, entity.uenSnapshot);
    reseedControlIds(copy, allocator);
    return wordChildren(copy);
  });
}

/**
 * A service slot whose placeholder paragraph breaks the page asks for every
 * service, including the first, to start on a new page. Otherwise only the
 * second and later services do, as before.
 */
function everyServiceStartsNewPage(slot: Element): boolean {
  const content = wordChild(slot, 'sdtContent');
  const first = content ? wordChildren(content).find((child) => isWordElement(child, 'p')) : undefined;
  const properties = first ? wordChild(first, 'pPr') : undefined;
  const pageBreak = properties ? wordChild(properties, 'pageBreakBefore') : undefined;
  return Boolean(pageBreak) && !['0', 'false', 'off'].includes(getWordVal(pageBreak));
}

const PARAGRAPH_PROPERTY_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl',
  'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens',
  'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE',
  'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind',
  'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
  'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr',
  'sectPr', 'pPrChange',
] as const;

function addPageBreakBefore(paragraph: Element): void {
  const document = paragraph.ownerDocument;
  let properties = wordChild(paragraph, 'pPr');
  if (!properties) {
    properties = document.createElementNS(WORD_NS, 'w:pPr');
    paragraph.insertBefore(properties, paragraph.firstChild);
  }
  const existing = wordChild(properties, 'pageBreakBefore');
  if (existing) existing.parentNode?.removeChild(existing);
  const position = PARAGRAPH_PROPERTY_ORDER.indexOf('pageBreakBefore');
  const next = wordChildren(properties).find((child) => {
    const index = PARAGRAPH_PROPERTY_ORDER.indexOf(child.localName as typeof PARAGRAPH_PROPERTY_ORDER[number]);
    return index > position;
  });
  properties.insertBefore(document.createElementNS(WORD_NS, 'w:pageBreakBefore'), next ?? null);
}

/**
 * Move the page break that starts each service onto the service's first
 * paragraph, so a new page does not open with an empty line. Runs after the
 * services' Word partials are expanded.
 */
export function finalizeServiceAgreementPageBreaks(docxBytes: Uint8Array): Uint8Array {
  const files = unzipSync(docxBytes);
  const documentBytes = files[DOCUMENT_PART];
  if (!documentBytes) return docxBytes;
  const xml = parseWordXml(documentBytes);
  let changed = false;
  for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
    if (!contentControlTag(sdt).startsWith(SERVICE_ITEM_TAG_PREFIX)) continue;
    const content = wordChild(sdt, 'sdtContent');
    const [breakParagraph, next] = content ? wordChildren(content) : [];
    if (!breakParagraph || !isWordElement(breakParagraph, 'p') || !isWordElement(next, 'p')) continue;
    const properties = wordChild(breakParagraph, 'pPr');
    const isBareBreak = Boolean(properties && wordChild(properties, 'pageBreakBefore'))
      && wordChildren(breakParagraph).every((child) => isWordElement(child, 'pPr'));
    if (!isBareBreak) continue;
    addPageBreakBefore(next);
    content!.removeChild(breakParagraph);
    changed = true;
  }
  if (!changed) return docxBytes;
  files[DOCUMENT_PART] = serializeXml(xml);
  return zipSync(files, { level: 6 });
}

function findSlotControls(
  document: XMLDocument,
  slot: keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS,
): Element[] {
  const aliases = SLOT_TAG_ALIASES[slot];
  return Array.from(document.getElementsByTagNameNS(WORD_NS, 'sdt'))
    .filter((sdt) => aliases.includes(contentControlTag(sdt)));
}

function replaceStructuralControl(
  control: Element,
  replacements: Element[],
): boolean {
  const parent = control.parentNode;
  if (!parent) return false;

  if (isWordElement(parent, 'p')) {
    const siblings = wordChildren(parent).filter(
      (child) => !isWordElement(child, 'pPr') && child !== control,
    );
    if (siblings.length > 0 || !parent.parentNode) return false;
    const paragraphParent = parent.parentNode;
    for (const replacement of replacements) {
      paragraphParent.insertBefore(replacement, parent);
    }
    paragraphParent.removeChild(parent);
    return true;
  }

  for (const replacement of replacements) {
    parent.insertBefore(replacement, control);
  }
  parent.removeChild(control);
  return true;
}

function wordXmlPartNames(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).filter(
    (name) => name === DOCUMENT_PART || /^word\/(header|footer)\d+\.xml$/i.test(name),
  );
}

function inspectSignatureMarkers(
  docxBytes: Uint8Array,
): ServiceAgreementOakDocSignatureMarker[] {
  const files = unzipSync(docxBytes);
  const markers: ServiceAgreementOakDocSignatureMarker[] = [];
  for (const part of wordXmlPartNames(files)) {
    const xml = parseWordXml(files[part]);
    let index = 0;
    for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
      const tag = contentControlTag(sdt);
      if (!/signature/i.test(tag)) continue;
      markers.push({ part, tag, index });
      index += 1;
    }
  }
  return markers;
}

function slotDiagnostics(
  document: XMLDocument,
): {
  diagnostics: ServiceAgreementOakDocDiagnostic[];
  unresolved: Array<keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS>;
} {
  const diagnostics: ServiceAgreementOakDocDiagnostic[] = [];
  const unresolved: Array<keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS> = [];
  for (const slot of Object.keys(
    OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS,
  ) as Array<keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS>) {
    const controls = findSlotControls(document, slot);
    if (controls.length === 0) {
      unresolved.push(slot);
      diagnostics.push({
        code: 'MISSING_STRUCTURAL_SLOT',
        severity: 'error',
        slot,
        message: `OakDoc Service Agreement master is missing the ${OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS[slot]} structural control.`,
      });
    } else if (controls.length > 1) {
      unresolved.push(slot);
      diagnostics.push({
        code: 'DUPLICATE_STRUCTURAL_SLOT',
        severity: 'error',
        slot,
        message: `OakDoc Service Agreement master contains ${controls.length} ${OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS[slot]} structural controls; exactly one is required.`,
      });
    }
  }
  return { diagnostics, unresolved };
}

export function renderServiceAgreementOakDoc(input: {
  masterDocxBytes: Uint8Array;
  agreement: ServiceAgreementDraftDto;
  fieldContext: ServiceAgreementOakDocFieldContext;
  fieldResolver?: ServiceAgreementOakDocFieldResolutionAdapter;
  expectedGeneratedDocumentId?: string;
  expectedCanonicalHash?: string;
}): ServiceAgreementOakDocRenderResult {
  const agreementHash = canonicalAgreementHash(input.agreement);
  const services = serviceMetadata(input.agreement);
  const diagnostics = diagnosticForServices(services);
  const unresolvedServiceItems = services
    .filter((service) => service.missingRequiredPlaceholders.length > 0)
    .map((service) => ({
      itemId: service.itemId,
      placeholders: [...service.missingRequiredPlaceholders],
    }));
  const representatives = input.fieldContext.authorizedRepresentatives
    ? [...input.fieldContext.authorizedRepresentatives]
    : representativeParties(input.agreement.authorizedRepresentativeSnapshots);
  const signers = input.fieldContext.signers
    ? [...input.fieldContext.signers]
    : representatives.filter((representative) =>
        input.agreement.signerContactIds.includes(representative.contactId),
      );

  const baseMetadata = {
    agreementId: input.agreement.id,
    generatedDocumentId: input.agreement.generatedDocumentId,
    canonicalHash: agreementHash,
    status: input.agreement.status,
    feeLineCount: input.agreement.items.reduce(
      (total, item) => total + item.feeLines.length,
      0,
    ),
    entityCount: input.agreement.entities.length,
  };

  if (
    input.expectedGeneratedDocumentId
    && input.expectedGeneratedDocumentId !== input.agreement.generatedDocumentId
  ) {
    diagnostics.push({
      code: 'GENERATED_DOCUMENT_MISMATCH',
      severity: 'error',
      message: 'Service Agreement does not match the expected generated document.',
    });
  }
  if (
    input.expectedCanonicalHash
    && input.expectedCanonicalHash.toLowerCase() !== agreementHash
  ) {
    diagnostics.push({
      code: 'CANONICAL_HASH_MISMATCH',
      severity: 'error',
      message: 'Service Agreement structured hash no longer matches the expected canonical version.',
    });
  }

  if (
    diagnostics.some((diagnostic) =>
      diagnostic.code === 'GENERATED_DOCUMENT_MISMATCH'
      || diagnostic.code === 'CANONICAL_HASH_MISMATCH')
  ) {
    return {
      bytes: input.masterDocxBytes,
      diagnostics,
      resolvedServices: services,
      unresolved: {
        structuralSlots: [],
        fieldTags: [],
        serviceItems: unresolvedServiceItems,
      },
      agreementMetadata: baseMetadata,
      fieldResolution: {
        updated: 0,
        repeatersResolved: 0,
        signaturesResolved: 0,
      },
      signatureMarkers: {
        markers: inspectSignatureMarkers(input.masterDocxBytes),
        signerContactIds: [...input.agreement.signerContactIds],
        providedSignerCount: signers.length,
      },
      sowPartialPins: [],
    };
  }

  let files: Record<string, Uint8Array>;
  let xml: XMLDocument;
  try {
    files = unzipSync(input.masterDocxBytes);
    const documentBytes = files[DOCUMENT_PART];
    if (!documentBytes) throw new Error('This DOCX has no word/document.xml part.');
    xml = parseWordXml(documentBytes);
  } catch (error) {
    diagnostics.push({
      code: 'INVALID_DOCX',
      severity: 'error',
      message: error instanceof Error ? error.message : 'OakDoc master DOCX is invalid.',
    });
    return {
      bytes: input.masterDocxBytes,
      diagnostics,
      resolvedServices: services,
      unresolved: {
        structuralSlots: [],
        fieldTags: [],
        serviceItems: unresolvedServiceItems,
      },
      agreementMetadata: baseMetadata,
      fieldResolution: {
        updated: 0,
        repeatersResolved: 0,
        signaturesResolved: 0,
      },
      signatureMarkers: {
        markers: [],
        signerContactIds: [...input.agreement.signerContactIds],
        providedSignerCount: signers.length,
      },
      sowPartialPins: [],
    };
  }

  const slots = slotDiagnostics(xml);
  diagnostics.push(...slots.diagnostics);
  if (slots.unresolved.length > 0) {
    return {
      bytes: input.masterDocxBytes,
      diagnostics,
      resolvedServices: services,
      unresolved: {
        structuralSlots: slots.unresolved,
        fieldTags: [],
        serviceItems: unresolvedServiceItems,
      },
      agreementMetadata: baseMetadata,
      fieldResolution: {
        updated: 0,
        repeatersResolved: 0,
        signaturesResolved: 0,
      },
      signatureMarkers: {
        markers: inspectSignatureMarkers(input.masterDocxBytes),
        signerContactIds: [...input.agreement.signerContactIds],
        providedSignerCount: signers.length,
      },
      sowPartialPins: [],
    };
  }

  const allocator = new WordIdAllocator(xml);
  const sowPartialPins: OakDocPartialPin[] = [];
  const [serviceSlot] = findSlotControls(xml, 'serviceSections');
  const breakBeforeFirstService = everyServiceStartsNewPage(serviceSlot);
  const serviceControls = orderedServiceAgreementItems(input.agreement).map(
    (item, index) => {
      const sowSnapshot = readOakDocSowSnapshot(item.partialContentSnapshot);
      if (sowSnapshot) sowPartialPins.push(sowSnapshot.pin);
      return createServiceItemControl({
        document: xml,
        allocator,
        agreement: input.agreement,
        item,
        sowSnapshot,
        pageBreakBefore: index > 0 || breakBeforeFirstService,
      });
    },
  );

  const [feeSlot] = findSlotControls(xml, 'feeTable');
  const [entitySlot] = findSlotControls(xml, 'entityAppendix');
  const feeBlocks = renderFeePrototype({
    slot: feeSlot,
    agreement: input.agreement,
    allocator,
    diagnostics,
  }) ?? [createFeeTable(xml, input.agreement)];
  const entityBlocks = renderEntityPrototype(entitySlot, input.agreement, allocator)
    ?? createEntityAppendix(xml, input.agreement);

  const replacements: Array<{
    slot: keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS;
    nodes: Element[];
  }> = [
    { slot: 'serviceSections', nodes: serviceControls },
    { slot: 'feeTable', nodes: feeBlocks },
    { slot: 'entityAppendix', nodes: entityBlocks },
  ];

  const structuralFailures: Array<keyof typeof OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS> = [];
  for (const replacement of replacements) {
    const [control] = findSlotControls(xml, replacement.slot);
    if (!control || !replaceStructuralControl(control, replacement.nodes)) {
      structuralFailures.push(replacement.slot);
      diagnostics.push({
        code: 'INVALID_STRUCTURAL_SLOT_LOCATION',
        severity: 'error',
        slot: replacement.slot,
        message: `The ${OAKDOC_SERVICE_AGREEMENT_SLOT_TAGS[replacement.slot]} structural control must be a block control or occupy its own paragraph.`,
      });
    }
  }

  if (structuralFailures.length > 0) {
    return {
      bytes: input.masterDocxBytes,
      diagnostics,
      resolvedServices: services,
      unresolved: {
        structuralSlots: structuralFailures,
        fieldTags: [],
        serviceItems: unresolvedServiceItems,
      },
      agreementMetadata: baseMetadata,
      fieldResolution: {
        updated: 0,
        repeatersResolved: 0,
        signaturesResolved: 0,
      },
      signatureMarkers: {
        markers: inspectSignatureMarkers(input.masterDocxBytes),
        signerContactIds: [...input.agreement.signerContactIds],
        providedSignerCount: signers.length,
      },
      sowPartialPins: [],
    };
  }

  files[DOCUMENT_PART] = serializeXml(xml);
  const structurallyResolvedBytes = zipSync(files, { level: 6 });
  const fieldAdapter =
    input.fieldResolver ?? DEFAULT_SERVICE_AGREEMENT_OAKDOC_FIELD_ADAPTER;
  const fieldResolution = fieldAdapter.resolve({
    docxBytes: structurallyResolvedBytes,
    agreement: input.agreement,
    values: input.fieldContext.values,
    signers,
    authorizedRepresentatives: representatives,
  });
  for (const message of fieldResolution.diagnostics ?? []) {
    diagnostics.push({
      code: 'FIELD_RESOLUTION',
      severity: 'warning',
      message,
    });
  }

  return {
    bytes: fieldResolution.bytes,
    diagnostics,
    resolvedServices: services,
    unresolved: {
      structuralSlots: [],
      fieldTags: [...fieldResolution.unresolvedTags],
      serviceItems: unresolvedServiceItems,
    },
    agreementMetadata: baseMetadata,
    fieldResolution: {
      updated: fieldResolution.updated,
      repeatersResolved: fieldResolution.repeatersResolved ?? 0,
      signaturesResolved: fieldResolution.signaturesResolved ?? 0,
    },
    signatureMarkers: {
      markers: inspectSignatureMarkers(fieldResolution.bytes),
      signerContactIds: [...input.agreement.signerContactIds],
      providedSignerCount: signers.length,
    },
    sowPartialPins,
  };
}

import { resolvePlaceholders } from '@/lib/placeholder-resolver';
import {
  DEFAULT_DOCUMENT_FONT_SIZE,
  normalizeDocumentFontSize,
} from '@/components/documents/document-typography';
import {
  SERVICE_AGREEMENT_SLOTS,
  findServiceAgreementSlotViolations,
} from '@/lib/service-agreement-template';
import type {
  ServiceAgreementDraftDto,
  ServiceAgreementEntityDto,
  ServiceAgreementFeeLineDto,
  ServiceAgreementItemDto,
} from './types';

export interface ServiceAgreementItemPlaceholderContext {
  service: {
    itemId: string;
    familyName: string;
    variantName: string;
    cadence: ServiceAgreementItemDto['serviceCadence'];
    startDate: Date;
    endDate: Date | null;
    entities: Array<{
      id: string;
      name: string;
      uen: string;
    }>;
    fields: Record<string, string>;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatServiceAgreementCurrency(
  amount: string,
  currencyCode: string,
  options: { wholeAmounts?: boolean } = {},
): string {
  const value = Number(amount);
  // The reference layout writes whole amounts without cents (S$1,500).
  const fractionDigits = options.wholeAmounts && Number.isInteger(value) ? 0 : 2;
  const formatted = new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
  return currencyCode === 'SGD'
    ? formatted.replace(/^SGD\s*|\$/u, 'S$')
    : formatted;
}

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'per month',
  QUARTERLY: 'per quarter',
  SEMI_ANNUALLY: 'every six months',
  ANNUALLY: 'per year',
  ONE_TIME: 'one time',
};

export function formatServiceAgreementFrequency(
  fee: ServiceAgreementFeeLineDto,
): string {
  return fee.billingFrequency === 'CUSTOM'
    ? fee.customFrequencyLabel ?? ''
    : FREQUENCY_LABELS[fee.billingFrequency] ?? fee.billingFrequency;
}

export function orderedServiceAgreementEntities(
  agreement: ServiceAgreementDraftDto,
): ServiceAgreementEntityDto[] {
  return [...agreement.entities].sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );
}

export function orderedServiceAgreementItems(
  agreement: ServiceAgreementDraftDto,
): ServiceAgreementItemDto[] {
  return [...agreement.items].sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

export function buildServiceAgreementItemPlaceholderContext(input: {
  agreement: ServiceAgreementDraftDto;
  item: ServiceAgreementItemDto;
}): ServiceAgreementItemPlaceholderContext {
  const entityById = new Map(
    orderedServiceAgreementEntities(input.agreement).map((entity) => [entity.id, entity]),
  );
  const targetedEntities = input.item.entityIds
    .map((entityId) => entityById.get(entityId))
    .filter((entity): entity is ServiceAgreementEntityDto => Boolean(entity))
    .map((entity) => ({
      id: entity.id,
      name: entity.nameSnapshot,
      uen: entity.uenSnapshot,
    }));

  return {
    service: {
      itemId: input.item.id,
      familyName: input.item.familyNameSnapshot,
      variantName: input.item.variantNameSnapshot,
      cadence: input.item.serviceCadence,
      startDate: new Date(`${input.item.startDate}T00:00:00.000Z`),
      endDate: input.item.endDate
        ? new Date(`${input.item.endDate}T00:00:00.000Z`)
        : null,
      entities: targetedEntities,
      fields: { ...input.item.fieldValues },
    },
  };
}

export function findMissingServiceAgreementItemPlaceholders(input: {
  item: ServiceAgreementItemDto;
  context: ServiceAgreementItemPlaceholderContext;
}): string[] {
  return input.item.partialPlaceholdersSnapshot
    .filter((placeholder) => placeholder.required)
    .map((placeholder) => placeholder.key)
    .filter((key) => {
      const result = valueAtPath(input.context, key);
      return result === undefined || result === null || result === '';
    });
}

function escapeServiceAgreementItemContext(
  context: ServiceAgreementItemPlaceholderContext,
): ServiceAgreementItemPlaceholderContext {
  return {
    service: {
      ...context.service,
      familyName: escapeHtml(context.service.familyName),
      variantName: escapeHtml(context.service.variantName),
      entities: context.service.entities.map((entity) => ({
        ...entity,
        name: escapeHtml(entity.name),
        uen: escapeHtml(entity.uen),
      })),
      fields: Object.fromEntries(
        Object.entries(context.service.fields).map(([key, value]) => [
          key,
          escapeHtml(value),
        ]),
      ),
    },
  };
}

/**
 * Inline CSS properties that would override the master template's global
 * typography settings (font family, line spacing). Service partial wording is
 * authored or pasted into the partial editor and can carry baked-in typography
 * that would otherwise override the template's global settings when rendered.
 * Font family and line height are always normalized to the template; font size
 * is normalized only when it matches the partial editor's default size (11pt),
 * so deliberate per-text sizes (e.g. footnotes or sub-headings) are preserved.
 * List structure, indentation (margins/padding), numbering classes,
 * bold/italic/underline tags, colors, and alignment are preserved as authored.
 */
const GLOBAL_TYPOGRAPHY_STYLE_PROPERTIES = new Set([
  'font-family',
  'line-height',
]);

/**
 * True when an inline font-size declaration is just the partial editor's
 * baked-in default (11pt, including pixel equivalents such as 14.6667px from
 * Word pastes). Those are stripped so the wording inherits the master
 * template's global font size; any other size is an explicit authoring choice
 * and is kept.
 */
function isBakedDefaultFontSize(declaration: string): boolean {
  const value = declaration.slice(declaration.indexOf(':') + 1).trim();
  return normalizeDocumentFontSize(value) === DEFAULT_DOCUMENT_FONT_SIZE;
}

function normalizePartialWordingStyles(html: string): string {
  return html.replace(
    /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi,
    (_match, _quote, styleValue: string) => {
      const kept = styleValue
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .filter((declaration) => {
          const property = declaration.split(':', 1)[0].trim().toLowerCase();
          if (property === 'font-size') {
            return !isBakedDefaultFontSize(declaration);
          }
          return !GLOBAL_TYPOGRAPHY_STYLE_PROPERTIES.has(property);
        })
        .join('; ');
      return kept ? ` style="${kept}"` : '';
    },
  );
}

export function assembleServiceAgreementTemplate(input: {
  templateContent: string;
  agreement: ServiceAgreementDraftDto;
}): {
  content: string;
  itemDiagnostics: Array<{ itemId: string; missingPlaceholders: string[] }>;
} {
  const [violation] = findServiceAgreementSlotViolations(input.templateContent);
  if (violation) throw new Error(violation.message);

  const entities = orderedServiceAgreementEntities(input.agreement);
  const items = orderedServiceAgreementItems(input.agreement);
  const itemDiagnostics: Array<{
    itemId: string;
    missingPlaceholders: string[];
  }> = [];

  const serviceSections = items
    .map((item, index) => {
      const rawContext = buildServiceAgreementItemPlaceholderContext({
        agreement: input.agreement,
        item,
      });
      const missingPlaceholders = findMissingServiceAgreementItemPlaceholders({
        item,
        context: rawContext,
      });
      if (missingPlaceholders.length) {
        itemDiagnostics.push({ itemId: item.id, missingPlaceholders });
      }
      const rendered = resolvePlaceholders(
        item.partialContentSnapshot,
        escapeServiceAgreementItemContext(rawContext),
        { missingPlaceholder: 'keep', dateFormat: 'dd MMMM yyyy' },
      );
      return [
        index > 0 ? '<div class="page-break"></div>' : '',
        `<section data-service-agreement-item-id="${escapeHtml(item.id)}">`,
        normalizePartialWordingStyles(rendered.resolved),
        '</section>',
      ].join('');
    })
    .join('');

  const feeRow = (fee: ServiceAgreementFeeLineDto): string => [
    '<tr>',
    `<td>${escapeHtml(fee.description)}</td>`,
    `<td>${escapeHtml(formatServiceAgreementCurrency(fee.amount, fee.currency))} ${escapeHtml(
      formatServiceAgreementFrequency(fee),
    )}</td>`,
    '</tr>',
  ].join('');

  const tbodyRows: string[] = [];
  let firstFeeGroup = true;
  for (const entity of entities) {
    const groupRows = items.flatMap((item) =>
      [...item.feeLines]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .filter((fee) => fee.agreementEntityId === entity.id)
        .map(feeRow),
    );
    if (groupRows.length === 0) continue;
    if (!firstFeeGroup) {
      tbodyRows.push('<tr><td colspan="2">&nbsp;</td></tr>');
    }
    firstFeeGroup = false;
    tbodyRows.push(
      `<tr><td colspan="2" style="text-decoration: underline;">${escapeHtml(
        entity.nameSnapshot,
      )}</td></tr>`,
    );
    tbodyRows.push(...groupRows);
  }
  // Fee lines pointing at an entity that is no longer part of the agreement
  // are preserved in their original order instead of being dropped silently.
  const knownEntityIds = new Set(entities.map((entity) => entity.id));
  const orphanRows = items.flatMap((item) =>
    [...item.feeLines]
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .filter((fee) => !knownEntityIds.has(fee.agreementEntityId))
      .map(feeRow),
  );
  if (orphanRows.length > 0) {
    if (tbodyRows.length > 0) {
      tbodyRows.push('<tr><td colspan="2">&nbsp;</td></tr>');
    }
    tbodyRows.push(...orphanRows);
  }

  const feeTable = [
    '<table data-service-agreement-fees="true"><thead><tr>',
    '<th style="width: 70%;">Description</th><th style="width: 30%;">Fee</th>',
    '</tr></thead><tbody>',
    tbodyRows.join(''),
    '</tbody></table>',
  ].join('');

  const entityAppendix = [
    '<ol data-service-agreement-entities="true">',
    ...entities.map(
      (entity) =>
        `<li>${escapeHtml(entity.nameSnapshot)} (UEN: ${escapeHtml(
          entity.uenSnapshot,
        )})</li>`,
    ),
    '</ol>',
  ].join('');

  return {
    content: input.templateContent
      .replace(SERVICE_AGREEMENT_SLOTS.serviceSections, serviceSections)
      .replace(SERVICE_AGREEMENT_SLOTS.feeTable, feeTable)
      .replace(SERVICE_AGREEMENT_SLOTS.entityAppendix, entityAppendix),
    itemDiagnostics,
  };
}

/**
 * Placeholder Resolver
 *
 * Resolves template placeholders with actual data from companies, contacts,
 * and custom values. Supports Handlebars-inspired syntax including conditionals
 * and loops.
 */

import { format as formatDate, parseISO } from 'date-fns';
import { Prisma } from '@/generated/prisma';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/client';
import {
  buildPartyContactFields,
  formatLetterAddress,
  type ContactDetailInput,
  type DocumentParty,
  type PartyAddress,
} from '@/lib/document-party';
import type { DocumentPartySelections } from '@/services/document-party.service';
import {
  PARTIAL_REFERENCE_REGEX,
  extractPartialReferences,
  hasPartialReferences,
  extractTemplatePlaceholderKeys,
} from '@/lib/template-analysis';

type Decimal = Prisma.Decimal;

// ============================================================================
// Types
// ============================================================================

export interface PlaceholderContext extends DocumentPartySelections {
  company?: CompanyData | null;
  contact?: ContactData | null;
  custom?: Record<string, unknown>;
  system?: SystemData;
  // Root-level arrays for {{#each}} loops
  directors?: OfficerData[];
  secretaries?: OfficerData[];
  shareholders?: ShareholderData[];
  contacts?: ContactData[];
  authorizedRepresentatives?: DocumentParty[];
  signers?: DocumentParty[];
  service?: ServicePlaceholderData;
}

export interface ServicePlaceholderData {
  itemId: string;
  familyName: string;
  variantName: string;
  cadence: string;
  startDate: Date;
  endDate?: Date | null;
  entities: Array<{ id: string; name: string; uen: string }>;
  fields: Record<string, string>;
}

export interface CompanyData {
  id: string;
  name: string;
  uen: string;
  formerName?: string | null;
  entityType?: string | null;
  status?: string | null;
  incorporationDate?: Date | null;
  registeredAddress?: string | null;
  homeCurrency?: string | null;
  paidUpCapitalAmount?: Decimal | number | null;
  issuedCapitalAmount?: Decimal | number | null;
  financialYearEndMonth?: number | null;
  financialYearEndDay?: number | null;
  isGstRegistered?: boolean;
  gstRegistrationNumber?: string | null;
  address?: {
    block?: string | null;
    street?: string | null;
    level?: string | null;
    unit?: string | null;
    building?: string | null;
    postalCode?: string | null;
    letter?: PartyAddress['letter'];
  } | null;
  capital?: Decimal | number | null;
  addresses?: CompanyAddressData[];
  officers?: OfficerData[];
  shareholders?: ShareholderData[];
}

export interface CompanyAddressData {
  addressType: string;
  fullAddress: string;
  isCurrent: boolean;
  block?: string | null;
  streetName?: string | null;
  level?: string | null;
  unit?: string | null;
  buildingName?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface OfficerData {
  id?: string;
  contactId?: string | null;
  name: string;
  role: string;
  nationality?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  letterAddress?: string | null;
  appointmentDate?: Date | null;
  cessationDate?: Date | null;
  isCurrent: boolean;
  contact?: {
    id: string;
    fullAddress?: string | null;
    contactDetails?: ContactDetailInput[];
  } | null;
}

export interface ShareholderData {
  id?: string;
  contactId?: string | null;
  name: string;
  shareholderType?: string | null;
  nationality?: string | null;
  numberOfShares: number;
  percentageHeld?: Decimal | number | null;
  shareClass?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  letterAddress?: string | null;
  isCurrent: boolean;
  contact?: {
    id: string;
    fullAddress?: string | null;
    contactDetails?: ContactDetailInput[];
  } | null;
}

export interface ContactData {
  id: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  contactType: string;
  email?: string | null;
  phone?: string | null;
  fullAddress?: string | null;
  nationality?: string | null;
  identificationNumber?: string | null;
}

export interface SystemData {
  currentDate: Date;
  tenantName?: string;
  preparerName?: string;
  generatedBy?: string;
}

export interface ResolveOptions {
  dateFormat?: string;
  currencySymbol?: string;
  missingPlaceholder?: 'blank' | 'keep' | 'highlight';
  numberLocale?: string;
  /** Tenant ID for resolving partials (if partials are used) */
  tenantId?: string;
  /** Pre-fetched partials map (name -> content) to avoid async resolution */
  partialsMap?: Map<string, string>;
}

const DEFAULT_OPTIONS: ResolveOptions = {
  dateFormat: 'dd MMMM yyyy',
  currencySymbol: 'S$',
  missingPlaceholder: 'highlight',
  numberLocale: 'en-SG',
};

function withCompanyLetterAddress(
  company: CompanyData | null | undefined,
): CompanyData | null | undefined {
  if (!company || company.address?.letter != null) return company;

  const registeredAddressRecord = company.addresses?.find(
    (address) => address.addressType === 'REGISTERED_OFFICE' && address.isCurrent,
  ) ?? company.addresses?.find((address) => address.isCurrent);
  const address = company.address ?? (registeredAddressRecord
    ? {
        block: registeredAddressRecord.block,
        street: registeredAddressRecord.streetName,
        level: registeredAddressRecord.level,
        unit: registeredAddressRecord.unit,
        building: registeredAddressRecord.buildingName,
        postalCode: registeredAddressRecord.postalCode,
      }
    : null);

  const letter = formatLetterAddress({
    fullAddress: company.registeredAddress ?? registeredAddressRecord?.fullAddress,
    block: address?.block,
    street: address?.street,
    level: address?.level,
    unit: address?.unit,
    building: address?.building,
    postalCode: address?.postalCode,
    country: registeredAddressRecord?.country,
  }).letter;
  if (!letter) return company;

  return {
    ...company,
    address: {
      ...address,
      letter,
    },
  };
}

// ============================================================================
// Partial Processing
// ============================================================================

export { extractPartialReferences, hasPartialReferences };

/**
 * Resolves partial references in content using the provided partials map.
 * This is a synchronous function that requires partials to be pre-fetched.
 *
 * @param content - The template content with partial references
 * @param partialsMap - Map of partial name to partial content
 * @param options - Resolve options
 * @param resolvedPartials - Set of already resolved partials (for circular reference detection)
 */
function processPartials(
  content: string,
  partialsMap: Map<string, string>,
  options: ResolveOptions,
  resolvedPartials = new Set<string>()
): { content: string; missingPartials: string[] } {
  const missingPartials: string[] = [];

  const resolved = content.replace(PARTIAL_REFERENCE_REGEX, (match, partialName) => {
    // Check for circular reference
    if (resolvedPartials.has(partialName)) {
      console.warn(`Circular partial reference detected: ${partialName}`);
      return `<!-- Circular reference: ${partialName} -->`;
    }

    const partialContent = partialsMap.get(partialName);

    if (!partialContent) {
      missingPartials.push(partialName);
      if (options.missingPlaceholder === 'keep') return match;
      if (options.missingPlaceholder === 'highlight')
        return `<span class="placeholder-missing">[Partial not found: ${partialName}]</span>`;
      return '';
    }

    // Mark as resolved to detect circular references
    resolvedPartials.add(partialName);

    // Recursively resolve nested partials in the partial content
    const { content: resolvedPartialContent, missingPartials: nestedMissing } = processPartials(
      partialContent,
      partialsMap,
      options,
      resolvedPartials
    );

    missingPartials.push(...nestedMissing);

    return resolvedPartialContent;
  });

  return { content: resolved, missingPartials };
}

// ============================================================================
// Main Resolver
// ============================================================================

export interface ResolveResult {
  resolved: string;
  missing: string[];
  missingPartials: string[];
}

/**
 * Resolves all placeholders in template content with provided context data.
 * Now supports template partials via {{> partial-name}} syntax.
 */
export function resolvePlaceholders(
  content: string,
  context: PlaceholderContext,
  options: ResolveOptions = {}
): ResolveResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const missing: string[] = [];
  let missingPartials: string[] = [];

  const preparerName = context.system?.preparerName ?? context.system?.generatedBy;
  const fullContext: PlaceholderContext = {
    ...context,
    company: withCompanyLetterAddress(context.company),
    system: {
      currentDate: context.system?.currentDate ?? new Date(),
      ...context.system,
      preparerName,
      generatedBy: context.system?.generatedBy ?? preparerName,
    },
  };

  let resolved = content;

  // Normalize doubly-nested modifier syntax before anything else:
  // {{MODIFIER({{path}})}} -> MODIFIER({{path}}). Without this, the external
  // modifier matcher consumes the inner "MODIFIER({{path}})" and leaves the
  // resolved value wrapped in a stray {{value}}, which is then reported as an
  // unresolved placeholder named after the value (e.g. "CEO").
  resolved = resolved.replace(
    /\{\{([A-Z_]+)\(\s*(?:<[^>]*>\s*)*\{\{([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\}\}(?:\s*<[^>]*>)*\s*\)\}\}/g,
    '$1({{$2}})',
  );

  // Process partials first (if partialsMap is provided)
  if (opts.partialsMap && opts.partialsMap.size > 0) {
    const partialResult = processPartials(resolved, opts.partialsMap, opts);
    resolved = partialResult.content;
    missingPartials = partialResult.missingPartials;
  } else if (hasPartialReferences(resolved)) {
    // Extract missing partial names for reporting
    missingPartials = extractPartialReferences(resolved);
    // Handle missing partials based on options
    if (opts.missingPlaceholder === 'highlight') {
      resolved = resolved.replace(
        PARTIAL_REFERENCE_REGEX,
        '<span class="placeholder-missing">[Partial: $1]</span>'
      );
    } else if (opts.missingPlaceholder === 'blank') {
      resolved = resolved.replace(PARTIAL_REFERENCE_REGEX, '');
    }
    // 'keep' option leaves them as-is
  }

  // Expand loops attached to valid HTML containers (e.g. table row groups)
  // before processing ordinary Handlebars-style loops. This keeps loop
  // metadata intact when the visual editor sanitizes pasted HTML.
  resolved = expandAttributeEachBlocks(resolved);

  // Process #each loops first (most complex)
  resolved = processEachBlocks(resolved, fullContext, opts, missing);

  // Process #if conditionals
  resolved = processIfBlocks(resolved, fullContext, opts);

  // Process #with blocks
  resolved = processWithBlocks(resolved, fullContext, opts, missing);

  // Process external modifiers: MODIFIER({{path}}) syntax
  resolved = processExternalModifiers(resolved, fullContext, opts, missing);

  // Process simple placeholders last
  resolved = processSimplePlaceholders(resolved, fullContext, opts, missing);

  return { resolved, missing: [...new Set(missing)], missingPartials: [...new Set(missingPartials)] };
}

function expandAttributeEachBlocks(content: string): string {
  const attributeEachRegex =
    /<(tbody|div)(?=[^>]*\bdata-template-each\s*=\s*["'][a-zA-Z_][a-zA-Z0-9_.]*["'])\s*([^>]*)>([\s\S]*?)<\/\1>/gi;

  return content.replace(
    attributeEachRegex,
    (_match, tag: string, attributes: string, body: string) => {
      const pathMatch = attributes.match(
        /\bdata-template-each\s*=\s*(["'])([a-zA-Z_][a-zA-Z0-9_.]*)\1/i,
      );
      if (!pathMatch) return _match;
      const path = pathMatch[2];
      const cleanAttributes = attributes
        .replace(pathMatch[0], '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const openingTag = cleanAttributes ? `<${tag} ${cleanAttributes}>` : `<${tag}>`;
      return `{{#each ${path}}}${openingTag}${body}</${tag}>{{/each}}`;
    },
  );
}

// ============================================================================
// Block Processors
// ============================================================================

/**
 * Process {{#each items}}...{{/each}} blocks
 */
function processEachBlocks(
  content: string,
  context: PlaceholderContext,
  options: ResolveOptions,
  missing: string[]
): string {
  const eachRegex = /\{\{#each\s+([a-zA-Z_][a-zA-Z0-9_.]*)\}\}([\s\S]*?)\{\{\/each\}\}/g;

  return content.replace(eachRegex, (match, path, blockContent) => {
    const items = getValueByPath(context, path);

    if (!Array.isArray(items)) {
      missing.push(path);
      if (options.missingPlaceholder === 'keep') return match;
      if (options.missingPlaceholder === 'highlight')
        return `<span class="placeholder-missing">[Missing: ${path}]</span>`;
      return '';
    }

    if (items.length === 0) {
      return '';
    }

    // Resolve each item
    return items
      .map((item, index) => {
        // Create context with current item and index
        let itemContent = blockContent;

        // Replace @index, @number, @first, @last
        itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));
        itemContent = itemContent.replace(/\{\{@number\}\}/g, String(index + 1));
        itemContent = itemContent.replace(/\{\{@first\}\}/g, String(index === 0));
        itemContent = itemContent.replace(/\{\{@last\}\}/g, String(index === items.length - 1));

        // Replace external modifiers with this.property: UCASE({{this.name}}).
        // The contenteditable editor can wrap the placeholder in inline HTML
        // (e.g. <span style="...">{{this.name}}</span>), so allow tags and
        // whitespace between the modifier parentheses.
        const extModThisRegex =
          /([A-Z_]+)\(\s*(?:<[^>]*>\s*)*\{\{this\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}(?:\s*<[^>]*>)*\s*\)/g;
        itemContent = itemContent.replace(extModThisRegex, (_: string, modifier: string, prop: string) => {
          const modifierFn = VALUE_MODIFIERS[modifier];
          if (!modifierFn) return _;
          const value = item[prop];
          const formatted = formatValue(value, options);
          if (formatted === null) return '';
          return modifierFn(formatted);
        });

        // Replace modifier helpers that use the natural in-placeholder form:
        // {{DESIGNATION(this.role)}}. These must resolve against the current
        // loop item before the root-level placeholder pass runs.
        const modThisRegex =
          /\{\{([A-Z_]+)\(this\.([a-zA-Z_][a-zA-Z0-9_]*)\)\}\}/g;
        itemContent = itemContent.replace(modThisRegex, (_: string, modifier: string, prop: string) => {
          const modifierFn = VALUE_MODIFIERS[modifier];
          if (!modifierFn) return _;
          const formatted = formatValue(item[prop], options);
          if (formatted === null) return '';
          return modifierFn(formatted);
        });

        // Replace external modifiers with shorthand property: UCASE({{name}})
        const extModPropRegex =
          /([A-Z_]+)\(\s*(?:<[^>]*>\s*)*\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}(?:\s*<[^>]*>)*\s*\)/g;
        itemContent = itemContent.replace(extModPropRegex, (fullMatch: string, modifier: string, prop: string) => {
          // Skip if modifier is not recognized
          const modifierFn = VALUE_MODIFIERS[modifier];
          if (!modifierFn) return fullMatch;
          const value = item[prop];
          if (value === undefined) return fullMatch; // Keep for outer resolution
          const formatted = formatValue(value, options);
          if (formatted === null) return '';
          return modifierFn(formatted);
        });

        // Replace {{this.property}} with item property
        const thisRegex = /\{\{this\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
        itemContent = itemContent.replace(thisRegex, (_: string, prop: string) => {
          const value = item[prop];
          return formatResolvedValue(prop, value, options);
        });

        // Replace {{property}} directly (shorthand)
        const propRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
        itemContent = itemContent.replace(propRegex, (fullMatch: string, prop: string) => {
          // Skip block helpers
          if (['if', 'each', 'unless', 'with'].some((h) => prop.startsWith(h))) {
            return fullMatch;
          }
          const value = item[prop];
          if (value === undefined) return fullMatch; // Keep for outer resolution
          return formatResolvedValue(prop, value, options);
        });

        return itemContent;
      })
      .join('');
  });
}

/**
 * Process {{#if condition}}...{{else}}...{{/if}} blocks
 */
function processIfBlocks(
  content: string,
  context: PlaceholderContext,
  _options: ResolveOptions
): string {
  // Handle if-else blocks
  const ifElseRegex =
    /\{\{#if\s+([^}]+?)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
  content = content.replace(ifElseRegex, (_, expression, trueBlock, falseBlock) => {
    return evaluateCondition(expression, context) ? trueBlock : falseBlock;
  });

  // Handle simple if blocks (no else)
  const ifRegex = /\{\{#if\s+([^}]+?)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  content = content.replace(ifRegex, (_, expression, block) => {
    return evaluateCondition(expression, context) ? block : '';
  });

  // Handle unless blocks (inverse of if)
  const unlessRegex = /\{\{#unless\s+([a-zA-Z_][a-zA-Z0-9_.]*)\}\}([\s\S]*?)\{\{\/unless\}\}/g;
  content = content.replace(unlessRegex, (_, path, block) => {
    const value = getValueByPath(context, path);
    return !isTruthy(value) ? block : '';
  });

  return content;
}

function evaluateCondition(expression: string, context: PlaceholderContext): boolean {
  const trimmed = expression.trim();
  const comparison = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\s*(==|!=)\s*(['"]?)(.*?)\3$/);

  if (comparison) {
    const [, path, operator, , expected] = comparison;
    const actual = getValueByPath(context, path);
    const actualText = formatValue(actual, DEFAULT_OPTIONS) ?? '';
    return operator === '==' ? actualText === expected : actualText !== expected;
  }

  return isTruthy(getValueByPath(context, trimmed));
}

/**
 * Process {{#with object}}...{{/with}} blocks
 */
function processWithBlocks(
  content: string,
  context: PlaceholderContext,
  options: ResolveOptions,
  missing: string[]
): string {
  const withRegex = /\{\{#with\s+([a-zA-Z_][a-zA-Z0-9_.]*)\}\}([\s\S]*?)\{\{\/with\}\}/g;

  return content.replace(withRegex, (match, path, blockContent) => {
    const obj = getValueByPath(context, path);

    if (obj === null || obj === undefined || typeof obj !== 'object') {
      missing.push(path);
      if (options.missingPlaceholder === 'keep') return match;
      if (options.missingPlaceholder === 'highlight')
        return `<span class="placeholder-missing">[Missing: ${path}]</span>`;
      return '';
    }

    // Replace {{property}} with object property
    const propRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
    return blockContent.replace(propRegex, (fullMatch: string, prop: string) => {
      if (['if', 'each', 'unless', 'with'].some((h) => prop.startsWith(h))) {
        return fullMatch;
      }
      const value = (obj as Record<string, unknown>)[prop];
      if (value === undefined) return fullMatch;
      return formatValue(value, options) ?? '';
    });
  });
}

/**
 * Available value modifiers/formatters
 * Usage: {{UCASE(company.name)}} or {{LCASE(company.status)}}
 */
const VALUE_MODIFIERS: Record<string, (value: string) => string> = {
  UCASE: (v) => v.toUpperCase(),
  UPPERCASE: (v) => v.toUpperCase(),
  LCASE: (v) => v.toLowerCase(),
  LOWERCASE: (v) => v.toLowerCase(),
  CAPITALIZE: (v) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(),
  PCASE: (v) => toProperCase(v),
  PROPERCASE: (v) => toProperCase(v),
  TITLECASE: (v) => toProperCase(v),
  TRIM: (v) => v.trim(),
  DESIGNATION: (v) => toDesignationCase(v),
};

function toProperCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Acronyms commonly used in officer/contact designations that must stay
 * uppercase instead of being title-cased.
 */
const DESIGNATION_ACRONYMS = new Set([
  'CEO',
  'CFO',
  'COO',
  'CTO',
  'CIO',
  'CISO',
  'CRO',
  'CMO',
  'CLO',
  'CHRO',
  'CDO',
  'CPO',
  'CSO',
  'CAO',
  'CCO',
  'MD',
  'VP',
  'PA',
  'HR',
]);

/** Small words lowercased mid-designation: "Director of Finance". */
const DESIGNATION_SMALL_WORDS = new Set([
  'of',
  'the',
  'and',
  'in',
  'at',
  'for',
  'on',
  'to',
  'with',
]);

/**
 * Title-cases a designation ("DIRECTOR" -> "Director") while preserving
 * known acronyms ("CEO", "CFO", ...) exactly as uppercase.
 */
function toDesignationCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const core = word.replace(/[^A-Za-z]/g, '');
      if (!core) return word;
      const upper = core.toUpperCase();
      if (DESIGNATION_ACRONYMS.has(upper)) return upper;
      const cased = core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
      if (index > 0 && DESIGNATION_SMALL_WORDS.has(cased.toLowerCase())) {
        return cased.toLowerCase();
      }
      return cased;
    })
    .join(' ');
}

/**
 * Process MODIFIER({{placeholder}}) syntax - modifier wraps the placeholder from outside
 * Example: UCASE({{company.name}}) -> WHAT THE MATH! PTE. LTD.
 */
function processExternalModifiers(
  content: string,
  context: PlaceholderContext,
  options: ResolveOptions,
  missing: string[]
): string {
  // Allow inline HTML (e.g. formatting spans) and whitespace between the
  // modifier parentheses and the placeholder, which the A4 contenteditable
  // editor can introduce: PCASE(<span style="...">{{company.name}}</span>)
  const regex =
    /([A-Z_]+)\(\s*(?:<[^>]*>\s*)*\{\{([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\}\}(?:\s*<[^>]*>)*\s*\)/g;

  return content.replace(regex, (match, modifier, path) => {
    const modifierFn = VALUE_MODIFIERS[modifier];
    if (!modifierFn) {
      return match; // Unknown modifier, keep as-is
    }

    const value = getValueByPath(context, path);
    if (value === undefined || value === null) {
      missing.push(path);
      if (options.missingPlaceholder === 'keep') return match;
      if (options.missingPlaceholder === 'highlight')
        return `<span class="placeholder-missing">[${path}]</span>`;
      return '';
    }

    const formatted = formatValue(value, options);
    if (formatted === null) return '';
    return modifierFn(formatted);
  });
}

/**
 * Process simple {{placeholder}} values
 * Now supports modifiers like {{UCASE(company.name)}}
 */
function processSimplePlaceholders(
  content: string,
  context: PlaceholderContext,
  options: ResolveOptions,
  missing: string[]
): string {
  // First, process placeholders with modifiers: {{UCASE(path)}}
  const modifierRegex = /\{\{([A-Z_]+)\(([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\)\}\}/g;
  content = content.replace(modifierRegex, (match, modifier, path) => {
    const modifierFn = VALUE_MODIFIERS[modifier];
    if (!modifierFn) {
      // Unknown modifier, keep as-is
      return match;
    }

    const value = getValueByPath(context, path);
    if (value === undefined || value === null) {
      missing.push(path);
      if (options.missingPlaceholder === 'keep') return match;
      if (options.missingPlaceholder === 'highlight')
        return `<span class="placeholder-missing">[${path}]</span>`;
      return '';
    }

    const formatted = formatValue(value, options);
    if (formatted === null) return '';
    return modifierFn(formatted);
  });

  // Then process simple placeholders: {{path}}
  const placeholderRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\}\}/g;

  return content.replace(placeholderRegex, (match, path) => {
    // Skip block helpers
    if (
      path.startsWith('#') ||
      path.startsWith('/') ||
      path.startsWith('@') ||
      ['if', 'each', 'unless', 'with', 'else'].includes(path)
    ) {
      return match;
    }

    const value = getValueByPath(context, path);

    if (value === undefined || value === null) {
      missing.push(path);
      if (options.missingPlaceholder === 'keep') return match;
      if (options.missingPlaceholder === 'highlight')
        return `<span class="placeholder-missing">[${path}]</span>`;
      return '';
    }

    return formatResolvedValue(path, value, options);
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Gets a value from a nested object by dot-notation path.
 * Supports array indexing: "officers[0].name"
 */
function getValueByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;

  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    // Check for array index: items[0]
    const arrayMatch = segment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, indexStr] = arrayMatch;
      const index = parseInt(indexStr, 10);
      const arr = (current as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) return undefined;
      current = arr[index];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return current;
}

/**
 * Formats a value for display based on its type.
 */
function formatValue(value: unknown, options: ResolveOptions): string | null {
  if (value === null || value === undefined) return null;

  // Handle Decimal (from Prisma)
  if (value instanceof PrismaDecimal) {
    return formatNumber(value.toNumber(), options);
  }

  // Handle Date
  if (value instanceof Date) {
    return formatDate(value, options.dateFormat || 'dd MMMM yyyy');
  }

  // Handle ISO date strings
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    try {
      const date = parseISO(value);
      return formatDate(date, options.dateFormat || 'dd MMMM yyyy');
    } catch {
      return value;
    }
  }

  // Handle numbers
  if (typeof value === 'number') {
    return formatNumber(value, options);
  }

  // Handle booleans
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  // Handle arrays (join with comma)
  if (Array.isArray(value)) {
    return value.map((v) => formatValue(v, options) ?? '').join(', ');
  }

  // Handle objects
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatResolvedValue(path: string, value: unknown, options: ResolveOptions): string {
  const formatted = formatValue(value, options) ?? '';
  if (path === 'letterAddress' || path.endsWith('.address.letter')) {
    return formatted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\r?\n/g, '<br>');
  }
  return formatted;
}

/**
 * Formats a number with locale-aware thousand separators.
 */
function formatNumber(num: number, options: ResolveOptions): string {
  const locale = options.numberLocale || 'en-SG';
  return num.toLocaleString(locale);
}

/**
 * Checks if a value is "truthy" for conditional blocks.
 */
function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    // Handle string boolean values (from custom boolean placeholders)
    if (value === 'false' || value === '0') return false;
    return value.length > 0;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

// ============================================================================
// Placeholder Extraction
// ============================================================================

/**
 * Extracts all placeholder keys from template content.
 */
export function extractPlaceholders(content: string): string[] {
  return extractTemplatePlaceholderKeys(content);
}

// ============================================================================
// Helper Functions for Specific Data Types
// ============================================================================

/**
 * Filters officers to get only current directors.
 */
export function getCurrentDirectors(officers: OfficerData[]): OfficerData[] {
  return officers.filter((o) => o.isCurrent && o.role === 'DIRECTOR');
}

/**
 * Filters officers to get only current secretaries.
 */
export function getCurrentSecretaries(officers: OfficerData[]): OfficerData[] {
  return officers.filter((o) => o.isCurrent && o.role === 'SECRETARY');
}

/**
 * Filters shareholders to get only current shareholders.
 */
export function getCurrentShareholders(shareholders: ShareholderData[]): ShareholderData[] {
  return shareholders.filter((s) => s.isCurrent);
}

/**
 * Gets the registered address from company addresses.
 */
export function getRegisteredAddress(addresses: CompanyAddressData[]): string | null {
  const registered = addresses.find(
    (a) => a.addressType === 'REGISTERED_OFFICE' && a.isCurrent
  );
  return registered?.fullAddress ?? null;
}

/**
 * Prepares company data for placeholder resolution with convenience helpers.
 */
export function prepareCompanyContext(company: CompanyData): PlaceholderContext {
  const enrichOfficer = (officer: OfficerData): OfficerData => {
    const fields = buildPartyContactFields({
      companyId: company.id,
      roleAddress: officer.address,
      contactAddress: officer.contact?.fullAddress,
      contactDetails: officer.contact?.contactDetails,
    });
    return {
      ...officer,
      email: fields.email ?? officer.email ?? null,
      phone: fields.phone ?? officer.phone ?? null,
      letterAddress: fields.address.letter ?? officer.letterAddress ?? null,
    };
  };
  const enrichShareholder = (shareholder: ShareholderData): ShareholderData => {
    const fields = buildPartyContactFields({
      companyId: company.id,
      roleAddress: shareholder.address,
      contactAddress: shareholder.contact?.fullAddress,
      contactDetails: shareholder.contact?.contactDetails,
    });
    return {
      ...shareholder,
      email: fields.email ?? shareholder.email ?? null,
      phone: fields.phone ?? shareholder.phone ?? null,
      letterAddress: fields.address.letter ?? shareholder.letterAddress ?? null,
    };
  };
  const directors = getCurrentDirectors(company.officers || []).map(enrichOfficer);
  const secretaries = getCurrentSecretaries(company.officers || []);
  const shareholders = getCurrentShareholders(company.shareholders || []).map(enrichShareholder);
  const registeredAddress = getRegisteredAddress(company.addresses || []);
  const registeredAddressRecord = (company.addresses || []).find(
    (a) => a.addressType === 'REGISTERED_OFFICE' && a.isCurrent
  ) || (company.addresses || []).find((a) => a.isCurrent);

  return {
    company: {
      ...company,
      // Add convenience accessors
      registeredAddress,
      address: registeredAddressRecord
        ? {
            block: registeredAddressRecord.block ?? null,
            street: registeredAddressRecord.streetName ?? null,
            level: registeredAddressRecord.level ?? null,
            unit: registeredAddressRecord.unit ?? null,
            building: registeredAddressRecord.buildingName ?? null,
            postalCode: registeredAddressRecord.postalCode ?? null,
            letter: formatLetterAddress({
              fullAddress: registeredAddressRecord.fullAddress,
              block: registeredAddressRecord.block,
              street: registeredAddressRecord.streetName,
              level: registeredAddressRecord.level,
              unit: registeredAddressRecord.unit,
              building: registeredAddressRecord.buildingName,
              postalCode: registeredAddressRecord.postalCode,
              country: registeredAddressRecord.country,
            }).letter,
          }
        : null,
      capital: company.paidUpCapitalAmount ?? company.issuedCapitalAmount ?? null,
    } as CompanyData,
    // Add directors/shareholders/secretaries at root level for {{#each directors}} syntax
    directors,
    secretaries,
    shareholders,
    custom: {
      directors,
      secretaries,
      shareholders,
      firstDirector: directors[0] || null,
      firstSecretary: secretaries[0] || null,
      directorCount: directors.length,
      shareholderCount: shareholders.length,
    },
    system: {
      currentDate: new Date(),
    },
  };
}

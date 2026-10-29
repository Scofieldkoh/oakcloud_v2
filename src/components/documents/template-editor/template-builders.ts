export type TemplateCollection = 'directors' | 'shareholders';
export type TemplateLoopLayout = 'paragraphs' | 'bullets' | 'table';
export type ConditionOperator = 'truthy' | 'equals' | 'notEquals';

export interface EachBlockInput {
  collection: TemplateCollection;
  fields: string[];
  layout: TemplateLoopLayout;
}

export interface ConditionBlockInput {
  field: string;
  operator: ConditionOperator;
  value?: string;
  bodyHtml: string;
}

export interface TemplateCollectionOption {
  value: TemplateCollection;
  label: string;
}

export interface TemplateFieldOption {
  value: string;
  label: string;
}

const LOOP_FIELDS = {
  directors: [
    { value: 'name', label: 'Name' },
    { value: 'identificationNumber', label: 'Identification number' },
    { value: 'nationality', label: 'Nationality' },
    { value: 'role', label: 'Role' },
    { value: 'address', label: 'Address' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'letterAddress', label: 'Letter address' },
  ],
  shareholders: [
    { value: 'name', label: 'Name' },
    { value: 'identificationNumber', label: 'Identification number' },
    { value: 'nationality', label: 'Nationality' },
    { value: 'shareClass', label: 'Share class' },
    { value: 'numberOfShares', label: 'Number of shares' },
    { value: 'percentageHeld', label: 'Percentage held' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'letterAddress', label: 'Letter address' },
  ],
} as const satisfies Record<TemplateCollection, readonly TemplateFieldOption[]>;

const CONDITION_FIELDS = new Set([
  'company.name',
  'company.uen',
  'company.registeredAddress',
  'company.incorporationDate',
  'company.entityType',
  'company.capital',
  'contact.name',
  'contact.email',
  'system.currentDate',
  'system.generatedBy',
  'system.tenantName',
]);

export const TEMPLATE_COLLECTION_OPTIONS: readonly TemplateCollectionOption[] = [
  { value: 'directors', label: 'Directors' },
  { value: 'shareholders', label: 'Shareholders' },
];

export const TEMPLATE_FIELD_OPTIONS: Readonly<Record<TemplateCollection, readonly TemplateFieldOption[]>> =
  LOOP_FIELDS;

/**
 * Creates an entire loop from a fixed collection, field, and layout allowlist.
 * The result can be inserted as one editor transaction without leaving an
 * unmatched opening block in the document.
 */
export function buildEachBlock(input: EachBlockInput): string {
  const collection = assertAllowedCollection(input.collection);
  const layout = assertAllowedLayout(input.layout);

  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    throw new Error('Select at least one loop field.');
  }

  const fields = input.fields.map((field) => assertAllowedField(collection, field));
  const body = renderLoopLayout(layout, fields);

  return `<div>{{#each ${collection}}}</div>${body}<div>{{/each}}</div>`;
}

/**
 * Creates a complete Handlebars-style condition block. `bodyHtml` is expected
 * to be canonical editor HTML; field names and comparison values are never
 * concatenated until they have been allowlisted or HTML-escaped.
 */
export function buildConditionBlock(input: ConditionBlockInput): string {
  const field = assertAllowedConditionField(input.field);
  const operator = assertAllowedOperator(input.operator);

  if (typeof input.bodyHtml !== 'string') {
    throw new Error('Condition content must be HTML.');
  }

  if (operator === 'truthy') {
    return `{{#if ${field}}}${input.bodyHtml}{{/if}}`;
  }

  if (typeof input.value !== 'string') {
    throw new Error('A comparison value is required for this condition.');
  }

  const comparison = operator === 'equals' ? '==' : '!=';
  return `{{#if ${field} ${comparison} "${escapeHtml(assertSafeConditionValue(input.value))}"}}${input.bodyHtml}{{/if}}`;
}

export interface SignatureBlockInput {
  collection: TemplateCollection;
}

/**
 * Creates one keep-together signature block per signer by iterating the
 * selected collection. Each iteration carries `data-flow-keep-together` so
 * the A4 paginator never splits a single signer's sign-on line, space, name,
 * designation, and date across a page break, while signers still flow onto
 * following pages independently.
 */
export function buildSignatureBlock(input: SignatureBlockInput): string {
  const collection = assertAllowedCollection(input.collection);
  const designationLine =
    collection === 'directors' ? '<p>{{this.role}}</p>' : '<p><br></p>';
  const body = [
    '<div data-flow-keep-together="true">',
    '<p>Sign on behalf of client</p>',
    '<p><br></p>',
    '<p><br></p>',
    '<p>________________________</p>',
    '<p>{{this.name}}</p>',
    designationLine,
    '<p>{{system.currentDate}}</p>',
    '</div>',
  ].join('');

  return [
    `<div>{{#each ${collection}}}</div>`,
    body,
    '<div>{{/each}}</div>',
  ].join('');
}

function assertAllowedCollection(collection: unknown): TemplateCollection {
  if (collection === 'directors' || collection === 'shareholders') return collection;
  throw new Error('Unsupported loop collection.');
}

function assertAllowedLayout(layout: unknown): TemplateLoopLayout {
  if (layout === 'paragraphs' || layout === 'bullets' || layout === 'table') return layout;
  throw new Error('Unsupported loop layout.');
}

function assertAllowedField(collection: TemplateCollection, field: unknown): TemplateFieldOption {
  if (typeof field !== 'string') {
    throw new Error(`Loop field is not available for ${collection}.`);
  }

  const option = LOOP_FIELDS[collection].find((candidate) => candidate.value === field);
  if (!option) {
    throw new Error(`Loop field "${field}" is not available for ${collection}.`);
  }

  return option;
}

function assertAllowedConditionField(field: unknown): string {
  if (typeof field !== 'string') {
    throw new Error('Unsupported condition field.');
  }

  if (CONDITION_FIELDS.has(field)) {
    return field;
  }

  throw new Error('Unsupported condition field.');
}

function assertAllowedOperator(operator: unknown): ConditionOperator {
  if (operator === 'truthy' || operator === 'equals' || operator === 'notEquals') return operator;
  throw new Error('Unsupported condition operator.');
}

function assertSafeConditionValue(value: string): string {
  if (value.includes('{{') || value.includes('}}')) {
    throw new Error('Condition value cannot contain template tokens.');
  }
  return value;
}

function renderLoopLayout(layout: TemplateLoopLayout, fields: TemplateFieldOption[]): string {
  const placeholders = fields.map((field) => `{{this.${field.value}}}`);

  if (layout === 'paragraphs') {
    return placeholders.map((placeholder) => `<p>${placeholder}</p>`).join('');
  }

  if (layout === 'bullets') {
    return `<ul>${placeholders.map((placeholder) => `<li>${placeholder}</li>`).join('')}</ul>`;
  }

  const headers = fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('');
  const cells = placeholders.map((placeholder) => `<td>${placeholder}</td>`).join('');
  return `<table><thead><tr>${headers}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

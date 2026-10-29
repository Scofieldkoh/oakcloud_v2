import {
  formatOakDocCustomFieldValue,
  oakDocPersonFieldTag,
  type OakDocPersonField,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { parseOakDocAmount } from '@/lib/document-editor/oakdoc-repeater-definitions';

/**
 * Values of per-person fields (see `OakDocPersonField`) as entered on
 * Configure: by repeater tag, then person id, then field key.
 */
export type OakDocPersonValues = Record<string, Record<string, Record<string, string>>>;

export interface OakDocPersonFieldIssue {
  tag: string;
  key: string;
  /** The person whose value is missing or not a number; absent for a total that doesn't add up. */
  personId?: string;
  message: string;
}

export interface OakDocPersonFieldPerson {
  id: string;
  name: string;
}

function rawText(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return typeof value === 'string' ? value.trim() : '';
}

function formatTotal(amount: number, type: OakDocPersonField['type']): string {
  return amount.toLocaleString('en-SG', type === 'currency'
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 6 });
}

/**
 * The value each person ticked has for each per-person field, and what is
 * wrong with them: a required value missing, a number that isn't one, or
 * values that don't add up to the custom field they must total. A single
 * person's empty value takes that total, so a transfer between two people
 * needs no extra typing.
 */
export function checkOakDocPersonFields(input: {
  /** Per-person fields by repeater tag. */
  personFields: Readonly<Record<string, readonly OakDocPersonField[]>>;
  /** People ticked in each section, in order. */
  people: Readonly<Record<string, readonly OakDocPersonFieldPerson[]>>;
  values?: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> | null;
  customData?: Readonly<Record<string, unknown>> | null;
  sectionName?: (tag: string) => string;
  customLabel?: (key: string) => string;
}): { values: OakDocPersonValues; issues: OakDocPersonFieldIssue[] } {
  const values: OakDocPersonValues = {};
  const issues: OakDocPersonFieldIssue[] = [];
  const sectionName = input.sectionName ?? ((tag: string) => tag);
  const customLabel = input.customLabel ?? ((key: string) => {
    const words = key.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  });
  for (const [tag, fields] of Object.entries(input.personFields)) {
    const people = input.people[tag] ?? [];
    if (fields.length === 0 || people.length === 0) continue;
    values[tag] = {};
    for (const person of people) values[tag][person.id] = {};
    for (const field of fields) {
      const totalText = field.totalOf ? rawText(input.customData?.[field.totalOf]) : '';
      const numeric = field.type === 'number' || field.type === 'currency';
      let sum = 0;
      let complete = true;
      for (const person of people) {
        let value = rawText(input.values?.[tag]?.[person.id]?.[field.key]);
        if (!value && people.length === 1 && totalText) value = totalText;
        if (!value) {
          complete = false;
          if (field.required || field.totalOf) {
            issues.push({ tag, key: field.key, personId: person.id, message: `Enter ${field.label} for ${person.name} (${sectionName(tag)}).` });
          }
          continue;
        }
        values[tag][person.id][field.key] = value;
        if (!numeric) continue;
        const amount = parseOakDocAmount(value);
        if (amount === null) {
          complete = false;
          issues.push({ tag, key: field.key, personId: person.id, message: `${field.label} for ${person.name} (${sectionName(tag)}) must be a number.` });
          continue;
        }
        sum += amount;
      }
      const total = field.totalOf ? parseOakDocAmount(totalText) : null;
      if (numeric && complete && total !== null && Math.round(sum * 100) !== Math.round(total * 100)) {
        issues.push({
          tag,
          key: field.key,
          message: `${field.label} for ${sectionName(tag)} adds up to ${formatTotal(sum, field.type)}, `
            + `but ${customLabel(field.totalOf!)} is ${formatTotal(total, field.type)}.`,
        });
      }
    }
  }
  return { values, issues };
}

/** Per-person values as they print, keyed for the repeaters: tag, then person id, then `item.<key>`. */
export function formatOakDocPersonValues(
  personFields: Readonly<Record<string, readonly OakDocPersonField[]>>,
  values: OakDocPersonValues,
): Record<string, Record<string, Record<string, string>>> {
  const printed: Record<string, Record<string, Record<string, string>>> = {};
  for (const [tag, people] of Object.entries(values)) {
    const fields = personFields[tag] ?? [];
    printed[tag] = {};
    for (const [personId, entered] of Object.entries(people)) {
      printed[tag][personId] = Object.fromEntries(fields.map((field) => [
        oakDocPersonFieldTag(field.key),
        formatOakDocCustomFieldValue(entered[field.key] ?? '', field.type),
      ]));
    }
  }
  return printed;
}

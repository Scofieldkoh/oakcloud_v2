/**
 * Registry of guided form templates and the server-owned binding stored in
 * `Form.settings.template`.
 */

import {
  SG_COMPANY_INCORPORATION_TEMPLATE_KEY,
  SG_COMPANY_INCORPORATION_TEMPLATE_VERSION,
  SG_COMPANY_INCORPORATION_TITLE,
} from './sg-company-incorporation';

export interface FormTemplateSummary {
  key: string;
  version: number;
  title: string;
  description: string;
}

export const FORM_TEMPLATES: FormTemplateSummary[] = [
  {
    key: SG_COMPANY_INCORPORATION_TEMPLATE_KEY,
    version: SG_COMPANY_INCORPORATION_TEMPLATE_VERSION,
    title: SG_COMPANY_INCORPORATION_TITLE,
    description: 'Company details form for incorporating a Singapore company, with ACRA guidance and a staff checklist.',
  },
];

export function getFormTemplateSummary(key: string): FormTemplateSummary | null {
  return FORM_TEMPLATES.find((template) => template.key === key) ?? null;
}

export interface FormTemplateBinding {
  key: string;
  version: number;
  installedAt: string;
  /** Hash of the field definitions when the form was first published. */
  definitionHash: string | null;
  /** Set on first publication; fields can no longer change after this. */
  lockedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseFormTemplateBinding(settings: unknown): FormTemplateBinding | null {
  const root = isRecord(settings) ? settings : null;
  const binding = root && isRecord(root.template) ? root.template : null;
  if (!binding) return null;

  const key = typeof binding.key === 'string' ? binding.key : '';
  const version = typeof binding.version === 'number' && Number.isInteger(binding.version) ? binding.version : 0;
  if (!getFormTemplateSummary(key) || version < 1) return null;

  return {
    key,
    version,
    installedAt: typeof binding.installedAt === 'string' ? binding.installedAt : '',
    definitionHash: typeof binding.definitionHash === 'string' ? binding.definitionHash : null,
    lockedAt: typeof binding.lockedAt === 'string' ? binding.lockedAt : null,
  };
}

export function isCompanyIncorporationForm(settings: unknown): boolean {
  return parseFormTemplateBinding(settings)?.key === SG_COMPANY_INCORPORATION_TEMPLATE_KEY;
}

/**
 * Keep the server-owned binding when a settings object from the client replaces
 * the stored settings. The client can neither add, change nor remove it.
 */
export function preserveFormTemplateBinding(
  nextSettings: Record<string, unknown> | null | undefined,
  existingSettings: unknown
): Record<string, unknown> | null | undefined {
  if (nextSettings === undefined) return undefined;
  const existing = isRecord(existingSettings) && isRecord(existingSettings.template) ? existingSettings.template : null;
  const next = nextSettings ? { ...nextSettings } : null;

  if (!next) {
    return existing ? { template: existing } : null;
  }

  if (existing) {
    next.template = existing;
  } else {
    delete next.template;
  }
  return next;
}

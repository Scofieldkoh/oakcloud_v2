/**
 * Shared mappers for the option endpoints consumed by the document generation
 * workspace. Kept in one place so the page loader and the in-workspace search
 * hooks cannot drift apart on field naming (`name` vs `fullName`).
 */

import { getDocumentTemplateDisplayEngine } from '@/lib/document-editor/document-engine';
import {
  normalizeStoredPlaceholders,
  storageFormatToCustomPlaceholders,
} from '@/lib/template-analysis';
import { readResolutionPreset } from '@/lib/resolution-composition';
import { oakDocContactShortlist, oakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import type {
  Company,
  DocumentContact,
  DocumentTemplateSummary,
} from '@/types/document-generation';

export function mapCompanyOption(raw: Record<string, unknown>): Company {
  const addresses = Array.isArray(raw.addresses)
    ? raw.addresses.filter(
        (address): address is Record<string, unknown> => (
          typeof address === 'object' && address !== null
        ),
      )
    : [];
  const registeredAddress = typeof raw.registeredAddress === 'string'
    ? raw.registeredAddress
    : addresses.find((address) => address.addressType === 'REGISTERED_OFFICE')?.fullAddress
      ?? addresses[0]?.fullAddress;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    uen: String(raw.uen ?? ''),
    status: String(raw.status ?? ''),
    registeredAddress: registeredAddress ? String(registeredAddress) : null,
    incorporationDate: raw.incorporationDate ? String(raw.incorporationDate) : null,
  };
}

export function mapContactOption(raw: Record<string, unknown>): DocumentContact {
  return {
    id: String(raw.id),
    fullName: String(raw.name ?? raw.fullName ?? ''),
    email: raw.email ? String(raw.email) : null,
    phone: raw.phone ? String(raw.phone) : null,
    designation: raw.designation ? String(raw.designation) : null,
  };
}

export function mapTemplateSummary(raw: Record<string, unknown>): DocumentTemplateSummary {
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: raw.description ? String(raw.description) : null,
    category: String(raw.category ?? 'OTHER'),
    compositionType: raw.compositionType === 'SERVICE_AGREEMENT' || raw.compositionType === 'RESOLUTION'
      ? raw.compositionType
      : 'STANDARD',
    version: Number(raw.version ?? 1),
    isActive: raw.isActive !== false,
    engine: getDocumentTemplateDisplayEngine(raw.contentJson),
    content: String(raw.content ?? ''),
    contentJson: raw.contentJson ?? undefined,
    placeholders: storageFormatToCustomPlaceholders(
      normalizeStoredPlaceholders(raw.placeholders),
    ),
    contactShortlist: oakDocContactShortlist(normalizeStoredPlaceholders(raw.placeholders)),
    repeaterSections: oakDocRepeaterSectionSummary(normalizeStoredPlaceholders(raw.placeholders)),
    resolutionPreset: raw.compositionType === 'RESOLUTION' ? readResolutionPreset(raw.resolutionPreset) : null,
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  };
}


/**
 * Normal generation picker source. Engine is intentionally not a filter:
 * active A4 and OakDoc templates are both first-class choices.
 */
export function mapGenerationTemplateSummaries(
  rawTemplates: Array<Record<string, unknown>>,
): DocumentTemplateSummary[] {
  return rawTemplates
    .filter((template) => template.isActive !== false)
    .map(mapTemplateSummary);
}

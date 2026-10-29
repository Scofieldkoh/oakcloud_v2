import { NotFoundError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { ServiceCadence } from '@/lib/validations/service-catalog';
import type { PlaceholderDefinition } from '@/types/placeholders';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import {
  encodeOakDocSowSnapshot,
  readOakDocPartialPins,
} from '@/lib/document-editor/oakdoc-partials';

const PARTIAL_TOKEN = /{{>\s*([A-Za-z0-9_-]+)\s*}}/g;

export interface ServiceVariantSnapshot {
  variantId: string;
  variantVersion: number;
  familyName: string;
  variantName: string;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string | null;
  partialId: string;
  partialVersion: number;
  partialContent: string;
  placeholders: PlaceholderDefinition[];
  dependencies: Array<{
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  }>;
}

export interface ComposablePartial {
  id: string;
  name: string;
  version: number;
  content: string;
  placeholders: unknown;
  updatedAt: Date;
}

function placeholderDefinitions(value: unknown): PlaceholderDefinition[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is PlaceholderDefinition =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as { key?: unknown }).key === 'string',
      )
    : [];
}

export function composeServicePartialGraph(root: ComposablePartial, candidates: ComposablePartial[]) {
  const partialByName = new Map(candidates.map((partial) => [partial.name, partial]));
  const dependencies = new Map<string, ComposablePartial>();
  const placeholders = new Map(
    placeholderDefinitions(root.placeholders).map((definition) => [definition.key, definition]),
  );
  const expand = (content: string, stack: string[]): string =>
    content.replace(PARTIAL_TOKEN, (_token, name: string) => {
      if (stack.includes(name)) throw new ValidationError(`Circular partial reference detected: ${[...stack, name].join(' -> ')}`);
      const nested = partialByName.get(name);
      if (!nested) throw new ValidationError(`Template partial not found: ${name}`);
      dependencies.set(nested.id, nested);
      for (const definition of placeholderDefinitions(nested.placeholders)) {
        if (!placeholders.has(definition.key)) placeholders.set(definition.key, definition);
      }
      return expand(nested.content, [...stack, name]);
    });
  return { content: expand(root.content, [root.name]), placeholders: [...placeholders.values()], dependencies: [...dependencies.values()] };
}

export async function snapshotServiceVariant(
  variantId: string,
  tenantId: string,
): Promise<ServiceVariantSnapshot> {
  const variant = await prisma.serviceVariant.findFirst({
    where: {
      id: variantId,
      tenantId,
      deletedAt: null,
      isActive: true,
      family: { tenantId, deletedAt: null, isActive: true },
      sowPartial: { tenantId, deletedAt: null },
    },
    include: {
      family: true,
      sowPartial: true,
      defaultFeeTemplates: { where: { tenantId }, orderBy: { displayOrder: 'asc' } },
    },
  });
  if (!variant) throw new NotFoundError('Service variant not found');

  const base = {
    variantId: variant.id,
    variantVersion: variant.version,
    familyName: variant.family.name,
    variantName: variant.name,
    serviceCadence: variant.serviceCadence,
    customCadenceLabel: variant.customCadenceLabel,
    partialId: variant.sowPartial.id,
    partialVersion: variant.sowPartial.version,
  };

  // A Word scope of work pins its exact bytes (and nested partials) now, so
  // later edits to the partial never change this agreement's wording.
  const wordAsset = readOakDocTemplateMetadata(variant.sowPartial.contentJson);
  if (wordAsset) {
    return {
      ...base,
      partialContent: encodeOakDocSowSnapshot({
        pin: {
          partialId: variant.sowPartial.id,
          version: variant.sowPartial.version,
          sha256: wordAsset.sha256,
          storageKey: wordAsset.storageKey,
          nested: readOakDocPartialPins(variant.sowPartial.contentJson),
        },
        fieldTags: wordAsset.fieldTags,
      }),
      placeholders: [],
      dependencies: [],
    };
  }

  const partials = await prisma.templatePartial.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      version: true,
      content: true,
      placeholders: true,
      updatedAt: true,
    },
  });
  const composed = composeServicePartialGraph(variant.sowPartial, partials);

  return {
    ...base,
    partialContent: composed.content,
    placeholders: composed.placeholders,
    dependencies: composed.dependencies.map((dependency) => ({
      id: dependency.id,
      name: dependency.name,
      version: dependency.version,
      updatedAt: dependency.updatedAt.toISOString(),
    })),
  };
}

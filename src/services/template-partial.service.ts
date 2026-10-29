/**
 * Template Partial Service
 *
 * Business logic for reusable template partial (snippet) management.
 * Partials are template fragments that can be included in multiple templates
 * using the {{> partial-name}} syntax.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { dayRangeFilter, personNameFilter } from '@/lib/list-column-filters';
import { createAuditLog, computeChanges } from '@/lib/audit';
import { Prisma } from '@/generated/prisma';
import type { TemplatePartial, TemplatePartialCategory } from '@/generated/prisma';
import type { TenantAwareParams } from '@/lib/types';
import { PARTIAL_REFERENCE_REGEX, extractPartialReferences } from '@/lib/template-analysis';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import {
  assertRevisionPrecondition,
  classifyRevisionMiss,
} from '@/lib/document-editor/revision-concurrency';
import { rejectRetiredA4Operation } from '@/lib/document-editor/a4-retirement';
import {
  normalizeStoredFieldDefinitionInput,
  preserveStoredFieldDefinitions,
} from '@/lib/document-editor/template-field-workflow';
import { oakDocContentJsonFilter, readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import { ValidationError } from '@/lib/errors';
import { storage, StorageKeys } from '@/lib/storage';

export interface TemplatePartialWithRelations extends TemplatePartial {
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  _count?: {
    usedInTemplates: number;
  };
}

export type { TenantAwareParams } from '@/lib/types';

export interface CreatePartialInput {
  name: string;
  displayName: string;
  header?: string | null;
  description?: string | null;
  content: string;
  placeholders?: Prisma.InputJsonValue;
  category?: TemplatePartialCategory;
}

export interface UpdatePartialInput {
  id: string;
  expectedRevision?: number;
  name?: string;
  displayName?: string;
  header?: string | null;
  description?: string | null;
  content?: string;
  placeholders?: Prisma.InputJsonValue;
  category?: TemplatePartialCategory;
}

export interface SearchPartialsInput {
  search?: string;
  category?: TemplatePartialCategory;
  /** `oakdoc` lists only Word partials. */
  editor?: 'oakdoc';
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'category' | 'createdBy' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  /** Column filters: name or display name, creator's name, and updated day range. */
  name?: string;
  reference?: string;
  description?: string;
  usage?: 'used' | 'unused';
  createdBy?: string;
  updatedFrom?: string;
  updatedTo?: string;
}

export interface SearchPartialsResult {
  partials: TemplatePartialWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PartialUsageInfo {
  templateId: string;
  templateName: string;
  category: string;
}

export interface PartialServiceVariantUsageInfo {
  id: string;
  name: string;
  isActive: boolean;
}

export interface PartialUsageResult {
  templates: PartialUsageInfo[];
  serviceVariants: PartialServiceVariantUsageInfo[];
}

const TRACKED_FIELDS: (keyof TemplatePartial)[] = [
  'name',
  'displayName',
  'header',
  'description',
  'content',
  'placeholders',
  'category',
];

export function normalizeMaterialContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function preservePartialPlaceholders(value: unknown, partialId: string): Prisma.InputJsonValue {
  if (!Array.isArray(value)) return (value ?? []) as Prisma.InputJsonValue;
  const definitions = normalizeStoredFieldDefinitionInput(value);
  return preserveStoredFieldDefinitions(
    definitions,
    { kind: 'partial', id: partialId },
  ) as Prisma.InputJsonValue;
}

async function classifyPartialRevisionMiss(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  expectedRevision: number | undefined,
): Promise<never> {
  const state = await tx.templatePartial.findFirst({
    where: { id, tenantId },
    select: { version: true, deletedAt: true },
  });
  classifyRevisionMiss(
    state
      ? { revision: state.version, deleted: state.deletedAt !== null, locked: false }
      : null,
    { resource: 'template-partial', expectedRevision },
  );
}

export async function createTemplatePartial(
  _data: CreatePartialInput,
  _params: TenantAwareParams,
): Promise<TemplatePartial> {
  // Word partials are created by the OakDoc partial service.
  return rejectRetiredA4Operation('partial-create');
}

export async function updateTemplatePartial(
  data: UpdatePartialInput,
  params: TenantAwareParams,
  reason?: string,
): Promise<TemplatePartial> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(data.expectedRevision, 'template-partial');

  if (data.name && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(data.name)) {
    throw new Error(
      'Partial name must start with a letter and contain only letters, numbers, hyphens, and underscores',
    );
  }

  return runSerializableTransaction(prisma, async (tx) => {
    const existing = await tx.templatePartial.findFirst({
      where: { id: data.id, tenantId, deletedAt: null },
    });
    if (!existing) throw new Error('Partial not found');
    if (data.content !== undefined && readOakDocTemplateMetadata(existing.contentJson)) {
      throw new ValidationError('Word partial content is edited in the Word document, not as HTML');
    }

    if (data.content !== undefined) rejectRetiredA4Operation('partial-edit');

    if (data.name && data.name !== existing.name) {
      const existingName = await tx.templatePartial.findFirst({
        where: {
          tenantId,
          name: data.name,
          deletedAt: null,
          NOT: { id: data.id },
        },
      });
      if (existingName) throw new Error('A partial with this name already exists');
    }

    const updateData: Prisma.TemplatePartialUpdateManyMutationInput = {
      version: { increment: 1 },
    };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.header !== undefined) updateData.header = data.header?.trim() || null;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.placeholders !== undefined) {
      updateData.placeholders = preservePartialPlaceholders(data.placeholders, data.id);
    }

    const contentChanged =
      data.content !== undefined
      && normalizeMaterialContent(data.content) !== normalizeMaterialContent(existing.content);
    const placeholdersChanged =
      data.placeholders !== undefined
      && stableSerialize(updateData.placeholders) !== stableSerialize(existing.placeholders);
    const materialChanged = contentChanged || placeholdersChanged;

    const result = await tx.templatePartial.updateMany({
      where: {
        id: data.id,
        tenantId,
        deletedAt: null,
        ...(data.expectedRevision !== undefined ? { version: data.expectedRevision } : {}),
      },
      data: updateData,
    });
    if (result.count !== 1) {
      return classifyPartialRevisionMiss(tx, data.id, tenantId, data.expectedRevision);
    }

    const partial = await tx.templatePartial.findFirstOrThrow({
      where: { id: data.id, tenantId },
    });
    const changes = computeChanges(existing, partial, TRACKED_FIELDS) ?? {};
    const changedFields = Object.keys(changes);

    if (changedFields.length > 0) {
      await createAuditLog({
        tenantId,
        userId,
        action: 'UPDATE',
        entityType: 'TemplatePartial',
        entityId: partial.id,
        entityName: partial.name,
        summary: `Updated template partial "${partial.name}" (${changedFields.join(', ')})`,
        changeSource: 'MANUAL',
        changes,
        reason,
        metadata: {
          oldVersion: existing.version,
          newVersion: partial.version,
          materialChanged,
        },
      }, tx);
    }

    return partial;
  });
}

export async function deleteTemplatePartial(
  partialId: string,
  params: TenantAwareParams,
  reason?: string,
  expectedRevision?: number,
): Promise<void> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(expectedRevision, 'template-partial');

  await runSerializableTransaction(prisma, async (tx) => {
    const partial = await tx.templatePartial.findFirst({
      where: { id: partialId, tenantId, deletedAt: null },
    });
    if (!partial) throw new Error('Partial not found');

    const usage = await getPartialUsageWithClient(partialId, params, tx, partial);
    if (usage.serviceVariants.length > 0) {
      const variantNames = usage.serviceVariants.slice(0, 3).map((variant) => variant.name).join(', ');
      const moreText = usage.serviceVariants.length > 3
        ? ` and ${usage.serviceVariants.length - 3} more`
        : '';
      throw new Error(
        `Cannot delete partial: relink or archive ${usage.serviceVariants.length} service variant(s) (${variantNames}${moreText}) first`,
      );
    }
    if (usage.templates.length > 0) {
      const templateNames = usage.templates.slice(0, 3).map((u) => u.templateName).join(', ');
      const moreText = usage.templates.length > 3 ? ` and ${usage.templates.length - 3} more` : '';
      throw new Error(
        `Cannot delete partial: it is used in ${usage.templates.length} template(s) (${templateNames}${moreText})`,
      );
    }

    const result = await tx.templatePartial.updateMany({
      where: {
        id: partialId,
        tenantId,
        deletedAt: null,
        ...(expectedRevision !== undefined ? { version: expectedRevision } : {}),
      },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (result.count !== 1) {
      return classifyPartialRevisionMiss(tx, partialId, tenantId, expectedRevision);
    }

    await createAuditLog({
      tenantId,
      userId,
      action: 'DELETE',
      entityType: 'TemplatePartial',
      entityId: partial.id,
      entityName: partial.name,
      summary: `Deleted template partial "${partial.name}"`,
      changeSource: 'MANUAL',
      reason,
    }, tx);
  });
}

export async function getTemplatePartial(
  partialId: string,
  params: TenantAwareParams,
): Promise<TemplatePartialWithRelations | null> {
  const { tenantId } = params;

  const partial = await prisma.templatePartial.findFirst({
    where: { id: partialId, tenantId, deletedAt: null },
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  if (!partial) return null;
  const usageCount = await countPartialUsage(partialId, params);
  return { ...partial, _count: { usedInTemplates: usageCount } };
}

export async function getTemplatePartialByName(
  name: string,
  tenantId: string,
): Promise<TemplatePartial | null> {
  const partial = await prisma.templatePartial.findFirst({
    where: { name, tenantId, deletedAt: null },
  });
  return partial ?? null;
}

export async function searchTemplatePartials(
  input: SearchPartialsInput,
  params: TenantAwareParams,
): Promise<SearchPartialsResult> {
  const { tenantId } = params;
  const {
    search,
    page = 1,
    limit = 20,
    sortBy = 'name',
    sortOrder = 'asc',
    editor,
    category,
    name,
    reference,
    description,
    usage,
    createdBy,
    updatedFrom,
    updatedTo,
  } = input;

  const where: Prisma.TemplatePartialWhereInput = { tenantId, deletedAt: null };
  const and: Prisma.TemplatePartialWhereInput[] = [];
  if (category) where.category = category;
  if (name?.trim()) {
    and.push({
      OR: [
        { name: { contains: name.trim(), mode: 'insensitive' } },
        { displayName: { contains: name.trim(), mode: 'insensitive' } },
      ],
    });
  }
  if (reference?.trim()) and.push({ name: { contains: reference.trim(), mode: 'insensitive' } });
  if (description?.trim()) where.description = { contains: description.trim(), mode: 'insensitive' };
  if (createdBy?.trim()) where.createdBy = personNameFilter(createdBy);
  const updatedAt = dayRangeFilter(updatedFrom, updatedTo);
  if (updatedAt) where.updatedAt = updatedAt;
  if (and.length > 0) where.AND = and;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (editor === 'oakdoc') {
    where.contentJson = oakDocContentJsonFilter();
  }

  const orderBy: Prisma.TemplatePartialOrderByWithRelationInput[] = sortBy === 'createdBy'
    ? [{ createdBy: { firstName: sortOrder } }, { name: 'asc' }]
    : sortBy === 'name'
      ? [{ name: sortOrder }]
      : [{ [sortBy]: sortOrder }, { name: 'asc' }];
  const usageCount = await loadTemplateUsageCounter(tenantId);
  const withUsage = (partial: TemplatePartialWithRelations) =>
    ({ ...partial, _count: { usedInTemplates: usageCount(partial.name) } });

  // Usage is worked out from template content, not stored, so a usage filter
  // counts every matching partial and pages the filtered list in memory.
  if (usage) {
    const matching = (await prisma.templatePartial.findMany({
      where,
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy,
    })).map(withUsage);
    const filtered = matching.filter((partial) => (partial._count.usedInTemplates > 0) === (usage === 'used'));
    return {
      partials: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
      page,
      limit,
      totalPages: Math.ceil(filtered.length / limit),
    };
  }

  const [partials, total] = await Promise.all([
    prisma.templatePartial.findMany({
      where,
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.templatePartial.count({ where }),
  ]);

  const partialsWithCounts = partials.map(withUsage);

  return {
    partials: partialsWithCounts,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getAllTemplatePartials(
  tenantId: string,
): Promise<Array<
  Pick<TemplatePartial, 'id' | 'name' | 'displayName' | 'header' | 'description' | 'content' | 'placeholders' | 'version' | 'category'>
  & { documentEngine: 'A4' | 'OAKDOC'; fieldTags: string[] }
>> {
  const partials = await prisma.templatePartial.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      displayName: true,
      header: true,
      description: true,
      content: true,
      placeholders: true,
      version: true,
      category: true,
      contentJson: true,
    },
    orderBy: { name: 'asc' },
  });
  return partials.map(({ contentJson, ...partial }) => {
    const oakDoc = readOakDocTemplateMetadata(contentJson);
    return {
      ...partial,
      documentEngine: oakDoc ? 'OAKDOC' as const : 'A4' as const,
      // Word partial field tags, so Configure offers the parties a chosen partial uses.
      fieldTags: oakDoc?.fieldTags ?? [],
    };
  });
}

export async function getPartialUsage(
  partialId: string,
  params: TenantAwareParams,
): Promise<PartialUsageResult> {
  return getPartialUsageWithClient(partialId, params, prisma);
}

async function getPartialUsageWithClient(
  partialId: string,
  params: TenantAwareParams,
  client: Prisma.TransactionClient | typeof prisma,
  knownPartial?: TemplatePartial,
): Promise<PartialUsageResult> {
  const { tenantId } = params;

  const partial = knownPartial ?? await client.templatePartial.findFirst({
    where: { id: partialId, tenantId, deletedAt: null },
  });
  if (!partial) return { templates: [], serviceVariants: [] };

  const [templates, serviceVariants] = await Promise.all([
    client.documentTemplate.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, category: true, content: true },
    }),
    client.serviceVariant.findMany({
      where: { tenantId, sowPartialId: partialId, deletedAt: null },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    templates: templates
      .filter((template) => extractPartialReferences(template.content).includes(partial.name))
      .map((template) => ({
        templateId: template.id,
        templateName: template.name,
        category: template.category,
      })),
    serviceVariants,
  };
}

async function countPartialUsage(
  partialId: string,
  params: TenantAwareParams,
): Promise<number> {
  const usage = await getPartialUsage(partialId, params);
  return usage.templates.length;
}

/**
 * Reads every template once and returns how many reference a partial name,
 * the same count `getPartialUsage` gives per partial.
 */
async function loadTemplateUsageCounter(tenantId: string): Promise<(partialName: string) => number> {
  const templates = await prisma.documentTemplate.findMany({
    where: { tenantId, deletedAt: null },
    select: { content: true },
  });
  const counts = new Map<string, number>();
  for (const template of templates) {
    for (const name of new Set(extractPartialReferences(template.content))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return (partialName) => counts.get(partialName) ?? 0;
}

export async function getPartialsUsedInTemplate(
  templateContent: string,
  tenantId: string,
): Promise<TemplatePartial[]> {
  const initialPartialNames = extractPartialReferences(templateContent);
  if (initialPartialNames.length === 0) return [];

  const allPartials = await prisma.templatePartial.findMany({
    where: { tenantId, deletedAt: null },
  });
  const partialByName = new Map(allPartials.map((partial) => [partial.name, partial]));
  const resolvedNames = new Set<string>();

  const visit = (partialName: string) => {
    if (resolvedNames.has(partialName)) return;
    resolvedNames.add(partialName);
    const partial = partialByName.get(partialName);
    if (!partial) return;
    for (const nestedName of extractPartialReferences(partial.content)) visit(nestedName);
  };

  initialPartialNames.forEach(visit);
  return Array.from(resolvedNames)
    .map((partialName) => partialByName.get(partialName))
    .filter((partial): partial is TemplatePartial => Boolean(partial));
}

export async function resolvePartials(
  content: string,
  tenantId: string,
  resolvedPartials = new Set<string>(),
): Promise<string> {
  const matches = Array.from(content.matchAll(PARTIAL_REFERENCE_REGEX));
  if (matches.length === 0) return content;

  const partialNames = matches.map((m) => m[1]);
  const partials = await prisma.templatePartial.findMany({
    where: { tenantId, name: { in: partialNames }, deletedAt: null },
  });
  const partialMap = new Map(partials.map((p) => [p.name, p.content]));

  let resolved = content;
  for (const match of matches) {
    const partialName = match[1];
    const fullMatch = match[0];
    if (resolvedPartials.has(partialName)) {
      throw new Error(`Circular partial reference detected: ${partialName}`);
    }

    const partialContent = partialMap.get(partialName);
    if (partialContent) {
      resolvedPartials.add(partialName);
      const resolvedPartialContent = await resolvePartials(
        partialContent,
        tenantId,
        resolvedPartials,
      );
      resolved = resolved.replace(fullMatch, resolvedPartialContent);
    } else {
      throw new Error(`Template partial not found: ${partialName}`);
    }
  }

  return resolved;
}

export async function duplicateTemplatePartial(
  partialId: string,
  newName: string,
  params: TenantAwareParams,
): Promise<TemplatePartial> {
  const { tenantId, userId } = params;

  const source = await prisma.templatePartial.findFirst({
    where: { id: partialId, tenantId, deletedAt: null },
  });
  if (!source) throw new Error('Partial not found');
  const nativeAsset = readOakDocTemplateMetadata(source.contentJson);
  if (!nativeAsset) rejectRetiredA4Operation('partial-duplicate');

  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(newName)) {
    throw new Error(
      'Partial name must start with a letter and contain only letters, numbers, hyphens, and underscores',
    );
  }

  const existingName = await prisma.templatePartial.findFirst({
    where: { tenantId, name: newName, deletedAt: null },
  });
  if (existingName) throw new Error('A partial with this name already exists');

  const id = randomUUID();
  // A Word partial's copy owns its own asset under the new partial's prefix;
  // its nested partial pins are kept as they are.
  let contentJson: Prisma.InputJsonValue | undefined;
  if (nativeAsset) {
    if (!nativeAsset.storageKey.startsWith(`${tenantId}/template-partials/${source.id}/oakdoc/`)) {
      throw new ValidationError('Partial storage scope is invalid');
    }
    const storageKey = StorageKeys.oakDocPartialAsset(tenantId, id, nativeAsset.sha256);
    await storage.copy(nativeAsset.storageKey, storageKey);
    contentJson = {
      ...(source.contentJson as Record<string, unknown>),
      oakDoc: { ...nativeAsset, storageKey },
    } as Prisma.InputJsonValue;
  }
  const partial = await prisma.templatePartial.create({
    data: {
      id,
      tenantId,
      name: newName,
      ...(contentJson ? { contentJson } : {}),
      displayName: source.displayName
        ? `Copy of ${source.displayName}`
        : `Copy of ${source.name}`,
      description: source.description
        ? `Copy of: ${source.description}`
        : `Copy of ${source.name}`,
      content: source.content,
      header: source.header,
      category: source.category,
      placeholders: preservePartialPlaceholders(source.placeholders, id),
      createdById: userId,
      version: 1,
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'CREATE',
    entityType: 'TemplatePartial',
    entityId: partial.id,
    entityName: partial.name,
    summary: `Duplicated template partial "${source.name}" as "${partial.name}"`,
    changeSource: 'MANUAL',
    metadata: { sourceId: source.id, sourceName: source.name },
  });

  return partial;
}

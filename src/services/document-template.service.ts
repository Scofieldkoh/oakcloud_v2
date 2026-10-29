/**
 * Document Template Service
 *
 * Business logic for document template management including CRUD operations,
 * search, and template duplication. Fully integrated with multi-tenancy support.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { dayRangeFilter, personNameFilter } from '@/lib/list-column-filters';
import { createAuditLog, computeChanges } from '@/lib/audit';
import type {
  CreateDocumentTemplateInput,
  UpdateDocumentTemplateInput,
  SearchDocumentTemplatesInput,
  DuplicateDocumentTemplateInput,
  UpdateResolutionPresetInput,
} from '@/lib/validations/document-template';
import { Prisma } from '@/generated/prisma';
import type { DocumentTemplate, DocumentTemplateCategory } from '@/generated/prisma';
import type { TenantAwareParams } from '@/lib/types';
import {
  analyzeTemplateContent,
  extractPartialReferences,
  normalizePlaceholderKey,
  normalizeStoredPlaceholders,
  type StoredPlaceholderLike,
} from '@/lib/template-analysis';
import { assertValidTemplateComposition } from '@/lib/service-agreement-template';
import { parseSharePointRelativeFolderPath } from '@/lib/sharepoint/relative-folder-path';
import {
  assertRevisionPrecondition,
  classifyRevisionMiss,
} from '@/lib/document-editor/revision-concurrency';
import { rejectRetiredA4Operation } from '@/lib/document-editor/a4-retirement';
import {
  RESERVED_TEMPLATE_CONTENT_JSON_KEYS,
  TEMPLATE_AUTHORITY_KEYS,
  mergeUserJsonPreservingReserved,
  stripKeys,
} from '@/lib/document-editor/oakdoc-reserved-metadata';
import { getDocumentTemplateEngineState } from '@/lib/document-editor/document-engine';
import { NotFoundError, ValidationError } from '@/lib/errors';
import {
  normalizeStoredFieldDefinitionInput,
  preserveStoredFieldDefinitions,
} from '@/lib/document-editor/template-field-workflow';
import { storage, StorageKeys } from '@/lib/storage';
import {
  mergeOakDocTemplateMetadata,
  oakDocContentJsonFilter,
  readOakDocTemplateMetadata,
} from '@/lib/document-editor/oakdoc-template';

export interface DocumentTemplateWithRelations extends DocumentTemplate {
  createdBy?: { id: string; firstName: string; lastName: string };
  _count?: { generatedDocuments: number };
}

export type { TenantAwareParams } from '@/lib/types';

const TRACKED_FIELDS: (keyof DocumentTemplate)[] = [
  'name', 'description', 'category', 'compositionType', 'content', 'contentJson', 'isActive',
  'sharePointRelativeFolderPath',
];

function normalizeSharePointRelativeFolderPath(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  return parseSharePointRelativeFolderPath(value).normalized;
}

function preserveTemplatePlaceholders(value: unknown, templateId: string): Prisma.InputJsonValue {
  if (!Array.isArray(value)) return (value ?? []) as Prisma.InputJsonValue;
  return preserveStoredFieldDefinitions(
    normalizeStoredFieldDefinitionInput(value),
    { kind: 'template', id: templateId },
  ) as Prisma.InputJsonValue;
}

async function classifyTemplateRevisionMiss(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  expectedRevision: number | undefined,
  options: { expectDeleted?: boolean } = {},
): Promise<never> {
  const state = await tx.documentTemplate.findFirst({
    where: { id, tenantId },
    select: { version: true, deletedAt: true },
  });

  if (options.expectDeleted) {
    classifyRevisionMiss(
      state ? { revision: state.version, deleted: false, locked: state.deletedAt === null } : null,
      { resource: 'document-template', expectedRevision },
    );
  }

  classifyRevisionMiss(
    state ? { revision: state.version, deleted: state.deletedAt !== null, locked: false } : null,
    { resource: 'document-template', expectedRevision },
  );
}

/**
 * `user` writes come from generic JSON routes and may not touch server-owned
 * OakDoc namespaces. Only OakDoc asset/migration services pass `oakdoc-service`.
 */
export type TemplateWriter = 'user' | 'oakdoc-service';

export interface TemplateWriteOptions {
  writer?: TemplateWriter;
}

export async function createDocumentTemplate(
  data: CreateDocumentTemplateInput,
  params: TenantAwareParams,
  options: TemplateWriteOptions = {},
): Promise<DocumentTemplate> {
  const { tenantId, userId } = params;
  // Only the OakDoc services create templates; a user write would be A4.
  if ((options.writer ?? 'user') === 'user') rejectRetiredA4Operation('template-create');
  assertValidTemplateComposition(data.compositionType, data.content);

  const existingName = await prisma.documentTemplate.findFirst({
    where: { tenantId, name: data.name, deletedAt: null },
  });
  if (existingName) throw new Error('A template with this name already exists');

  const id = randomUUID();
  const template = await prisma.documentTemplate.create({
    data: {
      id,
      tenantId,
      name: data.name,
      description: data.description,
      category: data.category,
      compositionType: data.compositionType,
      content: data.content,
      contentJson: data.contentJson ?? undefined,
      placeholders: preserveTemplatePlaceholders(data.placeholders, id),
      sharePointRelativeFolderPath: normalizeSharePointRelativeFolderPath(data.sharePointRelativeFolderPath),
      isActive: data.isActive,
      createdById: userId,
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'DOCUMENT_TEMPLATE_CREATED',
    entityType: 'DocumentTemplate',
    entityId: template.id,
    entityName: template.name,
    summary: `Created document template "${template.name}"`,
    changeSource: 'MANUAL',
    metadata: { category: template.category, name: template.name },
  });
  return template;
}

export async function updateDocumentTemplate(
  input: UpdateDocumentTemplateInput,
  params: TenantAwareParams,
  reason?: string,
  options: TemplateWriteOptions = {},
): Promise<DocumentTemplate> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(input.expectedRevision, 'document-template');

  const existing = await prisma.documentTemplate.findFirst({
    where: { id: input.id, tenantId, deletedAt: null },
  });
  if (!existing) throw new Error('Template not found');

  let data = input;
  if ((options.writer ?? 'user') === 'user') {
    const engine = getDocumentTemplateEngineState(existing.contentJson);
    if (engine !== 'A4' && input.content !== undefined) {
      throw new ValidationError('OakDoc template content is edited in the Word document, not as HTML');
    }
    if (engine === 'A4' && (input.content !== undefined || input.contentJson !== undefined)) {
      rejectRetiredA4Operation('template-edit');
    }
    if (input.contentJson !== undefined) {
      data = {
        ...input,
        contentJson: mergeUserJsonPreservingReserved(
          existing.contentJson,
          input.contentJson,
          RESERVED_TEMPLATE_CONTENT_JSON_KEYS,
          'contentJson',
        ) as UpdateDocumentTemplateInput['contentJson'],
      };
    }
  }

  const effectiveContent = data.content ?? existing.content;
  assertValidTemplateComposition(data.compositionType ?? existing.compositionType, effectiveContent);

  if (data.name && data.name !== existing.name) {
    const existingName = await prisma.documentTemplate.findFirst({
      where: { tenantId, name: data.name, deletedAt: null, NOT: { id: data.id } },
    });
    if (existingName) throw new Error('A template with this name already exists');
  }

  const updateData: Prisma.DocumentTemplateUpdateManyMutationInput = {
    version: { increment: 1 },
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.compositionType !== undefined) updateData.compositionType = data.compositionType;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.contentJson !== undefined) {
    updateData.contentJson = data.contentJson === null ? Prisma.JsonNull : data.contentJson;
  }
  if (data.placeholders !== undefined) {
    updateData.placeholders = preserveTemplatePlaceholders(data.placeholders, data.id);
  }
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.sharePointRelativeFolderPath !== undefined) {
    updateData.sharePointRelativeFolderPath = normalizeSharePointRelativeFolderPath(data.sharePointRelativeFolderPath);
  }

  const template = await prisma.$transaction(async (tx) => {
    const result = await tx.documentTemplate.updateMany({
      where: {
        id: data.id,
        tenantId,
        deletedAt: null,
        ...(data.expectedRevision !== undefined ? { version: data.expectedRevision } : {}),
      },
      data: updateData,
    });
    if (result.count !== 1) {
      return classifyTemplateRevisionMiss(tx, data.id, tenantId, data.expectedRevision);
    }
    return tx.documentTemplate.findFirstOrThrow({ where: { id: data.id, tenantId } });
  });

  const changes = computeChanges(
    existing as Record<string, unknown>,
    data,
    TRACKED_FIELDS as string[],
  );
  if (changes) {
    const changedFields = Object.keys(changes).join(', ');
    await createAuditLog({
      tenantId,
      userId,
      action: 'DOCUMENT_TEMPLATE_UPDATED',
      entityType: 'DocumentTemplate',
      entityId: template.id,
      entityName: template.name,
      summary: `Updated document template "${template.name}" (${changedFields})`,
      changeSource: 'MANUAL',
      changes,
      reason,
    });
  }
  return template;
}

export async function deleteDocumentTemplate(
  id: string,
  params: TenantAwareParams,
  reason: string,
  expectedRevision?: number,
): Promise<DocumentTemplate> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(expectedRevision, 'document-template');
  const existing = await prisma.documentTemplate.findFirst({
    where: { id, tenantId },
    include: { _count: { select: { generatedDocuments: true } } },
  });
  if (!existing) throw new Error('Template not found');
  if (existing.deletedAt) throw new Error('Template is already deleted');

  const template = await prisma.$transaction(async (tx) => {
    const result = await tx.documentTemplate.updateMany({
      where: {
        id,
        tenantId,
        deletedAt: null,
        ...(expectedRevision !== undefined ? { version: expectedRevision } : {}),
      },
      data: { deletedAt: new Date(), isActive: false, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      return classifyTemplateRevisionMiss(tx, id, tenantId, expectedRevision);
    }
    return tx.documentTemplate.findFirstOrThrow({ where: { id, tenantId } });
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'DOCUMENT_TEMPLATE_DELETED',
    entityType: 'DocumentTemplate',
    entityId: template.id,
    entityName: template.name,
    summary: `Deleted document template "${template.name}"`,
    changeSource: 'MANUAL',
    reason,
    metadata: {
      name: template.name,
      category: template.category,
      documentCount: existing._count.generatedDocuments,
    },
  });
  return template;
}

export async function restoreDocumentTemplate(
  id: string,
  params: TenantAwareParams,
  expectedRevision?: number,
): Promise<DocumentTemplate> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(expectedRevision, 'document-template');
  const existing = await prisma.documentTemplate.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error('Template not found');
  if (!existing.deletedAt) throw new Error('Template is not deleted');

  const conflicting = await prisma.documentTemplate.findFirst({
    where: { tenantId, name: existing.name, deletedAt: null, NOT: { id } },
  });
  if (conflicting) throw new Error('Cannot restore: a template with this name already exists');

  const template = await prisma.$transaction(async (tx) => {
    const result = await tx.documentTemplate.updateMany({
      where: {
        id,
        tenantId,
        deletedAt: { not: null },
        ...(expectedRevision !== undefined ? { version: expectedRevision } : {}),
      },
      data: { deletedAt: null, isActive: true, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      return classifyTemplateRevisionMiss(tx, id, tenantId, expectedRevision, { expectDeleted: true });
    }
    return tx.documentTemplate.findFirstOrThrow({ where: { id, tenantId } });
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'RESTORE',
    entityType: 'DocumentTemplate',
    entityId: template.id,
    entityName: template.name,
    summary: `Restored document template "${template.name}"`,
    changeSource: 'MANUAL',
    metadata: { name: template.name, category: template.category },
  });
  return template;
}

function resolutionPresetForCopy(
  source: Pick<DocumentTemplate, 'compositionType' | 'resolutionPreset'>,
  override: DuplicateDocumentTemplateInput['resolutionPreset'],
): { resolutionPreset?: Prisma.InputJsonValue } {
  if (source.compositionType !== 'RESOLUTION') return {};
  const preset = override !== undefined ? override : source.resolutionPreset;
  return preset == null ? {} : { resolutionPreset: preset as Prisma.InputJsonValue };
}

/**
 * Save the resolutions a RESOLUTION template pre-fills on Configure. The Word
 * master is unchanged, so the template version stays the same.
 */
export async function setDocumentTemplateResolutionPreset(
  id: string,
  resolutionPreset: UpdateResolutionPresetInput['resolutionPreset'],
  params: TenantAwareParams,
): Promise<DocumentTemplate> {
  const { tenantId, userId } = params;
  const existing = await prisma.documentTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!existing) throw new NotFoundError('Template not found');
  if (existing.compositionType !== 'RESOLUTION') {
    throw new ValidationError('Preset resolutions are only available on resolution templates.');
  }
  const template = await prisma.documentTemplate.update({
    where: { id },
    data: { resolutionPreset: resolutionPreset ?? Prisma.DbNull },
  });
  await createAuditLog({
    tenantId,
    userId,
    action: 'DOCUMENT_TEMPLATE_UPDATED',
    entityType: 'DocumentTemplate',
    entityId: template.id,
    entityName: template.name,
    summary: `Updated the preset resolutions of "${template.name}" (${resolutionPreset?.sections.length ?? 0} resolutions)`,
    changeSource: 'MANUAL',
  });
  return template;
}

export async function duplicateDocumentTemplate(
  data: DuplicateDocumentTemplateInput,
  params: TenantAwareParams,
): Promise<DocumentTemplate> {
  const { tenantId, userId } = params;
  const existing = await prisma.documentTemplate.findFirst({
    where: { id: data.id, tenantId, deletedAt: null },
  });
  if (!existing) throw new Error('Template not found');
  if (getDocumentTemplateEngineState(existing.contentJson) === 'A4') {
    rejectRetiredA4Operation('template-duplicate');
  }
  assertValidTemplateComposition(existing.compositionType, existing.content);

  let newName = data.name || `Copy of ${existing.name}`;
  let counter = 1;
  while (true) {
    const existingName = await prisma.documentTemplate.findFirst({
      where: { tenantId, name: newName, deletedAt: null },
    });
    if (!existingName) break;
    counter++;
    newName = data.name ? `${data.name} (${counter})` : `Copy of ${existing.name} (${counter})`;
    if (counter > 100) throw new Error('Unable to generate unique name');
  }

  const oakDocMetadata = readOakDocTemplateMetadata(existing.contentJson);
  // Migration links, seed identity and validation evidence belong to the
  // source record only; a duplicate starts without that authority.
  const contentJsonWithoutAuthority = stripKeys(existing.contentJson, TEMPLATE_AUTHORITY_KEYS);
  let duplicatedContentJson: Prisma.InputJsonValue | undefined = contentJsonWithoutAuthority == null
    ? undefined
    : contentJsonWithoutAuthority as Prisma.InputJsonValue;
  let copiedOakDocStorageKey: string | null = null;

  if (oakDocMetadata) {
    if (!oakDocMetadata.storageKey.startsWith(`${tenantId}/templates/oakdoc/assets/`)) {
      throw new Error('OakDoc template storage scope is invalid');
    }

    copiedOakDocStorageKey = StorageKeys.oakDocTemplateAsset(tenantId, randomUUID());
    await storage.copy(oakDocMetadata.storageKey, copiedOakDocStorageKey);
    duplicatedContentJson = mergeOakDocTemplateMetadata(contentJsonWithoutAuthority, {
      ...oakDocMetadata,
      storageKey: copiedOakDocStorageKey,
    });
  }

  const id = randomUUID();
  let template: DocumentTemplate;
  try {
    template = await prisma.documentTemplate.create({
      data: {
        id,
        tenantId,
        name: newName,
        description: existing.description,
        category: existing.category,
        compositionType: existing.compositionType,
        content: existing.content,
        contentJson: duplicatedContentJson,
        placeholders: preserveTemplatePlaceholders(existing.placeholders, id),
        sharePointRelativeFolderPath: existing.sharePointRelativeFolderPath,
        ...resolutionPresetForCopy(existing, data.resolutionPreset),
        isActive: true,
        createdById: userId,
        version: 1,
      },
    });
  } catch (error) {
    if (copiedOakDocStorageKey) {
      await storage.delete(copiedOakDocStorageKey).catch(() => undefined);
    }
    throw error;
  }

  await createAuditLog({
    tenantId,
    userId,
    action: 'DOCUMENT_TEMPLATE_DUPLICATED',
    entityType: 'DocumentTemplate',
    entityId: template.id,
    entityName: template.name,
    summary: `Duplicated template "${existing.name}" as "${template.name}"`,
    changeSource: 'MANUAL',
    metadata: {
      sourceTemplateId: existing.id,
      sourceTemplateName: existing.name,
      newName: template.name,
      ...(copiedOakDocStorageKey ? { duplicatedOakDocAsset: true } : {}),
    },
  });
  return template;
}

export interface GetTemplateOptions { includeDeleted?: boolean }

export async function getDocumentTemplateById(
  id: string,
  tenantId: string,
  options: GetTemplateOptions = {},
): Promise<DocumentTemplateWithRelations | null> {
  const where: Prisma.DocumentTemplateWhereInput = { id, tenantId };
  if (!options.includeDeleted) where.deletedAt = null;
  const template = await prisma.documentTemplate.findFirst({
    where,
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { generatedDocuments: true } },
    },
  });
  return template ?? null;
}

export async function searchDocumentTemplates(
  params: SearchDocumentTemplatesInput,
  tenantId: string,
): Promise<{
  templates: DocumentTemplateWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const where: Prisma.DocumentTemplateWhereInput = { tenantId, deletedAt: null };
  if (params.query) {
    const searchTerm = params.query.trim();
    where.OR = [
      { name: { contains: searchTerm, mode: 'insensitive' } },
      { description: { contains: searchTerm, mode: 'insensitive' } },
    ];
  }
  if (params.name?.trim()) where.name = { contains: params.name.trim(), mode: 'insensitive' };
  if (params.description?.trim()) where.description = { contains: params.description.trim(), mode: 'insensitive' };
  if (params.version !== undefined) where.version = params.version;
  if (params.usage) where.generatedDocuments = params.usage === 'used' ? { some: {} } : { none: {} };
  if (params.category) where.category = params.category;
  if (params.isActive !== undefined) where.isActive = params.isActive;
  if (params.createdBy?.trim()) where.createdBy = personNameFilter(params.createdBy);
  const updatedAt = dayRangeFilter(params.updatedFrom, params.updatedTo);
  if (updatedAt) where.updatedAt = updatedAt;
  if (params.editor === 'oakdoc') {
    where.contentJson = oakDocContentJsonFilter();
  }

  const order = params.sortOrder;
  const primaryOrder: Prisma.DocumentTemplateOrderByWithRelationInput =
    params.sortBy === 'usage'
      ? { generatedDocuments: { _count: order } }
      : params.sortBy === 'createdBy'
        ? { createdBy: { firstName: order } }
        : { [params.sortBy]: order };
  // Ties (same status, version or usage) keep a stable name order across pages.
  const orderBy = params.sortBy === 'name' ? [primaryOrder] : [primaryOrder, { name: 'asc' as const }];
  const skip = (params.page - 1) * params.limit;
  const [templates, total] = await Promise.all([
    prisma.documentTemplate.findMany({
      where,
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { generatedDocuments: true } },
      },
      orderBy,
      skip,
      take: params.limit,
    }),
    prisma.documentTemplate.count({ where }),
  ]);
  return { templates, total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
}

export async function getTemplateStats(tenantId: string): Promise<{
  total: number;
  active: number;
  byCategory: Record<string, number>;
  recentlyCreated: number;
  mostUsed: Array<{ id: string; name: string; usageCount: number }>;
  health: {
    activeTemplatesCanGenerateCleanly: number;
    activeTemplatesWithMissingPartials: number;
    missingPartialReferences: Array<{ templateId: string; templateName: string; partialName: string }>;
    inactivePartialReferences: Array<{ templateId: string; templateName: string; partialName: string }>;
    circularPartialReferences: Array<{ templateId: string; templateName: string; cycle: string }>;
    unknownPlaceholders: Array<{ templateId: string; templateName: string; key: string }>;
    syntaxErrors: Array<{ templateId: string; templateName: string; message: string }>;
    stalePartialMetadata: Array<{ templateId: string; templateName: string; partialName: string; key: string }>;
    requiredCustomFields: Array<{ templateId: string; templateName: string; key: string; label: string }>;
    templates: Array<{
      id: string;
      name: string;
      isActive: boolean;
      missingPartials: string[];
      inactivePartials: string[];
      circularPartials: string[];
      unknownPlaceholders: string[];
      syntaxErrors: string[];
      stalePartialMetadata: Array<{ partialName: string; key: string }>;
      requiredCustomFields: Array<{ key: string; label: string }>;
      lastSuccessfulTest: string | null;
      canGenerateCleanly: boolean;
      canGenerateWithSampleData: boolean;
      dependencyCount: number;
    }>;
  };
}> {
  const [total, active, byCategory, recentlyCreated, mostUsed, templatesForHealth, partials] = await Promise.all([
    prisma.documentTemplate.count({ where: { tenantId, deletedAt: null } }),
    prisma.documentTemplate.count({ where: { tenantId, deletedAt: null, isActive: true } }),
    prisma.documentTemplate.groupBy({
      by: ['category'],
      where: { tenantId, deletedAt: null },
      _count: true,
    }),
    prisma.documentTemplate.count({
      where: {
        tenantId,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.documentTemplate.findMany({
      where: { tenantId, deletedAt: null },
      include: { _count: { select: { generatedDocuments: true } } },
      orderBy: { generatedDocuments: { _count: 'desc' } },
      take: 5,
    }),
    prisma.documentTemplate.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, content: true, placeholders: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.templatePartial.findMany({
      where: { tenantId },
      select: { name: true, displayName: true, content: true, placeholders: true, updatedAt: true, deletedAt: true },
    }),
  ]);

  const activePartials = partials.filter((partial) => !partial.deletedAt);
  const activePartialNames = new Set(activePartials.map((partial) => partial.name));
  const allPartialsByName = new Map(partials.map((partial) => [partial.name, partial]));
  const templateHealth = templatesForHealth.map((template) => {
    const diagnostics = analyzeTemplateContent({
      content: template.content,
      placeholders: template.placeholders,
      partials: activePartials,
    });
    const inactivePartials = extractPartialReferences(template.content)
      .filter((partialName) => allPartialsByName.get(partialName)?.deletedAt);
    const stalePartialMetadata = findStalePartialMetadata(template.placeholders, template.content, activePartials);
    const missingPartials = diagnostics.missingPartials.filter((partialName) => !activePartialNames.has(partialName));
    const requiredCustomFields = normalizeStoredPlaceholders(template.placeholders)
      .filter((placeholder) => (
        placeholder.required
        && !placeholder.sourcePartial
        && (placeholder.category === 'custom' || placeholder.key?.startsWith('custom.'))
      ))
      .map((placeholder) => ({
        key: (placeholder.key || '').replace(/^custom\./, ''),
        label: placeholder.label || (placeholder.key || '').replace(/^custom\./, ''),
      }))
      .filter((placeholder) => placeholder.key);

    return {
      id: template.id,
      name: template.name,
      isActive: template.isActive,
      missingPartials,
      inactivePartials,
      circularPartials: diagnostics.circularPartials,
      unknownPlaceholders: diagnostics.unknownPlaceholders,
      syntaxErrors: diagnostics.syntaxErrors,
      stalePartialMetadata,
      requiredCustomFields,
      lastSuccessfulTest: null,
      canGenerateCleanly:
        template.isActive
        && missingPartials.length === 0
        && inactivePartials.length === 0
        && diagnostics.circularPartials.length === 0
        && diagnostics.syntaxErrors.length === 0,
      canGenerateWithSampleData:
        missingPartials.length === 0
        && inactivePartials.length === 0
        && diagnostics.circularPartials.length === 0
        && diagnostics.syntaxErrors.length === 0
        && diagnostics.unknownPlaceholders.length === 0,
      dependencyCount: diagnostics.dependencies.filter((dependency) => dependency.found).length,
    };
  });

  return {
    total,
    active,
    byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count])),
    recentlyCreated,
    mostUsed: mostUsed.map((t) => ({ id: t.id, name: t.name, usageCount: t._count.generatedDocuments })),
    health: {
      activeTemplatesCanGenerateCleanly: templateHealth.filter((template) => template.isActive && template.canGenerateCleanly).length,
      activeTemplatesWithMissingPartials: templateHealth.filter((template) => template.isActive && template.missingPartials.length > 0).length,
      missingPartialReferences: templateHealth.flatMap((template) => template.missingPartials.map((partialName) => ({ templateId: template.id, templateName: template.name, partialName }))),
      inactivePartialReferences: templateHealth.flatMap((template) => template.inactivePartials.map((partialName) => ({ templateId: template.id, templateName: template.name, partialName }))),
      circularPartialReferences: templateHealth.flatMap((template) => template.circularPartials.map((cycle) => ({ templateId: template.id, templateName: template.name, cycle }))),
      unknownPlaceholders: templateHealth.flatMap((template) => template.unknownPlaceholders.map((key) => ({ templateId: template.id, templateName: template.name, key }))),
      syntaxErrors: templateHealth.flatMap((template) => template.syntaxErrors.map((message) => ({ templateId: template.id, templateName: template.name, message }))),
      stalePartialMetadata: templateHealth.flatMap((template) => template.stalePartialMetadata.map((item) => ({ templateId: template.id, templateName: template.name, partialName: item.partialName, key: item.key }))),
      requiredCustomFields: templateHealth.flatMap((template) => template.requiredCustomFields.map((field) => ({ templateId: template.id, templateName: template.name, key: field.key, label: field.label }))),
      templates: templateHealth,
    },
  };
}

function findStalePartialMetadata(
  templatePlaceholders: unknown,
  templateContent: string,
  activePartials: Array<{ name: string; placeholders: unknown }>,
): Array<{ partialName: string; key: string }> {
  const referencedPartials = new Set(extractPartialReferences(templateContent));
  const partialCustomKeys = new Map<string, Set<string>>();
  for (const partial of activePartials) {
    partialCustomKeys.set(
      partial.name,
      new Set(
        normalizeStoredPlaceholders(partial.placeholders)
          .filter((placeholder) => (
            placeholder.category === 'custom'
            || placeholder.source === 'custom'
            || placeholder.key?.startsWith('custom.')
          ))
          .map((placeholder) => normalizePlaceholderKey(placeholder.key))
          .filter(Boolean),
      ),
    );
  }

  return normalizeStoredPlaceholders(templatePlaceholders)
    .filter((placeholder): placeholder is StoredPlaceholderLike & { sourcePartial: string } => Boolean(placeholder.sourcePartial))
    .map((placeholder) => ({ partialName: placeholder.sourcePartial, key: normalizePlaceholderKey(placeholder.key) }))
    .filter((item) => {
      if (!referencedPartials.has(item.partialName)) return true;
      const currentKeys = partialCustomKeys.get(item.partialName);
      return !currentKeys || !currentKeys.has(item.key);
    });
}

export async function getTemplatesByCategory(
  tenantId: string,
  category: DocumentTemplateCategory,
  activeOnly = true,
): Promise<DocumentTemplate[]> {
  const templates = await prisma.documentTemplate.findMany({
    where: { tenantId, category, deletedAt: null, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: { name: 'asc' },
  });
  return templates;
}

/** Legacy helper retained for callers; F1 owns the editor/runtime parser grammar. */
export function extractPlaceholdersFromContent(content: string): string[] {
  const placeholders = new Set<string>();
  const simpleRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\}\}/g;
  let match;
  while ((match = simpleRegex.exec(content)) !== null) {
    if (!['if', 'each', 'unless', 'with', '/if', '/each', '/unless', '/with'].includes(match[1])) {
      placeholders.add(match[1]);
    }
  }
  const blockRegex = /\{\{#(each|with)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g;
  while ((match = blockRegex.exec(content)) !== null) placeholders.add(match[2]);
  return Array.from(placeholders);
}

export function validateTemplateContent(content: string): string[] {
  const errors: string[] = [];
  const openCount = (content.match(/\{\{/g) || []).length;
  const closeCount = (content.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) errors.push('Mismatched placeholder brackets: ensure all {{ have matching }}');
  const eachOpens = (content.match(/\{\{#each\s/g) || []).length;
  const eachCloses = (content.match(/\{\{\/each\}\}/g) || []).length;
  if (eachOpens !== eachCloses) errors.push(`Unclosed #each blocks: ${eachOpens} opens, ${eachCloses} closes`);
  const ifOpens = (content.match(/\{\{#if\s/g) || []).length;
  const ifCloses = (content.match(/\{\{\/if\}\}/g) || []).length;
  if (ifOpens !== ifCloses) errors.push(`Unclosed #if blocks: ${ifOpens} opens, ${ifCloses} closes`);
  return errors;
}

/**
 * Permanent deletion and restore of soft-deleted document templates and
 * partials, for the Recycle Bin (`/api/admin/purge`).
 *
 * Purging a template leaves the documents generated from it in place; the
 * database unlinks them (template_id is set to null). Purging is refused
 * while a record is still load-bearing:
 * - a template that a document generation batch item still uses;
 * - a partial that a service variant or service agreement uses as its
 *   Statement of Work.
 * Stored Word assets are content-addressed and may be shared, so they are
 * left in object storage.
 */

import { prisma } from '@/lib/prisma';
import { ConflictError, NotFoundError } from '@/lib/errors';

export async function permanentlyDeleteDocumentTemplate(
  id: string,
): Promise<{ id: string; name: string }> {
  const template = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: { not: null } },
    select: { id: true, name: true, _count: { select: { generationBatchItems: true } } },
  });
  if (!template) throw new NotFoundError('Deleted template not found');
  if (template._count.generationBatchItems > 0) {
    throw new ConflictError(
      `"${template.name}" is still used by a document generation batch. Delete the batch first.`,
    );
  }
  await prisma.documentTemplate.delete({ where: { id: template.id } });
  return { id: template.id, name: template.name };
}

export async function permanentlyDeleteTemplatePartial(
  id: string,
): Promise<{ id: string; name: string }> {
  const partial = await prisma.templatePartial.findFirst({
    where: { id, deletedAt: { not: null } },
    select: {
      id: true,
      name: true,
      _count: { select: { serviceVariants: true, serviceAgreementItems: true } },
    },
  });
  if (!partial) throw new NotFoundError('Deleted partial not found');
  if (partial._count.serviceVariants > 0 || partial._count.serviceAgreementItems > 0) {
    throw new ConflictError(
      `"${partial.name}" is the Statement of Work for a service or service agreement, so it cannot be removed.`,
    );
  }
  await prisma.templatePartial.delete({ where: { id: partial.id } });
  return { id: partial.id, name: partial.name };
}

/** Restores deleted partials. Partial names stay unique while deleted, so no name can clash. */
export async function restoreTemplatePartials(
  ids: string[],
): Promise<Array<{ id: string; name: string }>> {
  const partials = await prisma.templatePartial.findMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
    select: { id: true, name: true },
  });
  if (partials.length === 0) return [];
  await prisma.templatePartial.updateMany({
    where: { id: { in: partials.map((partial) => partial.id) }, deletedAt: { not: null } },
    data: { deletedAt: null, version: { increment: 1 } },
  });
  return partials;
}

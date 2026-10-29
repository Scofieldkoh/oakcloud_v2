import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/rbac';
import { previewContactIdentity } from '@/services/contact-identity.service';
import { contactDetailTypeEnum, contactPurposeEnum } from '@/lib/validations/contact-detail';
import { routeErrorResponse } from '@/lib/api-route-errors';

const candidateSchema = z.object({
  source: z.enum(['MANUAL', 'COMPANY_QUICK_CREATE', 'BIZFILE', 'DOCUMENT_VAULT']),
  sourceRecordId: z.string().trim().min(1).max(200),
  contactType: z.enum(['INDIVIDUAL', 'CORPORATE']),
  firstName: z.string().max(100).optional().nullable(),
  lastName: z.string().max(100).optional().nullable(),
  corporateName: z.string().max(200).optional().nullable(),
  alias: z.string().max(100).optional().nullable(),
  identificationType: z.enum(['NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER']).optional().nullable(),
  identificationNumber: z.string().max(50).optional().nullable(),
  corporateUen: z.string().max(50).optional().nullable(),
  nationality: z.string().max(100).optional().nullable(),
  dateOfBirth: z.string().max(50).optional().nullable(),
  fullAddress: z.string().max(500).optional().nullable(),
  contactDetails: z.array(z.object({
    detailType: contactDetailTypeEnum,
    value: z.string().trim().min(1).max(500),
    companyId: z.string().uuid().optional(),
    purposes: z.array(contactPurposeEnum).optional(),
    label: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    displayOrder: z.number().int().min(0).optional(),
    isPrimary: z.boolean().optional(),
    isPoc: z.boolean().optional(),
  })).max(100).optional(),
  confidence: z.object({
    identificationNumber: z.number().min(0).max(1).optional(),
    corporateUen: z.number().min(0).max(1).optional(),
    fullAddress: z.number().min(0).max(1).optional(),
    email: z.number().min(0).max(1).optional(),
    phone: z.number().min(0).max(1).optional(),
  }).optional(),
});

const batchSchema = z.object({
  candidates: z.array(candidateSchema).max(100),
  tenantId: z.string().uuid().optional(),
})
  .superRefine(({ candidates }, context) => {
    const paths = new Set<string>();
    candidates.forEach((candidate, index) => {
      if (paths.has(candidate.sourceRecordId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['candidates', index, 'sourceRecordId'],
          message: 'Source record paths must be unique',
        });
      }
      paths.add(candidate.sourceRecordId);
    });
  });

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'contact', 'read');
    const { candidates, tenantId: requestedTenantId } = batchSchema.parse(await request.json());
    const tenantId = session.isSuperAdmin && requestedTenantId
      ? requestedTenantId
      : session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }
    const previews = await Promise.all(candidates.map(async (candidate) => ({
      path: candidate.sourceRecordId,
      match: await previewContactIdentity(candidate, tenantId),
    })));
    const contactIds = [...new Set(previews.flatMap(({ match }) => match ? [match.contactId] : []))];
    const contacts = contactIds.length === 0 ? [] : await prisma.contact.findMany({
      where: { id: { in: contactIds }, tenantId, deletedAt: null, isActive: true },
      select: {
        id: true,
        fullName: true,
        identificationType: true,
        identificationNumber: true,
        corporateUen: true,
        companyRelations: {
          where: { deletedAt: null },
          select: { company: { select: { id: true, name: true, uen: true } } },
        },
      },
    });
    const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
    const matches = Object.fromEntries(previews.map(({ path, match }) => {
      if (!match) return [path, null];
      const contact = contactById.get(match.contactId);
      return [path, {
        ...match,
        contact: contact ? {
          id: contact.id,
          fullName: contact.fullName,
          identificationType: contact.identificationType,
          identificationNumber: contact.identificationNumber,
          corporateUen: contact.corporateUen,
          companies: contact.companyRelations.map((relation) => relation.company),
        } : null,
      }];
    }));
    return NextResponse.json({ matches });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid contact candidates', issues: error.issues }, { status: 400 });
    }
    return routeErrorResponse(error);
  }
}

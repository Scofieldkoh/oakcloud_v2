import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ContactMergeConflictError, mergeContacts } from '@/services/contact-merge.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

const contactId = z.string().uuid();
const mergeField = z.string().trim().nullable();
const mergeContactsSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  masterContactId: contactId,
  sourceContactIds: z.array(contactId).min(1),
  expectedUpdatedAt: z.record(contactId, z.string().datetime()),
  expectedFingerprints: z.record(contactId, z.string().regex(/^[a-f0-9]{64}$/i)),
  fieldDecisions: z.object({
    firstName: mergeField.optional(), lastName: mergeField.optional(), alias: mergeField.optional(),
    identificationType: z.enum(['NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER']).nullable().optional(),
    identificationNumber: mergeField.optional(), nationality: mergeField.optional(),
    dateOfBirth: z.string().date().nullable().optional(), corporateName: mergeField.optional(),
    corporateUen: mergeField.optional(), fullAddress: mergeField.optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const ids = [value.masterContactId, ...value.sourceContactIds];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Contact IDs must be distinct', path: ['sourceContactIds'] });
  for (const id of ids) {
    if (!value.expectedUpdatedAt[id]) context.addIssue({ code: 'custom', message: 'Missing updatedAt snapshot', path: ['expectedUpdatedAt', id] });
    if (!value.expectedFingerprints[id]) context.addIssue({ code: 'custom', message: 'Missing fingerprint', path: ['expectedFingerprints', id] });
  }
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'contact', 'update');
    if (!session.tenantId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    if (!session.hasAllCompaniesAccess && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const input = mergeContactsSchema.parse(await request.json());
    return NextResponse.json(await mergeContacts(input, { tenantId: session.tenantId, userId: session.id }));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid contact merge', ...(error instanceof ZodError ? { issues: error.issues } : {}) }, { status: 400 });
    }
    if (error instanceof ContactMergeConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    return routeErrorResponse(error);
  }
}

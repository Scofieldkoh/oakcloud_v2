import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { documentTemplateCompositionTypeEnum } from '@/lib/validations/document-template';
import { previewOakDocMaster } from '@/services/oakdoc-generation.service';

const contextSchema = z.object({
  templateId: z.string().uuid().optional(),
  compositionType: documentTemplateCompositionTypeEnum.optional(),
  refreshPartialPins: z.union([z.literal('all'), z.array(z.string().uuid())]).optional(),
  companyId: z.string().uuid(),
  selectedDirectorId: z.string().min(1).optional(),
  selectedShareholderId: z.string().min(1).optional(),
  selectedContactId: z.string().uuid().optional(),
  serviceAgreementId: z.string().uuid().optional(),
  resolutionDate: z.string().date().optional(),
});

function generatedByName(session: { firstName?: string | null; lastName?: string | null }) {
  return [session.firstName, session.lastName].filter(Boolean).join(' ') || undefined;
}

/**
 * POST /api/document-templates/oakdoc-preview
 * Preview the editor's current Word master with the production generation
 * pipeline (multipart: file, context JSON). Returns the resolved DOCX as
 * base64 plus diagnostics; nothing is saved.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const tenantId = requireSessionWorkspaceId(session);

    const formData = await request.formData();
    const file = formData.get('file');
    const rawContext = formData.get('context');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'DOCX file is required' }, { status: 400 });
    }
    if (typeof rawContext !== 'string') {
      return NextResponse.json({ error: 'Preview context is required' }, { status: 400 });
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContext);
    } catch {
      return NextResponse.json({ error: 'Preview context is invalid' }, { status: 400 });
    }
    const context = contextSchema.safeParse(parsedJson);
    if (!context.success) {
      return NextResponse.json({ error: 'Preview context is invalid' }, { status: 400 });
    }

    const result = await previewOakDocMaster({
      ...context.data,
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      generatedBy: generatedByName(session),
    }, { tenantId });
    return NextResponse.json({
      docxBase64: result.bytes.toString('base64'),
      diagnostics: result.diagnostics,
      fieldsUpdated: result.metadata.fieldsUpdated,
      unresolvedTags: result.metadata.unresolvedTags,
      conditionsResolved: result.metadata.conditionsResolved,
      repeatersResolved: result.metadata.repeatersResolved,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

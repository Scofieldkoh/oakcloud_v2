import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { renderTemplateForGeneration } from '@/services/document-generator.service';

// Validation schema for preview request
const previewSchema = z.object({
  draftId: z.string().uuid().optional(),
  templateId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  contactIds: z.array(z.string().uuid()).optional(),
  selectedDirectorId: z.string().uuid().optional(),
  selectedDirectorIds: z.array(z.string().uuid()).max(100).optional(),
  selectedShareholderId: z.string().uuid().optional(),
  selectedContactId: z.string().uuid().optional(),
  customData: z.record(z.unknown()).optional(),
  serviceAgreementId: z.string().uuid().optional(),
});

/**
 * POST /api/generated-documents/preview
 * Preview a document without saving
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check read permission (preview only requires read)
    await requirePermission(session, 'document', 'read');

    const body = await request.json();
    const data = previewSchema.parse(body);

    const tenantId = requireSessionWorkspaceId(session);
    const rendered = await renderTemplateForGeneration({
      templateId: data.templateId,
      tenantId,
      userId: session.id,
      companyId: data.companyId,
      contactIds: data.contactIds,
      selectedDirectorId: data.selectedDirectorId,
      selectedDirectorIds: data.selectedDirectorIds,
      selectedShareholderId: data.selectedShareholderId,
      selectedContactId: data.selectedContactId,
      customData: data.customData,
      generatedBy: `${session.firstName} ${session.lastName}`.trim(),
      mode: 'preview',
      serviceAgreementId: data.serviceAgreementId,
      generatedDocumentId: data.draftId,
    });

    return NextResponse.json({
      preview: {
        content: rendered.content,
        contentHtml: rendered.contentHtml,
        sections: rendered.sections,
        unresolvedPlaceholders: rendered.missingPlaceholders,
        missingPartials: rendered.missingPartials,
        blockingErrors: rendered.blockingErrors,
      },
      template: rendered.template,
      context: rendered.contextSummary,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return createErrorResponse(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { validateForGeneration } from '@/services/document-validation.service';

// Validation schema for validation request
const validateSchema = z.object({
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
 * POST /api/generated-documents/validate
 * Validate data before generating a document
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check read permission (validation only requires read)
    await requirePermission(session, 'document', 'read');

    const body = await request.json();
    const data = validateSchema.parse(body);

    const tenantId = requireSessionWorkspaceId(session);

    // Run validation
    const result = await validateForGeneration(tenantId, {
      templateId: data.templateId,
      companyId: data.companyId,
      contactIds: data.contactIds,
      selectedDirectorId: data.selectedDirectorId,
      selectedDirectorIds: data.selectedDirectorIds,
      selectedShareholderId: data.selectedShareholderId,
      selectedContactId: data.selectedContactId,
      customData: data.customData,
      draftId: data.draftId,
      serviceAgreementId: data.serviceAgreementId,
    }, [session.firstName, session.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' '), session.id);

    return NextResponse.json({
      isValid: result.isValid,
      errors: result.errors,
      warnings: result.warnings,
      summary: {
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        requiredPlaceholders: result.resolvedData.requiredPlaceholders.length,
        availablePlaceholders: result.resolvedData.availablePlaceholders.length,
        missingPlaceholders: result.resolvedData.missingPlaceholders.length,
      },
      resolvedData: {
        hasCompany: !!result.resolvedData.company,
        companyName: result.resolvedData.company?.name,
        directorCount: result.resolvedData.directors?.length || 0,
        shareholderCount: result.resolvedData.shareholders?.length || 0,
        hasSelectedDirector: !!result.resolvedData.selectedDirector,
        hasSelectedShareholder: !!result.resolvedData.selectedShareholder,
        hasSelectedContact: !!result.resolvedData.selectedContact,
        missingPlaceholders: result.resolvedData.missingPlaceholders,
      },
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

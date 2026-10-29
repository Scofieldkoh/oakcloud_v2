import { createBlankOakDocDocument } from '@/services/oakdoc-blank-document.service';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  createDocumentFromTemplateSchema,
  createBlankDocumentSchema,
  searchGeneratedDocumentsSchema,
} from '@/lib/validations/generated-document';
import {
  createDocumentFromTemplate,
  searchGeneratedDocuments,
} from '@/services/document-generator.service';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
  safelyLinkGeneratedDocumentTaskOutcome,
} from '@/services/tasks/integration.service';

/**
 * GET /api/generated-documents
 * List/search generated documents
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check read permission
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);

    const params = searchGeneratedDocumentsSchema.parse({
      query: searchParams.get('query') || undefined,
      title: searchParams.get('title') || undefined,
      companyId: searchParams.get('companyId') || undefined,
      companyName: searchParams.get('companyName') || undefined,
      templateId: searchParams.get('templateId') || undefined,
      templateName: searchParams.get('templateName') || undefined,
      createdBy: searchParams.get('createdBy') || undefined,
      signedFrom: searchParams.get('signedFrom') || undefined,
      signedTo: searchParams.get('signedTo') || undefined,
      updatedFrom: searchParams.get('updatedFrom') || undefined,
      updatedTo: searchParams.get('updatedTo') || undefined,
      status: searchParams.get('status') || undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
    });

    const tenantId = requireSessionWorkspaceId(session);
    const result = await searchGeneratedDocuments(params, tenantId);

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * POST /api/generated-documents
 * Create a new generated document (from template or blank)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check create permission
    await requirePermission(session, 'document', 'create');

    const body = await request.json();
    const {
      tenantId: _ignoredTenantId,
      type,
      taskContext: rawTaskContext,
      ...documentData
    } = body;
    const taskContext = parseTaskLaunchContext(rawTaskContext);
    const tenantId = requireSessionWorkspaceId(session);
    if (taskContext) {
      await preflightTaskLaunchContext(
        tenantId,
        taskContext,
        'DOCUMENT_GENERATION',
        session,
      );
    }

    let document;

    // Create from template or blank based on type
    if (type === 'blank' || !documentData.templateId) {
      const data = createBlankDocumentSchema.parse(documentData);
      const params = { tenantId, userId: session.id };
      document = await createBlankOakDocDocument(data, params, taskContext ?? undefined);
    } else {
      const data = createDocumentFromTemplateSchema.parse(documentData);
      const params = { tenantId, userId: session.id };
      document = taskContext
        ? await createDocumentFromTemplate(data, params, taskContext)
        : await createDocumentFromTemplate(data, params);
    }
    if (taskContext) {
      await safelyLinkGeneratedDocumentTaskOutcome({
        tenantId,
        context: taskContext,
        authoritativeId: document.id,
        userId: session.id,
        session,
      });
    }

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}

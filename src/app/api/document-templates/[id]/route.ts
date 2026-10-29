import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createErrorResponse } from '@/lib/api-helpers';
import {
  documentTemplateCategoryEnum,
  oakDocEditorCompositionTypeEnum,
  parsePlaceholdersFormField,
  updateDocumentTemplateSchema,
} from '@/lib/validations/document-template';
import {
  getDocumentTemplateById,
  updateDocumentTemplate,
  deleteDocumentTemplate,
  restoreDocumentTemplate,
} from '@/services/document-template.service';
import {
  downloadOakDocTemplate,
  updateOakDocTemplate,
} from '@/services/oakdoc-template.service';
import {
  linkOakDocMigration,
  runOakDocMigrationValidation,
  setOakDocMigrationPreference,
} from '@/services/oakdoc-migration.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function withRevision<T extends { version: number }>(value: T) {
  return { ...value, revision: value.version };
}

/** GET /api/document-templates/[id] */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get('tenantId');
    const effectiveTenantId =
      session.isSuperAdmin && tenantIdParam ? tenantIdParam : session.tenantId;

    if (!effectiveTenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    if (searchParams.get('format') === 'docx') {
      const { buffer, metadata } = await downloadOakDocTemplate(id, effectiveTenantId);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': metadata.mimeType,
          'Content-Length': String(buffer.byteLength),
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const includeDeleted = searchParams.get('includeDeleted') === 'true' && session.isWorkspaceAdmin;
    const template = await getDocumentTemplateById(id, effectiveTenantId, { includeDeleted });

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json(withRevision(template));
  } catch (error) {
    return createErrorResponse(error);
  }
}

/** PUT /api/document-templates/[id] */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'update');

    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'DOCX file is required' }, { status: 400 });
      }

      const tenantIdFromForm = formData.get('tenantId');
      let tenantId = session.tenantId;
      if (session.isSuperAdmin) {
        if (typeof tenantIdFromForm === 'string' && tenantIdFromForm) {
          tenantId = tenantIdFromForm;
        } else {
          const existingTemplate = await prisma.documentTemplate.findFirst({
            where: { id, deletedAt: null },
            select: { tenantId: true },
          });
          if (!existingTemplate) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
          }
          tenantId = existingTemplate.tenantId;
        }
      }
      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      const expectedRevisionRaw = formData.get('expectedRevision');
      const expectedRevision = typeof expectedRevisionRaw === 'string'
        ? Number(expectedRevisionRaw)
        : Number.NaN;
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        return NextResponse.json(
          { error: 'A valid expectedRevision is required to save an OakDoc template' },
          { status: 400 },
        );
      }

      const categoryValue = formData.get('category');
      const categoryResult = categoryValue === null
        ? null
        : documentTemplateCategoryEnum.safeParse(categoryValue);
      if (categoryResult && !categoryResult.success) {
        return NextResponse.json({ error: 'Invalid template category' }, { status: 400 });
      }

      const compositionValue = formData.get('compositionType');
      const compositionResult = compositionValue === null
        ? null
        : oakDocEditorCompositionTypeEnum.safeParse(compositionValue);
      if (compositionResult && !compositionResult.success) {
        return NextResponse.json({ error: 'Invalid template type' }, { status: 400 });
      }

      const nameValue = formData.get('name');
      const descriptionValue = formData.get('description');
      const isActiveValue = formData.get('isActive');
      const template = await updateOakDocTemplate({
        id,
        expectedRevision,
        name: typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : undefined,
        description: typeof descriptionValue === 'string'
          ? (descriptionValue.trim() || null)
          : undefined,
        category: categoryResult?.success ? categoryResult.data : undefined,
        compositionType: compositionResult?.success ? compositionResult.data : undefined,
        isActive: typeof isActiveValue === 'string' ? isActiveValue !== 'false' : undefined,
        fileName: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
        refreshPartialPins: formData.get('refreshPartialPins') === 'all' ? 'all' : undefined,
        placeholders: parsePlaceholdersFormField(formData.get('placeholders')),
      }, { tenantId, userId: session.id });

      return NextResponse.json(withRevision(template));
    }

    const body = await request.json();
    const data = updateDocumentTemplateSchema.parse({ ...body, id });

    let tenantId = session.tenantId;
    if (session.isSuperAdmin) {
      if (body.tenantId) {
        tenantId = body.tenantId;
      } else {
        const existingTemplate = await prisma.documentTemplate.findFirst({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingTemplate) {
          return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
        tenantId = existingTemplate.tenantId;
      }
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const template = await updateDocumentTemplate(
      data,
      { tenantId, userId: session.id },
      body.reason,
    );

    return NextResponse.json(withRevision(template));
  } catch (error) {
    return createErrorResponse(error);
  }
}

/** DELETE /api/document-templates/[id] */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'delete');

    const { searchParams } = new URL(request.url);
    const reason = searchParams.get('reason');
    const expectedRevisionValue = searchParams.get('expectedRevision');
    const expectedRevision = expectedRevisionValue === null
      ? undefined
      : Number(expectedRevisionValue);

    if (!reason) {
      return NextResponse.json({ error: 'Reason is required for deletion' }, { status: 400 });
    }
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      return NextResponse.json({ error: 'expectedRevision must be a non-negative integer' }, { status: 400 });
    }

    const tenantIdParam = searchParams.get('tenantId');
    let tenantId = session.tenantId;
    if (session.isSuperAdmin) {
      if (tenantIdParam) {
        tenantId = tenantIdParam;
      } else {
        const existingTemplate = await prisma.documentTemplate.findFirst({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingTemplate) {
          return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
        tenantId = existingTemplate.tenantId;
      }
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const template = await deleteDocumentTemplate(
      id,
      { tenantId, userId: session.id },
      reason,
      expectedRevision,
    );

    return NextResponse.json(withRevision(template));
  } catch (error) {
    return createErrorResponse(error);
  }
}

/** PATCH /api/document-templates/[id] */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'update');

    const body = await request.json();
    const expectedRevision = body.expectedRevision;
    if (
      expectedRevision !== undefined
      && (!Number.isInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return NextResponse.json(
        { error: 'expectedRevision must be a non-negative integer' },
        { status: 400 },
      );
    }

    let tenantId = session.tenantId;
    if (session.isSuperAdmin) {
      if (body.tenantId) {
        tenantId = body.tenantId;
      } else {
        const existingTemplate = await prisma.documentTemplate.findFirst({
          where: { id },
          select: { tenantId: true },
        });
        if (!existingTemplate) {
          return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
        tenantId = existingTemplate.tenantId;
      }
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    if (body.action === 'restore') {
      const template = await restoreDocumentTemplate(
        id,
        { tenantId, userId: session.id },
        expectedRevision,
      );
      return NextResponse.json(withRevision(template));
    }

    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return NextResponse.json(
        { error: 'expectedRevision is required for migration control changes' },
        { status: 400 },
      );
    }

    if (body.action === 'linkOakDocMigration') {
      if (typeof body.legacyTemplateId !== 'string' || !body.legacyTemplateId.trim()) {
        return NextResponse.json({ error: 'legacyTemplateId is required' }, { status: 400 });
      }
      if (typeof body.reason !== 'string' || !body.reason.trim()) {
        return NextResponse.json({ error: 'reason is required' }, { status: 400 });
      }
      const template = await linkOakDocMigration({
        oakDocTemplateId: id,
        legacyTemplateId: body.legacyTemplateId,
        expectedRevision,
        reason: body.reason,
      }, { tenantId, userId: session.id });
      return NextResponse.json(withRevision(template));
    }

    if (body.action === 'recordOakDocMigrationValidation') {
      // Parity results are produced by the server checker, never submitted.
      return NextResponse.json(
        {
          error: 'Migration results can no longer be submitted. Use runOakDocMigrationValidation to run the server check.',
          code: 'VALIDATION_ERROR',
          details: { reason: 'OAKDOC_CALLER_VALIDATION_REJECTED' },
        },
        { status: 400 },
      );
    }

    if (body.action === 'runOakDocMigrationValidation') {
      const { template, validation } = await runOakDocMigrationValidation({
        oakDocTemplateId: id,
        expectedRevision,
      }, { tenantId, userId: session.id });
      return NextResponse.json({ ...withRevision(template), migrationValidation: validation });
    }

    if (body.action === 'setOakDocMigrationPreference') {
      if (body.preference !== 'LEGACY' && body.preference !== 'OAKDOC') {
        return NextResponse.json(
          { error: 'preference must be LEGACY or OAKDOC' },
          { status: 400 },
        );
      }
      if (typeof body.reason !== 'string' || !body.reason.trim()) {
        return NextResponse.json({ error: 'reason is required' }, { status: 400 });
      }
      const template = await setOakDocMigrationPreference({
        oakDocTemplateId: id,
        expectedRevision,
        preference: body.preference,
        reason: body.reason,
      }, { tenantId, userId: session.id });
      return NextResponse.json(withRevision(template));
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return createErrorResponse(error);
  }
}

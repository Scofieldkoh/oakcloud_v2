import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse } from '@/lib/api-helpers';
import {
  createDocumentTemplateSchema,
  documentTemplateCategoryEnum,
  oakDocEditorCompositionTypeEnum,
  parsePlaceholdersFormField,
  searchDocumentTemplatesSchema,
} from '@/lib/validations/document-template';
import {
  createDocumentTemplate,
  searchDocumentTemplates,
} from '@/services/document-template.service';
import { createOakDocTemplate } from '@/services/oakdoc-template.service';
import { getOakDocMigrationInventory } from '@/services/oakdoc-migration.service';

function withRevision<T extends { version: number }>(value: T) {
  return { ...value, revision: value.version };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const params = searchDocumentTemplatesSchema.parse({
      query: searchParams.get('query') || undefined,
      category: searchParams.get('category') || undefined,
      isActive: searchParams.get('isActive')
        ? searchParams.get('isActive') === 'true'
        : undefined,
      editor: searchParams.get('editor') || undefined,
      name: searchParams.get('name') || undefined,
      description: searchParams.get('description') || undefined,
      usage: searchParams.get('usage') || undefined,
      version: searchParams.get('version') ? Number(searchParams.get('version')) : undefined,
      createdBy: searchParams.get('createdBy') || undefined,
      updatedFrom: searchParams.get('updatedFrom') || undefined,
      updatedTo: searchParams.get('updatedTo') || undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
    });

    const tenantIdParam = searchParams.get('tenantId');
    const effectiveTenantId =
      session.isSuperAdmin && tenantIdParam ? tenantIdParam : session.tenantId;

    if (!effectiveTenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    if (searchParams.get('migrationInventory') === 'true') {
      const inventory = await getOakDocMigrationInventory(effectiveTenantId);
      return NextResponse.json({ inventory });
    }

    const result = await searchDocumentTemplates(params, effectiveTenantId);
    return NextResponse.json({
      ...result,
      templates: result.templates.map(withRevision),
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');

    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'DOCX file is required' }, { status: 400 });
      }

      const tenantIdFromForm = formData.get('tenantId');
      let tenantId = session.tenantId;
      if (session.isSuperAdmin && typeof tenantIdFromForm === 'string' && tenantIdFromForm) {
        tenantId = tenantIdFromForm;
      }
      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      const nameValue = formData.get('name');
      const name = typeof nameValue === 'string' ? nameValue.trim() : '';
      if (!name) {
        return NextResponse.json({ error: 'Template name is required' }, { status: 400 });
      }

      const categoryValue = formData.get('category');
      const categoryResult = documentTemplateCategoryEnum.safeParse(
        typeof categoryValue === 'string' && categoryValue ? categoryValue : 'OTHER',
      );
      if (!categoryResult.success) {
        return NextResponse.json({ error: 'Invalid template category' }, { status: 400 });
      }

      const compositionValue = formData.get('compositionType');
      const compositionResult = compositionValue === null
        ? null
        : oakDocEditorCompositionTypeEnum.safeParse(compositionValue);
      if (compositionResult && !compositionResult.success) {
        return NextResponse.json({ error: 'Invalid template type' }, { status: 400 });
      }

      const descriptionValue = formData.get('description');
      const isActiveValue = formData.get('isActive');
      const buffer = Buffer.from(await file.arrayBuffer());
      const template = await createOakDocTemplate({
        name,
        description: typeof descriptionValue === 'string' && descriptionValue.trim()
          ? descriptionValue.trim()
          : null,
        category: categoryResult.data,
        isActive: isActiveValue !== 'false',
        compositionType: compositionResult?.success ? compositionResult.data : undefined,
        fileName: file.name,
        buffer,
        placeholders: parsePlaceholdersFormField(formData.get('placeholders')),
      }, { tenantId, userId: session.id });

      return NextResponse.json(withRevision(template), { status: 201 });
    }

    const body = await request.json();
    const { tenantId: bodyTenantId, ...templateData } = body;
    const data = createDocumentTemplateSchema.parse(templateData);

    let tenantId = session.tenantId;
    if (session.isSuperAdmin && bodyTenantId) tenantId = bodyTenantId;

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const template = await createDocumentTemplate(data, { tenantId, userId: session.id });
    return NextResponse.json(withRevision(template), { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}

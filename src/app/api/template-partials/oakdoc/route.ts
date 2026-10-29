import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { createOakDocPartial } from '@/services/oakdoc-partial.service';
import { templatePartialCategoryEnum } from '@/lib/validations/template-partial';

function optionalText(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * POST /api/template-partials/oakdoc
 * Create a Word partial from an uploaded DOCX (multipart: file, name,
 * displayName?, header?, description?).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');
    const tenantId = requireSessionWorkspaceId(session);

    const formData = await request.formData();
    const file = formData.get('file');
    const name = optionalText(formData.get('name'));
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'DOCX file is required' }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: 'Partial name is required' }, { status: 400 });

    const partial = await createOakDocPartial({
      id: randomUUID(),
      name,
      displayName: optionalText(formData.get('displayName')),
      header: optionalText(formData.get('header')),
      description: optionalText(formData.get('description')),
      category: templatePartialCategoryEnum.optional().parse(optionalText(formData.get('category')) ?? undefined),
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    }, { tenantId, userId: session.id });
    return NextResponse.json({ ...partial, revision: partial.version }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}

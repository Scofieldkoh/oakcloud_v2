import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import { parsePresetCsv } from '@/lib/form-option-preset-csv';
import { requirePermission } from '@/lib/rbac';
import { updateFormOptionPresetSchema } from '@/lib/validations/form-option-preset';
import {
  deleteFormOptionPreset,
  replaceFormOptionPreset,
} from '@/services/form-option-preset.service';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const body = await request.json();
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const input = updateFormOptionPresetSchema.parse(body);

    const parsedCsv = input.csv === undefined ? undefined : parsePresetCsv(input.csv);
    if (parsedCsv && parsedCsv.errors.length > 0) {
      return NextResponse.json({
        error: 'Invalid CSV',
        detectedColumns: parsedCsv.detectedColumns,
        totalRows: parsedCsv.totalRows,
        validRows: parsedCsv.options.length,
        rejectedRows: parsedCsv.rejectedRows,
        errors: parsedCsv.errors,
        sample: parsedCsv.options.slice(0, 5),
      }, { status: 400 });
    }

    const preset = await replaceFormOptionPreset(id, {
      tenantId,
      userId: session.id,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(parsedCsv ? { options: parsedCsv.options } : {}),
    });
    return NextResponse.json(preset);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const tenantId = resolveWorkspaceId(session, new URL(request.url).searchParams.get('tenantId'));
    return NextResponse.json(await deleteFormOptionPreset(id, { tenantId, userId: session.id }));
  } catch (error) {
    return createErrorResponse(error);
  }
}

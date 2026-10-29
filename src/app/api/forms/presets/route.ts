import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import { parsePresetCsv, type PresetCsvResult } from '@/lib/form-option-preset-csv';
import { requirePermission } from '@/lib/rbac';
import {
  createFormOptionPresetSchema,
  previewFormOptionPresetSchema,
} from '@/lib/validations/form-option-preset';
import {
  createFormOptionPreset,
  listFormOptionPresets,
} from '@/services/form-option-preset.service';

function csvSummary(result: PresetCsvResult) {
  return {
    detectedColumns: result.detectedColumns,
    totalRows: result.totalRows,
    validRows: result.options.length,
    rejectedRows: result.rejectedRows,
    errors: result.errors,
    sample: result.options.slice(0, 5),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const tenantId = resolveWorkspaceId(session, new URL(request.url).searchParams.get('tenantId'));
    return NextResponse.json(await listFormOptionPresets(tenantId, session.id));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const body = await request.json();
    const tenantId = resolveWorkspaceId(session, body.tenantId);

    if (body.preview === true) {
      const preview = previewFormOptionPresetSchema.parse(body);
      return NextResponse.json(csvSummary(parsePresetCsv(preview.csv)));
    }

    const input = createFormOptionPresetSchema.parse(body);
    const parsedCsv = parsePresetCsv(input.csv);
    if (parsedCsv.errors.length > 0) {
      return NextResponse.json({ error: 'Invalid CSV', ...csvSummary(parsedCsv) }, { status: 400 });
    }

    const preset = await createFormOptionPreset({
      tenantId,
      userId: session.id,
      name: input.name,
      options: parsedCsv.options,
    });
    return NextResponse.json(preset, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}

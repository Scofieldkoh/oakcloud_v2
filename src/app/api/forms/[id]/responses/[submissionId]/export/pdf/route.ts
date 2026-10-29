import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse, buildContentDispositionHeader } from "@/lib/api-helpers";
import { exportFormResponsePdf } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{
    id: string;
    submissionId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, submissionId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const { buffer, fileName } = await exportFormResponsePdf(id, submissionId, tenantId);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildContentDispositionHeader("attachment", fileName),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

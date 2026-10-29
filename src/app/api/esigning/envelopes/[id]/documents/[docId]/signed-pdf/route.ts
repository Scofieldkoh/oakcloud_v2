import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  buildContentDispositionHeader,
  createErrorResponse,
  resolveWorkspaceId,
} from '@/lib/api-helpers';
import { getEsigningEnvelopeDetail } from '@/services/esigning-envelope.service';
import { downloadEsigningDocumentPackage } from '@/services/esigning-pdf.service';

interface RouteParams {
  params: Promise<{ id: string; docId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, docId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const detail = await getEsigningEnvelopeDetail(session, tenantId, id);
    const document = detail.documents.find((entry) => entry.id === docId);

    if (!document) {
      throw new Error('Document not found');
    }

    const includeCertificate = searchParams.get('includeCertificate') === 'true';
    const result = await downloadEsigningDocumentPackage({
      tenantId,
      envelopeId: id,
      documentId: docId,
      variant: includeCertificate ? 'signed_with_certificate' : 'signed',
    });
    const disposition = searchParams.get('download') === 'true' ? 'attachment' : 'inline';

    return new Response(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildContentDispositionHeader(disposition, result.fileName),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

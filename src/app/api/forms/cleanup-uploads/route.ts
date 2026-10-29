import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { cleanupExpiredFormDrafts, cleanupOrphanedUploads } from '@/services/form-builder.service';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const maxAgeHours = typeof body?.maxAgeHours === 'number' ? body.maxAgeHours : 24;

    const [deletedUploads, deletedDrafts] = await Promise.all([
      cleanupOrphanedUploads(maxAgeHours),
      cleanupExpiredFormDrafts(),
    ]);

    return NextResponse.json({
      deleted: deletedUploads,
      deletedUploads,
      deletedDrafts,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

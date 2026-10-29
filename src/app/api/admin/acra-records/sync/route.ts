/**
 * ACRA Records Sync Trigger (admin)
 *
 * POST /api/admin/acra-records/sync - Manually trigger a forced re-download
 * and re-import of the ACRA datasets. The sync runs in the background after
 * the response is sent; check `syncState` on the listing endpoint for
 * progress (lastStartedAt / lastCompletedAt).
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth, isAdmin } from '@/lib/auth';
import logger from '@/lib/logger';

export async function POST(_request: NextRequest) {
  try {
    const session = await requireAuth();

    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Run the (long) sync after the response has been sent so the request
    // does not block on the download/import.
    after(async () => {
      try {
        const { syncAcraDataIfUpdated } = await import('@/services/acra-sync.service');
        const result = await syncAcraDataIfUpdated({ force: true });
        logger.info('Manual ACRA sync finished', { result });
      } catch (error) {
        logger.error('Manual ACRA sync crashed', { error });
      }
    });

    return NextResponse.json({
      message: 'ACRA sync started. The dataset will be re-downloaded and imported in the background.',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

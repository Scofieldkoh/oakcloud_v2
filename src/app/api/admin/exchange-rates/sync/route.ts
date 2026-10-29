/**
 * Exchange Rate Sync API Route
 *
 * POST /api/admin/exchange-rates/sync - Trigger manual sync
 *
 * Body: {
 *   source: 'MAS_DAILY' | 'MAS_MONTHLY'
 *   startDate?: string (for MAS daily date range sync)
 *   endDate?: string (for MAS daily date range sync)
 *   month?: string (for MAS monthly specific month, e.g., "2024-11")
 * }
 *
 * Access: SUPER_ADMIN only
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import * as exchangeRateService from '@/services/exchange-rate.service';
import { exchangeRateSyncSchema } from '@/lib/validations/exchange-rate';
import { ZodError } from 'zod';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only SUPER_ADMIN can trigger sync
    if (!session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only super admins can trigger exchange rate sync' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));

    // Default to MAS_DAILY if no source specified (backward compatibility)
    if (!body.source) {
      body.source = 'MAS_DAILY';
    }

    const data = exchangeRateSyncSchema.parse(body);
    let result: exchangeRateService.SyncResult;

    if (data.source === 'MAS_MONTHLY') {
      // Sync MAS monthly rates
      result = await exchangeRateService.syncMASMonthly(data.month);
    } else if (data.startDate && data.endDate) {
      // Sync MAS daily rates for date range
      result = await exchangeRateService.syncMASDateRange(data.startDate, data.endDate);
    } else {
      // Sync latest MAS daily rates
      result = await exchangeRateService.syncFromMAS();
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to sync exchange rates:', error);
    return createErrorResponse(error);
  }
}

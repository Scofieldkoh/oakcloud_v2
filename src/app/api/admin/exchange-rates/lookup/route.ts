/**
 * Exchange Rate Lookup API Route
 *
 * GET /api/admin/exchange-rates/lookup - Look up rate for currency/date
 *
 * This endpoint is used by the document processing module to get exchange rates
 * for converting amounts to home currency.
 *
 * Query Parameters:
 * - currency: Source currency code (e.g., USD, EUR)
 * - date: Rate date (YYYY-MM-DD)
 * - tenantId: Optional tenant ID for tenant-specific overrides
 *
 * Access: Authenticated users (rate lookup is needed for document processing)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import * as exchangeRateService from '@/services/exchange-rate.service';
import { rateLookupSchema } from '@/lib/validations/exchange-rate';
import { ZodError } from 'zod';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const params = rateLookupSchema.parse({
      currency: searchParams.get('currency'),
      date: searchParams.get('date'),
      tenantId: searchParams.get('tenantId') || undefined,
    });

    // Non-super admin can only look up rates for their tenant
    const tenantId = session.isSuperAdmin
      ? params.tenantId || session.tenantId
      : session.tenantId;

    const result = await exchangeRateService.getRate(
      params.currency,
      'SGD',
      params.date,
      tenantId
    );

    if (!result) {
      return NextResponse.json(
        { error: 'No exchange rate found for the specified currency and date' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      currency: params.currency,
      targetCurrency: 'SGD',
      rate: result.rate.toString(),
      inverseRate: result.inverseRate.toString(),
      source: result.source,
      rateDate: result.rateDate.toISOString(),
      rateType: result.rateType,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to lookup exchange rate:', error);
    return createErrorResponse(error);
  }
}

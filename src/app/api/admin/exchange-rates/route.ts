/**
 * Exchange Rates API Routes
 *
 * GET  /api/admin/exchange-rates - List exchange rates with filters
 * POST /api/admin/exchange-rates - Create a manual rate override
 *
 * Access: SUPER_ADMIN (all rates), TENANT_ADMIN (tenant rates + system read)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import * as exchangeRateService from '@/services/exchange-rate.service';
import { rateSearchSchema, createManualRateSchema } from '@/lib/validations/exchange-rate';
import { ZodError } from 'zod';

// ============================================================================
// GET - List exchange rates
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can access
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const params = rateSearchSchema.parse({
      tenantId: searchParams.get('tenantId') || undefined,
      sourceCurrency: searchParams.get('sourceCurrency') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      source: searchParams.get('source') || 'ALL',
      includeSystem: searchParams.get('includeSystem') !== 'false',
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 50,
      sortBy: searchParams.get('sortBy') || 'rateDate',
      sortOrder: searchParams.get('sortOrder') || 'desc',
    });

    // Get rates with tenant context
    const result = await exchangeRateService.searchRates(params, {
      tenantId: session.tenantId ?? undefined,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to list exchange rates:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// POST - Create manual rate
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can create rates
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();

    // If not super admin, force tenant ID to their tenant
    if (!session.isSuperAdmin) {
      body.tenantId = session.tenantId;
    }

    const data = createManualRateSchema.parse(body);

    const rate = await exchangeRateService.createManualRate(data, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json(rate, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to create exchange rate:', error);
    return createErrorResponse(error);
  }
}

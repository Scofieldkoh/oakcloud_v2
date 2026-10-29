/**
 * Exchange Rate by ID API Routes
 *
 * GET    /api/admin/exchange-rates/[id] - Get rate by ID
 * PATCH  /api/admin/exchange-rates/[id] - Update manual rate
 * DELETE /api/admin/exchange-rates/[id] - Delete rate
 *
 * Access: SUPER_ADMIN (all rates), TENANT_ADMIN (tenant rates only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import * as exchangeRateService from '@/services/exchange-rate.service';
import { updateRateSchema } from '@/lib/validations/exchange-rate';
import { ZodError } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================================
// GET - Get rate by ID
// ============================================================================

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    const rate = await exchangeRateService.getRateById(id, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    if (!rate) {
      return NextResponse.json({ error: 'Rate not found' }, { status: 404 });
    }

    return NextResponse.json(rate);
  } catch (error) {
    console.error('Failed to get exchange rate:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// PATCH - Update rate
// ============================================================================

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const data = updateRateSchema.parse(body);

    const rate = await exchangeRateService.updateRate(id, data, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json(rate);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to update exchange rate:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// DELETE - Delete rate
// ============================================================================

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    // Get reason from query params or body
    const { searchParams } = new URL(request.url);
    let reason = searchParams.get('reason');

    if (!reason) {
      try {
        const body = await request.json();
        reason = body.reason;
      } catch {
        // No body provided
      }
    }

    if (!reason || reason.length < 5) {
      return NextResponse.json(
        { error: 'Reason is required (min 5 characters)' },
        { status: 400 }
      );
    }

    await exchangeRateService.deleteRate(id, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    }, reason);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete exchange rate:', error);
    return createErrorResponse(error);
  }
}

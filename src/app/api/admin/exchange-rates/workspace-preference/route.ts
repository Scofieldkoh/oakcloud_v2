/**
 * Workspace Exchange Rate Preference API Route
 *
 * GET  /api/admin/exchange-rates/workspace-preference - Get current workspace's rate preference
 * PATCH /api/admin/exchange-rates/workspace-preference - Update rate preference
 *
 * Query params:
 *   workspaceId - Optional workspace ID (SUPER_ADMIN only)
 *
 * Access: workspace admin or SUPER_ADMIN
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import * as exchangeRateService from '@/services/exchange-rate.service';
import { workspaceRatePreferenceSchema } from '@/lib/validations/exchange-rate';
import { ZodError } from 'zod';
import { z } from 'zod';

// Extended schema that allows workspaceId for SUPER_ADMINs.
// tenantId is accepted as a legacy input alias during the migration.
const updatePreferenceSchema = workspaceRatePreferenceSchema.extend({
  workspaceId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
});

// ============================================================================
// GET - Get workspace rate preference
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Must be admin
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get workspaceId from query params (for SUPER_ADMIN) or session
    const { searchParams } = new URL(request.url);
    const queryWorkspaceId = searchParams.get('workspaceId') ?? searchParams.get('tenantId');

    // Determine the target workspace
    let targetWorkspaceId: string | null = null;

    if (queryWorkspaceId && session.isSuperAdmin) {
      targetWorkspaceId = queryWorkspaceId;
    } else if (session.tenantId) {
      targetWorkspaceId = session.tenantId;
    }

    if (!targetWorkspaceId) {
      return NextResponse.json(
        { error: 'Workspace context required.' },
        { status: 400 }
      );
    }

    const preference = await exchangeRateService.getWorkspaceRatePreference(targetWorkspaceId);

    return NextResponse.json({
      preferredRateType: preference,
    });
  } catch (error) {
    console.error('Failed to get workspace rate preference:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// PATCH - Update workspace rate preference
// ============================================================================

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only workspace admins or SUPER_ADMIN can update preferences
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json(
        { error: 'Only workspace admins can update rate preferences' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const data = updatePreferenceSchema.parse(body);

    // Determine the target workspace
    let targetWorkspaceId: string | null = null;
    const requestedWorkspaceId = data.workspaceId ?? data.tenantId;

    if (requestedWorkspaceId && session.isSuperAdmin) {
      targetWorkspaceId = requestedWorkspaceId;
    } else if (session.tenantId) {
      targetWorkspaceId = session.tenantId;
    }

    if (!targetWorkspaceId) {
      return NextResponse.json(
        { error: 'Workspace context required.' },
        { status: 400 }
      );
    }

    await exchangeRateService.updateWorkspaceRatePreference(
      targetWorkspaceId,
      data.preferredRateType
    );

    return NextResponse.json({
      success: true,
      preferredRateType: data.preferredRateType,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to update workspace rate preference:', error);
    return createErrorResponse(error);
  }
}

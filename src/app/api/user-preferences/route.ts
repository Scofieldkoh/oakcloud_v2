/**
 * User Preferences API
 *
 * GET /api/user-preferences?key=...  - Get a single preference value
 * GET /api/user-preferences?keys=a,b - Get multiple preference values
 * PUT /api/user-preferences         - Upsert a preference value
 *
 * Preferences are per-user and are intended for UI persistence (e.g., table column widths).
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@/generated/prisma';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserPreferenceMap } from '@/lib/api/preferences';
import { handleApiError } from '@/lib/api-error-handler';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const keysParam = searchParams.get('keys');

    if (keysParam) {
      const keys = Array.from(
        new Set(
          keysParam
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ).slice(0, 50);

      if (keys.length === 0) {
        return jsonError(400, 'VALIDATION_ERROR', 'keys must include at least one key');
      }

      return NextResponse.json({
        success: true,
        data: await getUserPreferenceMap(session.id, keys),
        meta: { requestId: uuidv4(), timestamp: new Date().toISOString() },
      });
    }

    if (!key) {
      return jsonError(400, 'VALIDATION_ERROR', 'key is required');
    }

    const pref = await prisma.userPreference.findUnique({
      where: { userId_key: { userId: session.id, key } },
      select: { key: true, value: true, updatedAt: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        key,
        value: pref?.value ?? null,
        updatedAt: pref?.updatedAt?.toISOString() ?? null,
      },
      meta: { requestId: uuidv4(), timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('User preferences GET error:', error);
    return handleApiError(error, 'user-preferences');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => null) as { key?: unknown; value?: unknown } | null;

    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!key) {
      return jsonError(400, 'VALIDATION_ERROR', 'key is required');
    }

    // `value` is stored as JSON. We intentionally allow any JSON-serializable structure.
    const value = body?.value ?? {};

    const pref = await prisma.userPreference.upsert({
      where: { userId_key: { userId: session.id, key } },
      create: { userId: session.id, key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
      select: { key: true, value: true, updatedAt: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        key: pref.key,
        value: pref.value,
        updatedAt: pref.updatedAt.toISOString(),
      },
      meta: { requestId: uuidv4(), timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('User preferences PUT error:', error);
    return handleApiError(error, 'user-preferences');
  }
}

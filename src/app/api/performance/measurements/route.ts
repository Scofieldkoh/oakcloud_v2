import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';

const measurementSchema = z.object({
  route: z.string().min(1).max(300),
  metricType: z.enum([
    'startup_request_count',
    'response_payload_kb',
    'server_timing_ms',
    'database_timing_ms',
    'first_load_js_kb',
  ]),
  value: z.number().nonnegative(),
  unit: z.enum(['count', 'kb', 'ms']),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = measurementSchema.parse(await request.json());

    const measurement = await prisma.performanceMeasurement.create({
      data: {
        route: payload.route,
        metricType: payload.metricType,
        value: new Prisma.Decimal(payload.value),
        unit: payload.unit,
        metadata: payload.metadata as Prisma.InputJsonValue | undefined,
        userAgent: request.headers.get('user-agent'),
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ success: true, data: measurement }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid measurement', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

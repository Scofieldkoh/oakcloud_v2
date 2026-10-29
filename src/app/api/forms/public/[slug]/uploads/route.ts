import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { publicUploadSchema } from '@/lib/validations/form-builder';
import { createPublicUpload } from '@/services/form-builder.service';
import { createErrorResponse } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { slug } = await params;

    const ip = getClientIp(request);
    const rl = checkRateLimit(getRateLimitKey('form-upload', `${ip}:${slug}`), RATE_LIMIT_CONFIGS.FORM_UPLOAD);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const formData = await request.formData();

    const fileValue = formData.get('file');
    const fieldKeyValue = formData.get('fieldKey');

    if (!fileValue || !(fileValue instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const parsed = publicUploadSchema.parse({
      fieldKey: typeof fieldKeyValue === 'string' ? fieldKeyValue : '',
    });

    const upload = await createPublicUpload(slug, parsed.fieldKey, fileValue);

    return NextResponse.json(
      {
        id: upload.id,
        fieldId: upload.fieldId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid upload payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}

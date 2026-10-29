import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createErrorResponse } from '@/lib/api-helpers';
import { ErrorCodes } from '@/lib/errors';
import { DuplicateClientServiceError } from '@/services/client-service';

export function createManualClientServiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.');
      if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
    }
    return NextResponse.json({
      error: 'The service could not be created.',
      code: ErrorCodes.VALIDATION_ERROR,
      details: { fieldErrors },
    }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({
      error: 'The service could not be created.',
      code: ErrorCodes.VALIDATION_ERROR,
      details: { fieldErrors: { body: 'Enter a valid JSON object.' } },
    }, { status: 400 });
  }
  if (error instanceof DuplicateClientServiceError) {
    return NextResponse.json({
      error: error.message,
      code: error.code,
      duplicates: error.duplicates,
    }, { status: 409 });
  }
  return createErrorResponse(error);
}

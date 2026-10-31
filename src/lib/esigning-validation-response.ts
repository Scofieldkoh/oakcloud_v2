import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { UNSUPPORTED_PDF_CHARACTERS_ISSUE_CODE } from '@/lib/esigning-pdf-text';

/**
 * 400 response for a Zod failure on an e-signing payload.
 *
 * Clients show `error` to the user. It stays the generic "Invalid payload" unless the payload
 * contains text the signed-PDF fonts cannot draw, in which case it carries that clear message
 * (and a stable `code`) so the signing page and the sender screens can show it.
 */
export function esigningValidationErrorResponse(error: z.ZodError): NextResponse {
  const unsupportedTextIssue = error.issues.find(
    (issue) =>
      issue.code === 'custom' &&
      (issue.params as { code?: string } | undefined)?.code === UNSUPPORTED_PDF_CHARACTERS_ISSUE_CODE
  );

  if (unsupportedTextIssue) {
    return NextResponse.json(
      {
        error: unsupportedTextIssue.message,
        code: UNSUPPORTED_PDF_CHARACTERS_ISSUE_CODE,
        details: error.errors,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
}

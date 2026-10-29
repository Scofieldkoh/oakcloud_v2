import { describe, expect, it } from 'vitest';
import { createErrorResponse as createApiHelperErrorResponse } from '@/lib/api-helpers';
import { createErrorResponse as createApiHandlerErrorResponse } from '@/lib/api-error-handler';
import { DeadlineApiError, ErrorCodes } from '@/lib/errors';

describe('deadline API errors', () => {
  it('preserves a deadline code and explicit conflict/validation status', () => {
    const conflict = new DeadlineApiError(ErrorCodes.VERSION_CONFLICT, 'Draft changed', 409);
    const invalid = new DeadlineApiError(ErrorCodes.MISSING_RULE_INPUT, 'Input missing', 422);

    expect(conflict).toMatchObject({ code: 'VERSION_CONFLICT', statusCode: 409 });
    expect(invalid).toMatchObject({ code: 'MISSING_RULE_INPUT', statusCode: 422 });
  });

  it('rejects statuses outside the conflict and validation contract', () => {
    expect(() => new DeadlineApiError(
      ErrorCodes.VERSION_CONFLICT,
      'invalid status',
      400 as 409,
    )).toThrow('Deadline errors must use HTTP 409 or 422');
  });

  it('serializes typed deadline errors through the API helper response', async () => {
    const response = createApiHelperErrorResponse(
      new DeadlineApiError(ErrorCodes.VERSION_CONFLICT, 'Draft changed', 409),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Draft changed',
      code: 'VERSION_CONFLICT',
    });
  });

  it('serializes explicit validation errors through the API handler response', async () => {
    const response = createApiHandlerErrorResponse(
      ErrorCodes.MISSING_RULE_INPUT,
      'Input missing',
      422,
      { field: 'financialYearEnd' },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'MISSING_RULE_INPUT',
        message: 'Input missing',
        details: { field: 'financialYearEnd' },
      },
    });
  });
});

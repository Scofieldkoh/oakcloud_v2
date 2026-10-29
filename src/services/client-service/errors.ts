import { ApiError, ErrorCodes } from '@/lib/errors';
import type { DuplicateClientServiceMatches } from './types';

export class DuplicateClientServiceError extends ApiError {
  constructor(public readonly duplicates: DuplicateClientServiceMatches) {
    super(ErrorCodes.DUPLICATE_CLIENT_SERVICE, 'A matching client service already exists.', 409);
    this.name = 'DuplicateClientServiceError';
  }
}

export class ClientServiceWriteConflictError extends ApiError {
  constructor() {
    super(
      ErrorCodes.CLIENT_SERVICE_WRITE_CONFLICT,
      'Service creation conflicted with another write. Try again.',
      409,
      { retriable: true },
    );
    this.name = 'ClientServiceWriteConflictError';
  }
}

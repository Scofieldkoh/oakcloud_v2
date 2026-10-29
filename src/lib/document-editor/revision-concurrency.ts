import { ApiError, ErrorCodes, NotFoundError } from '@/lib/errors';

/** Whether a write must carry the revision it was based on. */
export type RevisionPreconditionMode = 'optional' | 'required';

export type RevisionResource =
  | 'document-template'
  | 'template-partial'
  | 'generated-document'
  | 'document-generation-batch';

const RESOURCE_TYPES: Record<RevisionResource, string> = {
  'document-template': 'DocumentTemplate',
  'template-partial': 'TemplatePartial',
  'generated-document': 'GeneratedDocument',
  'document-generation-batch': 'DocumentGenerationBatch',
};

export interface RevisionDetails {
  resource: RevisionResource;
  expectedRevision?: number;
  revision?: number;
}

export class VersionConflictError extends ApiError {
  constructor(details: RevisionDetails) {
    super(
      ErrorCodes.VERSION_CONFLICT,
      'This document changed since you opened it. Reload or reconcile before saving.',
      409,
      {
        resourceType: RESOURCE_TYPES[details.resource],
        expectedRevision: details.expectedRevision,
        currentRevision: details.revision,
        action: 'reload-or-reconcile',
      },
    );
    this.name = 'VersionConflictError';
  }
}

export class RevisionPreconditionRequiredError extends ApiError {
  constructor(resource: RevisionResource) {
    super(
      ErrorCodes.REVISION_PRECONDITION_REQUIRED,
      'expectedRevision is required for this mutation.',
      428,
      {
        resourceType: RESOURCE_TYPES[resource],
        action: 'reload-and-retry',
      },
    );
    this.name = 'RevisionPreconditionRequiredError';
  }
}

export function assertRevisionPrecondition(
  expectedRevision: number | undefined,
  resource: RevisionResource,
  mode: RevisionPreconditionMode = 'optional',
): void {
  if (expectedRevision !== undefined || mode === 'optional') return;
  throw new RevisionPreconditionRequiredError(resource);
}

/**
 * Reclassify a zero-row CAS result using only a tenant-scoped lookup supplied
 * by the caller. The lookup must never search by ID outside the current tenant.
 */
export function classifyRevisionMiss(
  state: { revision: number; deleted: boolean; locked: boolean } | null,
  details: Omit<RevisionDetails, 'revision'>,
): never {
  if (!state) throw new NotFoundError('Resource not found');
  if (state.deleted || state.locked) {
    throw new ApiError(
      ErrorCodes.CONFLICT,
      state.deleted
        ? 'This resource is deleted.'
        : 'This resource is not editable in its current state.',
      409,
      {
        resourceType: RESOURCE_TYPES[details.resource],
        action: 'reload-read-only',
      },
    );
  }
  throw new VersionConflictError({ ...details, revision: state.revision });
}

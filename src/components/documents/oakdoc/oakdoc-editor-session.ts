import type { OakDocSnapshotIdentity } from '@/types/oakdoc';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * C02 snapshot/acknowledgement state for one native editor instance.
 *
 * - Every local change increments `localRevision`.
 * - A snapshot captures `{sessionKey, writerInstanceId, localRevision, baseRevision}`.
 * - An acknowledgement clears dirty only when nothing changed after that
 *   snapshot; later edits stay dirty and are never replaced by the response.
 * - Responses for an older session (another entity/item, a reload) are ignored.
 */
export class OakDocEditorSession {
  readonly writerInstanceId = randomId();
  private sessionKey = randomId();
  private localRevision = 0;
  private acknowledgedLocalRevision = 0;
  private baseRevision: number;

  constructor(baseRevision: number) {
    this.baseRevision = baseRevision;
  }

  /** Start a new session for a newly loaded entity/revision. Clears history. */
  reset(baseRevision: number): void {
    this.sessionKey = randomId();
    this.localRevision = 0;
    this.acknowledgedLocalRevision = 0;
    this.baseRevision = baseRevision;
  }

  markChanged(): number {
    this.localRevision += 1;
    return this.localRevision;
  }

  get dirty(): boolean {
    return this.localRevision !== this.acknowledgedLocalRevision;
  }

  get currentBaseRevision(): number {
    return this.baseRevision;
  }

  snapshot(): OakDocSnapshotIdentity {
    return {
      sessionKey: this.sessionKey,
      writerInstanceId: this.writerInstanceId,
      localRevision: this.localRevision,
      baseRevision: this.baseRevision,
    };
  }

  isCurrent(snapshot: Pick<OakDocSnapshotIdentity, 'sessionKey'>): boolean {
    return snapshot.sessionKey === this.sessionKey;
  }

  /**
   * Apply a successful save of `snapshot`. Returns `stale` for an old
   * session's response (ignored), otherwise whether local work is still dirty.
   */
  acknowledge(
    snapshot: OakDocSnapshotIdentity,
    persistedRevision: number,
  ): 'stale' | 'clean' | 'dirty' {
    if (!this.isCurrent(snapshot)) return 'stale';
    this.baseRevision = persistedRevision;
    if (snapshot.localRevision > this.acknowledgedLocalRevision) {
      this.acknowledgedLocalRevision = snapshot.localRevision;
    }
    return this.dirty ? 'dirty' : 'clean';
  }
}

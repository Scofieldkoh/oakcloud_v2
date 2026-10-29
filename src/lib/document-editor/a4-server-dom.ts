import { JSDOM } from 'jsdom';

/**
 * S1's structural reader/projection implementation intentionally uses the DOM
 * APIs owned by the editor/pagination domain. WORKFLOW server readers consume
 * that implementation through one process-local JSDOM environment rather than
 * duplicating its parser or structural-position logic.
 *
 * Only missing DOM globals are installed. Existing browser/jsdom environments
 * remain authoritative. The singleton is retained for the lifetime of the
 * server process so synchronous S1 readers and serializers share one stable DOM
 * implementation without per-request global swapping races.
 */
let serverDom: JSDOM | null = null;

const DOM_GLOBALS = [
  'document',
  'Node',
  'NodeFilter',
  'Element',
  'HTMLElement',
  'HTMLBRElement',
  'HTMLTableElement',
  'HTMLTableRowElement',
  'Text',
  'Range',
  'DocumentFragment',
  'DOMParser',
  'XMLSerializer',
] as const;

export function ensureA4ServerDomGlobals(): void {
  if (
    typeof document !== 'undefined'
    && typeof Node !== 'undefined'
    && typeof NodeFilter !== 'undefined'
    && typeof DOMParser !== 'undefined'
    && typeof XMLSerializer !== 'undefined'
  ) {
    return;
  }

  serverDom ??= new JSDOM('<!doctype html><html><body></body></html>');
  const window = serverDom.window as unknown as Record<string, unknown>;
  const target = globalThis as unknown as Record<string, unknown>;

  for (const key of DOM_GLOBALS) {
    if (target[key] === undefined && window[key] !== undefined) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value: window[key],
      });
    }
  }
}

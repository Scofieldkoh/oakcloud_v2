/**
 * View Count Buffer
 *
 * Batches form view count increments in memory and flushes to the database
 * periodically to reduce write contention under high traffic.
 *
 * Instead of one UPDATE per page load, increments are accumulated in a Map
 * and flushed in a single bulk operation every FLUSH_INTERVAL_MS milliseconds.
 *
 * The buffer is intentionally process-local. In a multi-instance deployment,
 * each instance maintains its own buffer and flushes independently - counts
 * may lag by up to FLUSH_INTERVAL_MS but will converge.
 */

import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

const log = createLogger('view-count-buffer');

const FLUSH_INTERVAL_MS = 30_000;

const buffer = new Map<string, number>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

export function incrementViewCount(formId: string): void {
  buffer.set(formId, (buffer.get(formId) ?? 0) + 1);
}

async function flush(): Promise<void> {
  if (flushing || buffer.size === 0) return;

  flushing = true;
  const snapshot = new Map(buffer);
  buffer.clear();

  try {
    await Promise.all(
      Array.from(snapshot.entries()).map(([formId, count]) =>
        prisma.form.updateMany({
          where: { id: formId, deletedAt: null },
          data: { viewsCount: { increment: count } },
        })
      )
    );
  } catch (error) {
    log.error('Failed to flush view counts; requeueing', error);

    for (const [formId, count] of snapshot.entries()) {
      buffer.set(formId, (buffer.get(formId) ?? 0) + count);
    }
  } finally {
    flushing = false;
  }
}

export function startViewCountFlush(): void {
  if (flushTimer) return;

  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  if (flushTimer.unref) flushTimer.unref();
}

export function stopViewCountFlush(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  return flush();
}

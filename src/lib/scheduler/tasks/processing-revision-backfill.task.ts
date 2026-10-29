import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('processing-revision-backfill-task');
const DEFAULT_BATCH_SIZE = 500;

async function backfillCurrentRevisionPointers(batchSize = DEFAULT_BATCH_SIZE): Promise<{
  scanned: number;
  updated: number;
}> {
  const documents = await prisma.processingDocument.findMany({
    where: {
      currentRevisionId: null,
      deletedAt: null,
      revisions: {
        some: {
          status: 'APPROVED',
        },
      },
    },
    select: {
      id: true,
      revisions: {
        where: { status: 'APPROVED' },
        orderBy: [
          { approvedAt: 'desc' },
          { revisionNumber: 'desc' },
        ],
        take: 1,
        select: { id: true },
      },
    },
    take: batchSize,
  });

  const updates = documents
    .map((document) => ({
      processingDocumentId: document.id,
      revisionId: document.revisions[0]?.id,
    }))
    .filter((item): item is { processingDocumentId: string; revisionId: string } => Boolean(item.revisionId));

  if (updates.length === 0) {
    return { scanned: documents.length, updated: 0 };
  }

  await prisma.$transaction(
    updates.map((item) =>
      prisma.processingDocument.updateMany({
        where: {
          id: item.processingDocumentId,
          currentRevisionId: null,
        },
        data: {
          currentRevisionId: item.revisionId,
        },
      })
    )
  );

  return { scanned: documents.length, updated: updates.length };
}

async function executeProcessingRevisionBackfillTask(): Promise<TaskResult> {
  log.info('Backfilling missing processing currentRevisionId pointers...');

  try {
    const result = await backfillCurrentRevisionPointers();

    return {
      success: true,
      message: `Backfilled currentRevisionId for ${result.updated} processing document(s)`,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to backfill processing currentRevisionId pointers', error);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export const processingRevisionBackfillTask: TaskRegistration = {
  id: 'processing-revision-backfill',
  name: 'Processing Revision Pointer Backfill',
  description: 'Repairs processing documents with approved revisions but missing currentRevisionId pointers',
  defaultCronPattern: '15 3 * * *',
  execute: executeProcessingRevisionBackfillTask,
};

export { backfillCurrentRevisionPointers };

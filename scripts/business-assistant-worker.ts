import { runBusinessAssistantWorker } from '../src/services/business-assistant/worker';
import { prisma } from '../src/lib/prisma';
import { drainBizFileOperationEffects } from '../src/services/bizfile/application/effect-executor';

const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function main(): Promise<void> {
  const once = process.argv.includes('--once') || process.env.BUSINESS_ASSISTANT_WORKER_ONCE === 'true';
  const result = await runBusinessAssistantWorker({
    signal: controller.signal,
    once,
    // BizFile owns this outbox; the generic assistant worker only provides the
    // supervised poll loop and remains independent of module effect kinds.
    effectDrain: () => drainBizFileOperationEffects({ batchSize: 20 }),
  });
  if (once && result.errors > 0) {
    console.error(`[business-assistant-worker] one-shot completed with ${result.errors} error(s)`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[business-assistant-worker] fatal error', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

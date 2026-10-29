import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { addMonthsClamped, currentDateInSingapore } from '@/services/service-schedule/date-only';
import {
  applyDeadlineOccurrenceRemediation,
  previewDeadlineOccurrenceRemediation,
} from '@/services/schedule-reconciliation';
import type { DateOnly } from '@/services/service-schedule';

export type RemediateDeadlineOccurrencesArgs = {
  tenantId: string;
  clientServiceIds: string[];
  reason: string;
  apply: boolean;
  expectedFingerprint?: string;
  actorId?: string;
  today: DateOnly;
  horizonEnd: DateOnly;
};

const SUPPORTED_FLAGS = new Set([
  '--tenant-id',
  '--client-service-id',
  '--reason',
  '--apply',
  '--expected-fingerprint',
  '--actor-id',
]);

function usage(): string {
  return [
    'Usage:',
    '  npm run repair:deadlines -- --tenant-id <uuid> --client-service-id <uuid> [--client-service-id <uuid> ...] --reason "Correct 2026 annual source alignment"',
    '  npm run repair:deadlines -- --tenant-id <uuid> --client-service-id <uuid> --apply --expected-fingerprint <sha256> --actor-id <uuid> --reason "Correct 2026 annual source alignment"',
    '',
    'Dry-run by default. --apply additionally requires --expected-fingerprint and --actor-id.',
  ].join('\n');
}

export function parseRemediationArgs(
  args: string[],
  now: Date = new Date(),
): RemediateDeadlineOccurrencesArgs {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  let pendingFlag: string | null = null;

  for (const arg of args) {
    if (pendingFlag) {
      values.set(pendingFlag, [...(values.get(pendingFlag) ?? []), arg]);
      pendingFlag = null;
      continue;
    }
    if (SUPPORTED_FLAGS.has(arg)) {
      if (arg === '--apply') {
        flags.add(arg);
        continue;
      }
      pendingFlag = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (pendingFlag) throw new Error(`Missing value for ${pendingFlag}\n${usage()}`);

  const tenantId = values.get('--tenant-id')?.at(-1)?.trim();
  const clientServiceIds = (values.get('--client-service-id') ?? []).map((id) => id.trim());
  const reason = values.get('--reason')?.at(-1)?.trim();
  const expectedFingerprint = values.get('--expected-fingerprint')?.at(-1)?.trim();
  const actorId = values.get('--actor-id')?.at(-1)?.trim();

  if (!tenantId) throw new Error('--tenant-id is required\n' + usage());
  if (clientServiceIds.length === 0) throw new Error('At least one --client-service-id is required\n' + usage());
  if (clientServiceIds.some((id) => id.length === 0)) throw new Error('--client-service-id must not be blank\n' + usage());
  if (new Set(clientServiceIds).size !== clientServiceIds.length) {
    throw new Error('--client-service-id values must be unique\n' + usage());
  }
  if (clientServiceIds.length > 25) throw new Error('At most 25 --client-service-id values are allowed\n' + usage());
  if (!reason || reason.length < 10) throw new Error('--reason must be at least 10 characters\n' + usage());

  const apply = flags.has('--apply');
  if (apply) {
    if (!expectedFingerprint) throw new Error('--apply requires --expected-fingerprint\n' + usage());
    if (!actorId) throw new Error('--apply requires --actor-id\n' + usage());
  }

  const today = currentDateInSingapore(now);
  const horizonEnd = addMonthsClamped(today, 12);

  return { tenantId, clientServiceIds, reason, apply, expectedFingerprint, actorId, today, horizonEnd };
}

async function main(): Promise<void> {
  const args = parseRemediationArgs(process.argv.slice(2));
  if (args.apply) {
    const result = await applyDeadlineOccurrenceRemediation({
      tenantId: args.tenantId,
      clientServiceIds: args.clientServiceIds,
      today: args.today,
      horizonEnd: args.horizonEnd,
      reason: args.reason,
      expectedFingerprint: args.expectedFingerprint!,
      actorId: args.actorId!,
    });
    console.info(JSON.stringify(result));
    return;
  }

  const preview = await previewDeadlineOccurrenceRemediation({
    tenantId: args.tenantId,
    clientServiceIds: args.clientServiceIds,
    today: args.today,
    horizonEnd: args.horizonEnd,
    reason: args.reason,
  });
  console.info(JSON.stringify(preview));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

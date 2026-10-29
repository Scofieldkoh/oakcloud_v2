#!/usr/bin/env node
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  P16_CHECKS,
  canonicalJson,
  createEvidenceManifest,
  evaluateEvidenceManifest,
  recordEvidenceCheck,
  sealEvidenceManifest,
  setSafetyAssertions,
  validateEvidenceManifest,
} from './lib/business-assistant-p16-evidence.mjs';

function usage(exitCode = 0) {
  const text = `Business Assistant P16 evidence CLI\n\nUsage:\n  node scripts/business-assistant-p16-evidence.mjs init --app-sha <sha> --operator <name> --out <file> [--run-id <id>]\n  node scripts/business-assistant-p16-evidence.mjs record --manifest <file> --check <id> --status <PASS|FAIL|BLOCKED> [--evidence <json-file>] [--note <text>]\n  node scripts/business-assistant-p16-evidence.mjs safety --manifest <file> [--production-gates-unchanged <true|false>] [--production-defaults-disabled <true|false>] [--kill-switch-restored <true|false>] [--rollback-rehearsed <true|false>]\n  node scripts/business-assistant-p16-evidence.mjs status --manifest <file> [--expected-app-sha <sha>] [--require-ready]\n  node scripts/business-assistant-p16-evidence.mjs seal --manifest <file> [--completed-at <timestamp>]\n  node scripts/business-assistant-p16-evidence.mjs checks\n\nPASS/FAIL records require immutable evidence references. A sealed manifest is immutable.\n`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') usage(0);
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'require-ready') {
      values[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${key} is required`);
  return value;
}

function booleanArg(values, key) {
  if (!Object.hasOwn(values, key)) return undefined;
  const value = values[key];
  if (value !== 'true' && value !== 'false') throw new Error(`--${key} must be true or false`);
  return value === 'true';
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function atomicWriteJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, canonicalJson(value), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

async function init(values) {
  const output = required(values, 'out');
  const manifest = createEvidenceManifest({
    appSha: required(values, 'app-sha'),
    operator: required(values, 'operator'),
    runId: values['run-id'],
  });
  await atomicWriteJson(output, manifest);
  console.log(JSON.stringify(evaluateEvidenceManifest(manifest), null, 2));
}

async function record(values) {
  const path = required(values, 'manifest');
  const evidence = values.evidence ? await readJson(values.evidence) : [];
  if (!Array.isArray(evidence)) throw new Error('--evidence JSON must contain an array of evidence references');
  const manifest = await readJson(path);
  const next = recordEvidenceCheck(manifest, {
    id: required(values, 'check'),
    status: required(values, 'status'),
    evidence,
    note: values.note ?? null,
  });
  await atomicWriteJson(path, next);
  console.log(JSON.stringify(evaluateEvidenceManifest(next), null, 2));
}

async function safety(values) {
  const path = required(values, 'manifest');
  const assertions = {
    productionGatesUnchanged: booleanArg(values, 'production-gates-unchanged'),
    productionDefaultsDisabled: booleanArg(values, 'production-defaults-disabled'),
    killSwitchRestored: booleanArg(values, 'kill-switch-restored'),
    rollbackRehearsed: booleanArg(values, 'rollback-rehearsed'),
  };
  for (const key of Object.keys(assertions)) if (assertions[key] === undefined) delete assertions[key];
  if (Object.keys(assertions).length === 0) throw new Error('safety requires at least one assertion flag');
  const next = setSafetyAssertions(await readJson(path), assertions);
  const validation = validateEvidenceManifest(next);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  await atomicWriteJson(path, next);
  console.log(JSON.stringify(evaluateEvidenceManifest(next), null, 2));
}

async function status(values) {
  const result = evaluateEvidenceManifest(await readJson(required(values, 'manifest')), {
    expectedAppSha: values['expected-app-sha'],
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid || (values['require-ready'] && !result.readyForSeparateProductionGateReview)) process.exitCode = 2;
}

async function seal(values) {
  const path = required(values, 'manifest');
  const manifest = await readJson(path);
  const before = evaluateEvidenceManifest(manifest);
  const allChecksPassed = before.valid
    && before.pass.length === before.totalChecks
    && before.fail.length === 0
    && before.blocked.length === 0
    && before.notRun.length === 0;

  if (!allChecksPassed || !before.safetySatisfied) {
    throw new Error('refusing to seal: every P16 gate must PASS and all safety assertions must be true first');
  }

  const next = sealEvidenceManifest(manifest, { completedAt: values['completed-at'] });
  const result = evaluateEvidenceManifest(next);
  if (!result.readyForSeparateProductionGateReview) {
    throw new Error('refusing to write sealed manifest: readiness invariants were not satisfied');
  }
  await atomicWriteJson(path, next);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === 'init') return init(values);
  if (command === 'record') return record(values);
  if (command === 'safety') return safety(values);
  if (command === 'status') return status(values);
  if (command === 'seal') return seal(values);
  if (command === 'checks') {
    console.log(JSON.stringify(P16_CHECKS, null, 2));
    return;
  }
  usage(1);
}

main().catch((error) => {
  console.error(`[p16-evidence] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

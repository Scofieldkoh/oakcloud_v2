#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const PROTECTED_PATHS = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)docker-compose(?:\.|-)/i,
  /(^|\/)compose\.ya?ml$/i,
  /(^|\/)(?:deploy|deployment|infra|infrastructure|k8s|kubernetes|helm)(\/|$)/i,
];

const GATE_ENABLEMENT = /\b(?:BUSINESS_ASSISTANT_ENABLED|BUSINESS_ASSISTANT_PROVIDER_ENABLED|BUSINESS_ASSISTANT_MUTATIONS_ENABLED|BUSINESS_ASSISTANT_LEARNING_PROMOTION_ENABLED)\b\s*(?::|=)\s*(?:true|1|['"]true['"])/i;
const SELF = 'scripts/check-business-assistant-p16-production-gates.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  if (!values.base) throw new Error('--base <commit-or-ref> is required');
  return { base: values.base, head: values.head ?? 'HEAD' };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function changedFiles(base, head) {
  return git(['diff', '--name-only', `${base}...${head}`])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function addedLinesByFile(base, head) {
  const diff = git(['diff', '--unified=0', '--no-color', `${base}...${head}`]);
  const additions = new Map();
  let current = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6);
      continue;
    }
    if (!current || current === SELF || current.startsWith('docs/') || current.startsWith('__tests__/')) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const list = additions.get(current) ?? [];
      list.push(line.slice(1));
      additions.set(current, list);
    }
  }
  return additions;
}

function main() {
  const { base, head } = parseArgs(process.argv.slice(2));
  const files = changedFiles(base, head);
  const protectedChanges = files.filter((file) => PROTECTED_PATHS.some((pattern) => pattern.test(file)));
  const enablements = [];

  for (const [file, lines] of addedLinesByFile(base, head)) {
    for (const line of lines) {
      if (GATE_ENABLEMENT.test(line)) enablements.push({ file, line: line.trim() });
    }
  }

  if (protectedChanges.length > 0 || enablements.length > 0) {
    console.error('[p16-gate-guard] P16 must not change production gate/deployment surfaces.');
    for (const file of protectedChanges) console.error(`protected path changed: ${file}`);
    for (const item of enablements) console.error(`possible gate enablement in ${item.file}: ${item.line}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[p16-gate-guard] OK: ${files.length} changed file(s), no protected deployment path or production-gate enablement detected.`);
}

try {
  main();
} catch (error) {
  console.error(`[p16-gate-guard] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

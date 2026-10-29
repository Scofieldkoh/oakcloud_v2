import { readFileSync } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'module',
  'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util',
  'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const IMPORT_SPECIFIER_PATTERN = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_SPECIFIER_PATTERN = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function moduleSpecifiers(source: string): string[] {
  return [
    ...[...source.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => match[1]),
    ...[...source.matchAll(DYNAMIC_IMPORT_SPECIFIER_PATTERN)].map((match) => match[1]),
  ];
}

function isNodeBuiltin(specifier: string): boolean {
  const bareSpecifier = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return specifier.startsWith('node:') || NODE_BUILTINS.has(bareSpecifier);
}

function resolveLocalModule(specifier: string, importer: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = resolve(process.cwd(), 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(importer), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'index.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function inspectLocalImportGraph(entry: string): { files: Set<string>; nodeImports: string[] } {
  const files = new Set<string>();
  const nodeImports: string[] = [];
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of moduleSpecifiers(source)) {
      if (isNodeBuiltin(specifier)) {
        nodeImports.push(`${relative(process.cwd(), file)} -> ${specifier}`);
        continue;
      }
      const local = resolveLocalModule(specifier, file);
      if (local) pending.push(local);
    }
  }

  return { files, nodeImports };
}

describe('service schedule public barrel browser safety', () => {
  it('does not expose Node-only imports through the complete local public graph', () => {
    const entry = resolve(process.cwd(), 'src/services/service-schedule/index.ts');
    const graph = inspectLocalImportGraph(entry);
    const relativeFiles = [...graph.files].map((file) => relative(process.cwd(), file).replaceAll('\\', '/'));

    expect(graph.nodeImports).toEqual([]);
    expect(relativeFiles).toEqual(expect.arrayContaining([
      'src/services/service-schedule/index.ts',
      'src/services/service-schedule/types.ts',
      'src/services/service-schedule/date-only.ts',
      'src/services/service-schedule/business-days.ts',
      'src/services/service-schedule/hash.ts',
      'src/lib/validations/service-schedule.ts',
    ]));
  });
});

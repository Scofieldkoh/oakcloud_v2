import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function normalizeGeneratedText(text) {
  return `${text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .trimEnd()}\n`;
}

async function normalizeDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeDirectory(target);
      return;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return;
    const original = await readFile(target, 'utf8');
    const normalized = normalizeGeneratedText(original);
    if (normalized !== original) await writeFile(target, normalized, 'utf8');
  }));
}

export async function normalizeGeneratedPrisma(rootDirectory) {
  await normalizeDirectory(path.join(rootDirectory, 'src', 'generated', 'prisma'));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  await normalizeGeneratedPrisma(path.resolve(scriptDirectory, '..'));
}

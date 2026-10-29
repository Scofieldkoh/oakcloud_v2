// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupArchiveWriter, extractArchive } from '@/services/backup/full/archive';

describe('full backup archive', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oak-archive-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function writeArchive(password: string, entries: Record<string, Buffer>): Promise<string> {
    const archivePath = path.join(dir, 'backup.oakbackup');
    const writer = BackupArchiveWriter.create(archivePath, password);
    for (const [name, data] of Object.entries(entries)) {
      const source = path.join(dir, 'source', name);
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, data);
      await writer.addFile(name, source);
    }
    await writer.addBuffer('manifest.json', Buffer.from('{"ok":true}'));
    await writer.finish();
    return archivePath;
  }

  it('round-trips entries of any size, including empty ones', async () => {
    const large = Buffer.alloc(3 * 1024 * 1024 + 7, 0x5a);
    const archivePath = await writeArchive('long enough password', {
      'db/companies.jsonl': Buffer.from('{"id":"c1"}\n'),
      'db/empty.jsonl': Buffer.alloc(0),
      'files/tenant/documents/scan.pdf': large,
    });

    const out = path.join(dir, 'out');
    const entries = await extractArchive(archivePath, 'long enough password', out);

    expect(entries).toEqual(['db/companies.jsonl', 'db/empty.jsonl', 'files/tenant/documents/scan.pdf', 'manifest.json']);
    expect(fs.readFileSync(path.join(out, 'db/companies.jsonl'), 'utf-8')).toBe('{"id":"c1"}\n');
    expect(fs.readFileSync(path.join(out, 'db/empty.jsonl')).length).toBe(0);
    expect(fs.readFileSync(path.join(out, 'files/tenant/documents/scan.pdf')).equals(large)).toBe(true);
  });

  it('keeps contents unreadable without the password', async () => {
    const archivePath = await writeArchive('long enough password', { 'db/secrets.jsonl': Buffer.from('client-secret-value') });
    expect(fs.readFileSync(archivePath).includes(Buffer.from('client-secret-value'))).toBe(false);
    await expect(extractArchive(archivePath, 'wrong password here', path.join(dir, 'out')))
      .rejects.toThrow('Wrong backup password, or the backup file is damaged');
  });

  it('rejects a file that was changed after it was written', async () => {
    const archivePath = await writeArchive('long enough password', { 'db/a.jsonl': Buffer.from('x'.repeat(5000)) });
    const bytes = fs.readFileSync(archivePath);
    bytes[bytes.length - 40] ^= 0xff;
    fs.writeFileSync(archivePath, bytes);
    await expect(extractArchive(archivePath, 'long enough password', path.join(dir, 'out')))
      .rejects.toThrow(/Wrong backup password, or the backup file is damaged|damaged|incomplete/);
  });

  it('rejects files that are not Oakcloud backups', async () => {
    const other = path.join(dir, 'other.oakbackup');
    fs.writeFileSync(other, Buffer.alloc(200, 1));
    await expect(extractArchive(other, 'long enough password', path.join(dir, 'out')))
      .rejects.toThrow('This is not an Oakcloud backup file');
  });

  it('refuses entry names that would write outside the restore folder', async () => {
    const archivePath = path.join(dir, 'evil.oakbackup');
    const writer = BackupArchiveWriter.create(archivePath, 'long enough password');
    await writer.addBuffer('../escape.txt', Buffer.from('nope'));
    await writer.finish();
    await expect(extractArchive(archivePath, 'long enough password', path.join(dir, 'out')))
      .rejects.toThrow('unsafe name');
    expect(fs.existsSync(path.join(dir, 'escape.txt'))).toBe(false);
  });
});

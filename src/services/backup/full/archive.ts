/**
 * Password-locked archive for full backups.
 *
 * Layout: magic (8 bytes) | format version (1 byte) | scrypt salt (16) | GCM IV (12)
 *         | AES-256-GCM ciphertext of gzip(entries) | GCM tag (16)
 *
 * Each entry inside the gzip stream is: name length (u32 BE) | name (UTF-8)
 * | data length (u64 BE) | data. Entries are streamed, so memory stays bounded
 * by one read chunk rather than by the archive size.
 *
 * The GCM tag is only known at the end, so readers must extract to a staging
 * folder and treat nothing as trusted until `extractArchive` resolves.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { once } from 'events';
import { pipeline } from 'stream/promises';
import { Transform, type Writable } from 'stream';

const MAGIC = Buffer.from('OAKBAK01', 'ascii');
const FORMAT_VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + 1 + SALT_LENGTH + IV_LENGTH;
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const MIN_BACKUP_PASSWORD_LENGTH = 12;

export class BackupArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupArchiveError';
  }
}

function deriveKey(password: string, salt: Buffer): Buffer {
  if (!password) throw new BackupArchiveError('A backup password is required');
  return crypto.scryptSync(password, salt, 32, SCRYPT_PARAMS);
}

async function writeChunk(stream: Writable, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/** Streams named entries into a password-locked archive file. */
export class BackupArchiveWriter {
  private readonly gzip = zlib.createGzip({ level: 6 });
  private readonly done: Promise<void>;

  private constructor(filePath: string, password: string) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    const output = fs.createWriteStream(filePath);
    output.write(Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), salt, iv]));
    // The tag is appended after the ciphertext, so the cipher must not end the file stream.
    this.gzip.pipe(cipher);
    cipher.pipe(output, { end: false });
    cipher.once('end', () => output.end(cipher.getAuthTag()));
    this.done = new Promise<void>((resolve, reject) => {
      output.once('finish', () => resolve());
      this.gzip.once('error', reject);
      cipher.once('error', reject);
      output.once('error', reject);
    });
    // Callers observe failures through finish(); avoid an unhandled rejection before then.
    this.done.catch(() => undefined);
  }

  static create(filePath: string, password: string): BackupArchiveWriter {
    return new BackupArchiveWriter(filePath, password);
  }

  private async writeHeader(name: string, size: number): Promise<void> {
    const nameBytes = Buffer.from(name, 'utf-8');
    const header = Buffer.alloc(4 + nameBytes.length + 8);
    header.writeUInt32BE(nameBytes.length, 0);
    nameBytes.copy(header, 4);
    header.writeBigUInt64BE(BigInt(size), 4 + nameBytes.length);
    await writeChunk(this.gzip, header);
  }

  async addBuffer(name: string, data: Buffer): Promise<void> {
    await this.writeHeader(name, data.length);
    if (data.length > 0) await writeChunk(this.gzip, data);
  }

  async addFile(name: string, filePath: string): Promise<void> {
    const { size } = await fs.promises.stat(filePath);
    await this.writeHeader(name, size);
    let written = 0;
    for await (const chunk of fs.createReadStream(filePath)) {
      const buffer = chunk as Buffer;
      written += buffer.length;
      await writeChunk(this.gzip, buffer);
    }
    if (written !== size) throw new BackupArchiveError(`File changed while it was being archived: ${name}`);
  }

  async finish(): Promise<void> {
    this.gzip.end();
    await this.done;
  }
}

/** Splits the decompressed byte stream back into entries and writes each one under `targetDir`. */
class EntryExtractor extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  /** fd is null for an entry that is read past without being written. */
  private current: { fd: number | null; remaining: bigint } | null = null;
  readonly entries: string[] = [];

  constructor(private readonly targetDir: string, private readonly include?: (name: string) => boolean) {
    super();
  }

  private resolveTarget(name: string): string {
    const target = path.resolve(this.targetDir, name);
    if (!target.startsWith(path.resolve(this.targetDir) + path.sep)) {
      throw new BackupArchiveError(`Backup entry has an unsafe name: ${name}`);
    }
    return target;
  }

  private openEntry(name: string, size: bigint): void {
    const target = this.resolveTarget(name);
    if (this.include && !this.include(name)) {
      this.current = { fd: null, remaining: size };
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      this.current = { fd: fs.openSync(target, 'w'), remaining: size };
      this.entries.push(name);
    }
    if (size === BigInt(0)) this.closeEntry();
  }

  private closeEntry(): void {
    if (this.current?.fd != null) fs.closeSync(this.current.fd);
    this.current = null;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      while (this.pending.length > 0) {
        if (this.current) {
          const take = Number(this.current.remaining < BigInt(this.pending.length) ? this.current.remaining : BigInt(this.pending.length));
          if (this.current.fd !== null) fs.writeSync(this.current.fd, this.pending, 0, take);
          this.current.remaining -= BigInt(take);
          this.pending = this.pending.subarray(take);
          if (this.current.remaining === BigInt(0)) this.closeEntry();
          continue;
        }
        if (this.pending.length < 4) break;
        const nameLength = this.pending.readUInt32BE(0);
        if (nameLength === 0 || nameLength > 4096) throw new BackupArchiveError('The backup file is damaged');
        if (this.pending.length < 4 + nameLength + 8) break;
        const name = this.pending.subarray(4, 4 + nameLength).toString('utf-8');
        const size = this.pending.readBigUInt64BE(4 + nameLength);
        this.pending = this.pending.subarray(4 + nameLength + 8);
        this.openEntry(name, size);
      }
      callback();
    } catch (error) {
      this.closeEntry();
      callback(error as Error);
    }
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.current || this.pending.length > 0) {
      this.closeEntry();
      callback(new BackupArchiveError('The backup file is incomplete'));
      return;
    }
    callback();
  }
}

/**
 * Decrypts and unpacks an archive into `targetDir`, verifying the password and
 * the integrity tag. Returns the names of the extracted entries. With
 * `include`, other entries are still read (the tag covers the whole file) but
 * not written.
 */
export async function extractArchive(
  filePath: string,
  password: string,
  targetDir: string,
  include?: (name: string) => boolean,
): Promise<string[]> {
  const handle = await fs.promises.open(filePath, 'r');
  let fileSize: number;
  let header: Buffer;
  let tag: Buffer;
  try {
    fileSize = (await handle.stat()).size;
    if (fileSize < HEADER_LENGTH + TAG_LENGTH) throw new BackupArchiveError('This is not an Oakcloud backup file');
    header = Buffer.alloc(HEADER_LENGTH);
    await handle.read(header, 0, HEADER_LENGTH, 0);
    tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(tag, 0, TAG_LENGTH, fileSize - TAG_LENGTH);
  } finally {
    await handle.close();
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupArchiveError('This is not an Oakcloud backup file');
  }
  if (header[MAGIC.length] !== FORMAT_VERSION) {
    throw new BackupArchiveError('This backup was made by a newer version of Oakcloud. Update this install first.');
  }
  const salt = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_LENGTH);
  const iv = header.subarray(MAGIC.length + 1 + SALT_LENGTH, HEADER_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  decipher.setAuthTag(tag);

  await fs.promises.mkdir(targetDir, { recursive: true });
  const extractor = new EntryExtractor(targetDir, include);
  try {
    await pipeline(
      fs.createReadStream(filePath, { start: HEADER_LENGTH, end: fileSize - TAG_LENGTH - 1 }),
      decipher,
      zlib.createGunzip(),
      extractor,
      async function* drain(source) {
        for await (const _ of source) { /* entries are written by the extractor */ }
      },
    );
  } catch (error) {
    if (error instanceof BackupArchiveError) throw error;
    throw new BackupArchiveError('Wrong backup password, or the backup file is damaged');
  }
  return extractor.entries;
}

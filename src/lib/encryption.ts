/**
 * Encryption & Hashing Utilities
 *
 * - AES-256-GCM encryption for sensitive data storage (connector credentials)
 * - BLAKE3 hashing for fast file integrity verification
 * - SHA-256/SHA-512 for general purpose hashing
 *
 * Requires ENCRYPTION_KEY environment variable (32+ characters).
 */

import crypto from 'crypto';
import { blake3 } from '@noble/hashes/blake3.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import bcrypt from 'bcryptjs';
import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_IV_LENGTH,
  ENCRYPTION_TAG_LENGTH,
  ARGON2_CONFIG,
  BCRYPT_SALT_ROUNDS,
} from './constants/application';

/**
 * Get the encryption key from environment variable
 * @returns Buffer - 32-byte encryption key
 * @throws Error if ENCRYPTION_KEY is not set
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required for credential encryption');
  }
  // Hash the key to ensure it's exactly 32 bytes for AES-256
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt plaintext using AES-256-GCM
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in format: iv:tag:ciphertext (hex encoded)
 *
 * @example
 * const encrypted = encrypt(JSON.stringify({ apiKey: 'sk-xxx' }));
 * // Returns: "a1b2c3...:d4e5f6...:encrypted_data..."
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // Format: iv:tag:encrypted (all hex encoded)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt ciphertext using AES-256-GCM
 *
 * @param ciphertext - Encrypted string in format: iv:tag:ciphertext
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails or format is invalid
 *
 * @example
 * const decrypted = decrypt(encryptedString);
 * const credentials = JSON.parse(decrypted);
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    throw new Error('Cannot decrypt: ciphertext is empty or undefined');
  }
  const key = getEncryptionKey();
  const parts = ciphertext.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, tagHex, encrypted] = parts;

  if (!ivHex || !tagHex || !encrypted) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  if (iv.length !== ENCRYPTION_IV_LENGTH) {
    throw new Error('Invalid IV length');
  }

  if (tag.length !== ENCRYPTION_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypt a JSON object
 *
 * @param data - Object to encrypt
 * @returns Encrypted string
 */
export function encryptJson<T extends Record<string, unknown>>(data: T): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypt to a JSON object
 *
 * @param ciphertext - Encrypted string
 * @returns Decrypted object
 */
export function decryptJson<T extends Record<string, unknown>>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext)) as T;
}

/**
 * Mask a sensitive string for display (e.g., API keys)
 * Shows first 4 and last 4 characters with dots in between
 *
 * @param value - The string to mask
 * @param visibleChars - Number of characters to show at start and end (default: 4)
 * @returns Masked string (e.g., "sk-a...xyz1")
 */
export function maskSensitive(value: string, visibleChars: number = 4): string {
  if (!value || value.length <= visibleChars * 2) {
    return '*'.repeat(value?.length || 8);
  }
  const start = value.slice(0, visibleChars);
  const end = value.slice(-visibleChars);
  return `${start}...${end}`;
}

// ============================================================================
// Hashing Utilities
// ============================================================================

/**
 * Hash data using BLAKE3 (fast, secure, recommended for file hashing)
 *
 * BLAKE3 is 3-10x faster than SHA-256 and cryptographically secure.
 * Ideal for file integrity verification and deduplication.
 *
 * @param data - String or Buffer to hash
 * @returns Hex-encoded 256-bit hash (64 characters)
 *
 * @example
 * const fileHash = hashBlake3(fileBuffer);
 * const stringHash = hashBlake3('hello world');
 */
export function hashBlake3(data: string | Buffer | Uint8Array): string {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return bytesToHex(blake3(input));
}

/**
 * Hash data using SHA-512 (NIST standard, higher security margin)
 *
 * SHA-512 provides a 512-bit hash and is faster than SHA-256 on 64-bit systems.
 * Use for cases requiring longer hash output or NIST compliance.
 *
 * @param data - String or Buffer to hash
 * @returns Hex-encoded 512-bit hash (128 characters)
 *
 * @example
 * const hash = hashSha512(data);
 */
export function hashSha512(data: string | Buffer | Uint8Array): string {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return bytesToHex(sha512(input));
}

/**
 * Hash data using SHA-256 (standard, widely compatible)
 *
 * Uses Node.js crypto for compatibility.
 *
 * @param data - String or Buffer to hash
 * @returns Hex-encoded 256-bit hash (64 characters)
 */
export function hashSha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a file hash using BLAKE3 (recommended for documents)
 *
 * This is the preferred method for file integrity verification
 * due to BLAKE3's speed and security properties.
 *
 * @param buffer - File content as Buffer
 * @returns Hex-encoded hash
 */
export function hashFile(buffer: Buffer): string {
  return hashBlake3(buffer);
}

/**
 * Generate a truncated fingerprint for display purposes
 *
 * @param data - Data to hash
 * @param length - Length of fingerprint (default: 16)
 * @returns Truncated hex hash
 */
export function generateFingerprint(data: string | Buffer, length: number = 16): string {
  return hashBlake3(data).substring(0, length);
}

// ============================================================================
// Password Hashing (Argon2id)
// ============================================================================

/** Hash format prefix to identify algorithm version */
const ARGON2_PREFIX = '$argon2id$';

/**
 * Hash a password using Argon2id (OWASP recommended)
 *
 * Argon2id is the winner of the Password Hashing Competition and provides:
 * - Memory-hard computation (resistant to GPU/ASIC attacks)
 * - Time-hard computation (resistant to brute force)
 * - Side-channel resistance
 *
 * @param password - Plain text password
 * @returns Encoded hash string: $argon2id$salt$hash
 *
 * @example
 * const hash = await hashPassword('myPassword123');
 * // Returns: "$argon2id$abc123...$def456..."
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(ARGON2_CONFIG.saltLen);
  const hash = argon2id(password, salt, {
    t: ARGON2_CONFIG.t,
    m: ARGON2_CONFIG.m,
    p: ARGON2_CONFIG.p,
    dkLen: ARGON2_CONFIG.dkLen,
  });

  // Format: $argon2id$<salt>$<hash> (both base64 encoded)
  return `${ARGON2_PREFIX}${salt.toString('base64')}$${bytesToHex(hash)}`;
}

/**
 * Verify a password against an Argon2id or bcrypt hash
 *
 * Supports automatic detection and migration:
 * - Argon2id hashes (new format): $argon2id$...
 * - bcrypt hashes (legacy): $2a$... or $2b$...
 *
 * @param password - Plain text password to verify
 * @param storedHash - Previously stored hash
 * @returns Object with isValid flag and needsRehash if using legacy bcrypt
 *
 * @example
 * const result = await verifyPassword('myPassword', storedHash);
 * if (result.isValid && result.needsRehash) {
 *   // Re-hash with Argon2id and update database
 * }
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ isValid: boolean; needsRehash: boolean }> {
  // Detect hash type
  if (storedHash.startsWith(ARGON2_PREFIX)) {
    // Argon2id hash
    const parts = storedHash.slice(ARGON2_PREFIX.length).split('$');
    if (parts.length !== 2) {
      return { isValid: false, needsRehash: false };
    }

    const [saltB64, hashHex] = parts;
    const salt = Buffer.from(saltB64, 'base64');

    const computedHash = argon2id(password, salt, {
      t: ARGON2_CONFIG.t,
      m: ARGON2_CONFIG.m,
      p: ARGON2_CONFIG.p,
      dkLen: ARGON2_CONFIG.dkLen,
    });

    const isValid = bytesToHex(computedHash) === hashHex;
    return { isValid, needsRehash: false };
  }

  // Legacy bcrypt hash ($2a$ or $2b$)
  if (storedHash.startsWith('$2')) {
    const isValid = await bcrypt.compare(password, storedHash);
    // If valid, recommend rehashing with Argon2id
    return { isValid, needsRehash: isValid };
  }

  // Unknown hash format
  return { isValid: false, needsRehash: false };
}

/**
 * Hash a password using bcrypt (legacy, for compatibility)
 *
 * @deprecated Use hashPassword() with Argon2id instead
 * @param password - Plain text password
 * @returns bcrypt hash
 */
export async function hashPasswordBcrypt(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Check if a password hash needs to be upgraded to Argon2id
 *
 * @param hash - Stored password hash
 * @returns true if using legacy bcrypt format
 */
export function needsPasswordRehash(hash: string): boolean {
  return !hash.startsWith(ARGON2_PREFIX);
}

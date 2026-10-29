/**
 * Columns locked with this install's ENCRYPTION_KEY.
 *
 * A new install has a different key, so these values are unlocked when a backup
 * is made (the archive itself is password-locked) and locked again with the
 * restoring install's key.
 */

import { decrypt, encrypt } from '@/lib/encryption';

const SECRET_COLUMNS: Record<string, string[]> = {
  connectors: ['credentials'],
  backup_settings: ['password_ciphertext'],
};

// Values that could not be unlocked keep their original ciphertext, unmarked.
const PLAIN_PREFIX = 'oakcloud-plain:';

export function secretColumnsFor(table: string): string[] {
  return SECRET_COLUMNS[table] ?? [];
}

/** Returns the unlocked value, or the original with `locked: true` when this install's key cannot open it. */
export function encodeSecretColumn(value: unknown): { value: unknown; locked: boolean } {
  if (typeof value !== 'string' || value.length === 0) return { value, locked: false };
  try {
    return { value: PLAIN_PREFIX + decrypt(value), locked: false };
  } catch {
    return { value, locked: true };
  }
}

export function decodeSecretColumn(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith(PLAIN_PREFIX)) return value;
  return encrypt(value.slice(PLAIN_PREFIX.length));
}

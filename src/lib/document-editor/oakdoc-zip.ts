import { strToU8 } from 'fflate';

const FFLATE_UINT8_ARRAY = strToU8('', true).constructor as Uint8ArrayConstructor;

/**
 * Encode UTF-8 text into a Uint8Array allocated by fflate's own realm.
 *
 * fflate.zipSync() classifies file entries with `instanceof Uint8Array`.
 * In jsdom, TextEncoder can return a typed array from a different realm than
 * the Uint8Array constructor captured by fflate, causing a file payload to be
 * mistaken for a nested ZIP directory. Copying the UTF-8 bytes through the
 * constructor returned by fflate's Latin-1 path preserves the full UTF-8
 * payload while keeping zipSync's realm check valid.
 */
export function encodeOakDocZipText(value: string): Uint8Array<ArrayBuffer> {
  return new FFLATE_UINT8_ARRAY(strToU8(value));
}

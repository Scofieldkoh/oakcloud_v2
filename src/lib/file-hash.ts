/**
 * File Hash Utilities
 *
 * Client-side file hashing using BLAKE3 for duplicate detection.
 * Matches the server-side hash algorithm used in document-processing.service.ts
 */

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Calculate BLAKE3 hash of a file
 * @param file - File to hash
 * @returns Promise resolving to hex-encoded hash string (64 characters)
 */
export async function calculateFileHash(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const hashBytes = blake3(uint8Array);
    return bytesToHex(hashBytes);
}

/**
 * Calculate hash for multiple files in parallel
 * @param files - Array of files to hash
 * @returns Promise resolving to Map of file name to hash
 */
export async function calculateFileHashes(files: File[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    await Promise.all(
        files.map(async (file) => {
            const hash = await calculateFileHash(file);
            results.set(file.name, hash);
        })
    );

    return results;
}

/**
 * Check if a file's hash matches any in a set of known hashes
 * @param file - File to check
 * @param knownHashes - Set of known hash values
 * @returns Promise resolving to true if duplicate found
 */
export async function isFileDuplicate(
    file: File,
    knownHashes: Set<string>
): Promise<boolean> {
    const hash = await calculateFileHash(file);
    return knownHashes.has(hash);
}

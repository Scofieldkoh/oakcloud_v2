/**
 * Document Filename Generation Utilities
 *
 * Generates standardized filenames for approved documents.
 * Format: [Sub Category]_[Document Date]_[Contact Name]_[Document No]_[Amount].ext
 * Amount is omitted when zero.
 *
 * Examples:
 * - With amount: Vendor Invoice_2024-01-15_Acme_INV-2024-001_SGD 1,234.56.pdf
 * - Zero amount: Bizfile_2025-08-07_ACRA_ACRA250807001467.pdf
 */

import type { DocumentSubCategory } from '@/generated/prisma';
import { Prisma } from '@/generated/prisma';
import { getSubCategoryLabel } from '@/lib/document-categories';

type Decimal = Prisma.Decimal;

/**
 * Characters that are invalid in filenames across Windows, macOS, and Linux
 */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

/**
 * Common legal suffixes to remove from company names (ordered by specificity)
 * More specific patterns should come first to avoid partial matches
 */
const LEGAL_SUFFIXES = [
  // Singapore
  'Private Limited',
  'Pte. Ltd.',
  'Pte Ltd',
  // Australia
  'Proprietary Limited',
  'Pty. Ltd.',
  'Pty Ltd',
  // General
  'Limited',
  'Ltd.',
  'Ltd',
  'Incorporated',
  'Inc.',
  'Inc',
  'L.L.C.',
  'LLC',
  'L.L.P.',
  'LLP',
  'Corporation',
  'Corp.',
  'Corp',
  'Company',
  'Co.',
  'Co',
  // Malaysia
  'Sdn. Bhd.',
  'Sdn Bhd',
  'Berhad',
  'Bhd',
  // European
  'S.A.',
  'SA',
  'GmbH',
  'AG',
  'B.V.',
  'BV',
  'N.V.',
  'NV',
  // Nordic
  'AB',
  'Oy',
  'A/S',
  'AS',
];

/**
 * Sanitize a string for use in filenames
 * - Removes invalid characters
 * - Replaces multiple spaces with single space
 * - Trims whitespace
 * - Limits length to prevent filesystem issues
 */
export function sanitizeForFilename(input: string, maxLength: number = 100): string {
  return input
    .replace(INVALID_FILENAME_CHARS, '') // Remove invalid chars
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
    .slice(0, maxLength); // Limit length
}

/**
 * Remove common legal suffixes from a company name
 * Example: "Acme Pte Ltd" → "Acme"
 */
export function shortenCompanyName(name: string): string {
  let result = name.trim();

  // Try to remove each suffix (case-insensitive)
  for (const suffix of LEGAL_SUFFIXES) {
    // Create case-insensitive regex with word boundary at start
    // Matches suffix at end of string, with optional comma/period before
    const pattern = new RegExp(`[,.]?\\s*${escapeRegex(suffix)}\\s*$`, 'i');
    const newResult = result.replace(pattern, '').trim();

    if (newResult !== result && newResult.length > 0) {
      result = newResult;
      // Continue checking for additional suffixes (e.g., "Holdings Pte Ltd" → "Holdings")
    }
  }

  return result;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format amount with commas and 2 decimal places
 * Example: 1234.5 → "1,234.50"
 */
export function formatAmountForFilename(
  amount: Decimal | number | string | null | undefined
): string | null {
  if (amount === null || amount === undefined) return null;

  const num =
    typeof amount === 'object' ? parseFloat(amount.toString()) : parseFloat(String(amount));

  if (isNaN(num)) return null;

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format a date as YYYY-MM-DD for filename
 */
export function formatDateForFilename(date: Date | string | null | undefined): string | null {
  if (!date) return null;

  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Input for generating approved document filename
 */
export interface ApprovedDocumentFilenameInput {
  documentSubCategory?: DocumentSubCategory | null;
  documentDate?: Date | string | null;
  contactName?: string | null; // Vendor name for AP, Customer name for AR
  documentNumber?: string | null;
  currency: string;
  totalAmount: Decimal | number | string;
  originalExtension: string; // e.g., '.pdf'
}

/**
 * Generate a standardized filename for an approved document
 *
 * Format: [Sub Category]_[Document Date]_[Contact Name]_[Document No]_[Amount].ext
 *
 * Parts are omitted if not available or zero (for amount):
 * - With all parts: Vendor Invoice_2024-01-15_Acme_INV-2024-001_SGD 1,234.56.pdf
 * - Missing date: Vendor Invoice_Acme_INV-2024-001_SGD 1,234.56.pdf
 * - Zero amount: Bizfile_2025-08-07_ACRA_ACRA250807001467.pdf
 */
export function generateApprovedDocumentFilename(input: ApprovedDocumentFilenameInput): string {
  const parts: string[] = [];

  // 1. Sub-category (proper casing via getSubCategoryLabel)
  if (input.documentSubCategory) {
    const label = getSubCategoryLabel(input.documentSubCategory);
    parts.push(label);
  }

  // 2. Document date (YYYY-MM-DD format)
  const formattedDate = formatDateForFilename(input.documentDate);
  if (formattedDate) {
    parts.push(formattedDate);
  }

  // 3. Contact name - vendor for AP, customer for AR (shortened and sanitized)
  if (input.contactName) {
    const shortened = shortenCompanyName(input.contactName);
    const sanitizedContact = sanitizeForFilename(shortened, 40);
    if (sanitizedContact) {
      parts.push(sanitizedContact);
    }
  }

  // 4. Document number (sanitized)
  if (input.documentNumber) {
    const sanitizedDocNumber = sanitizeForFilename(input.documentNumber, 30);
    if (sanitizedDocNumber) {
      parts.push(sanitizedDocNumber);
    }
  }

  // 5. Currency and Amount (only if amount != 0)
  const numericAmount =
    typeof input.totalAmount === 'object'
      ? parseFloat(input.totalAmount.toString())
      : parseFloat(String(input.totalAmount));

  if (!isNaN(numericAmount) && numericAmount !== 0) {
    const formattedAmount = formatAmountForFilename(input.totalAmount);
    if (formattedAmount) {
      parts.push(`${input.currency} ${formattedAmount}`);
    }
  }

  // Join parts with underscores and add extension
  const baseName = parts.join('_');
  const extension = input.originalExtension.startsWith('.')
    ? input.originalExtension
    : `.${input.originalExtension}`;

  return `${baseName}${extension}`;
}

/**
 * Extract file extension from a filename or storage key
 */
export function getFileExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Build new storage key for an approved document
 * Preserves the tenant/company/document directory structure
 */
export function buildApprovedStorageKey(currentStorageKey: string, newFilename: string): string {
  // Extract directory path from current key
  // e.g., "tenant-123/companies/comp-456/documents/doc-789/original.pdf"
  // -> "tenant-123/companies/comp-456/documents/doc-789/"
  const lastSlashIndex = currentStorageKey.lastIndexOf('/');

  if (lastSlashIndex === -1) {
    // No directory structure, just use new filename
    return newFilename;
  }

  const directory = currentStorageKey.substring(0, lastSlashIndex + 1);
  return `${directory}${newFilename}`;
}

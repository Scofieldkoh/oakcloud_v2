import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Prisma } from '@/generated/prisma';

type Decimal = Prisma.Decimal;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to convert Decimal to number
export function toNumber(value: Decimal | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value);
  // Decimal type has toString() method
  return parseFloat(value.toString());
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a number as currency with proper symbol.
 * Singapore Dollar (SGD) is displayed as "S$" (e.g., "S$1,234.56")
 * Other currencies use their standard ISO symbols.
 */
export function formatCurrency(
  amount: Decimal | number | string | null | undefined,
  currency: string = 'SGD'
): string {
  const num = toNumber(amount);
  if (num === null) return '-';

  // Format number with proper grouping and decimals
  const formatted = new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(num));

  // Get currency symbol - use S$ for SGD, otherwise use standard symbols
  const symbol = currency === 'SGD' ? 'S$' : getCurrencySymbolForFormat(currency);

  // Handle negative numbers with parentheses
  if (num < 0) {
    return `(${symbol}${formatted})`;
  }

  return `${symbol}${formatted}`;
}

/**
 * Get currency symbol for formatting.
 * Returns common symbols for major currencies, falls back to currency code.
 */
function getCurrencySymbolForFormat(currency: string): string {
  const symbols: Record<string, string> = {
    SGD: 'S$',
    USD: 'US$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
    HKD: 'HK$',
    AUD: 'A$',
    NZD: 'NZ$',
    CAD: 'C$',
    CHF: 'CHF ',
    MYR: 'RM',
    THB: '฿',
    IDR: 'Rp',
    PHP: '₱',
    INR: '₹',
    KRW: '₩',
    TWD: 'NT$',
    VND: '₫',
  };
  return symbols[currency] || `${currency} `;
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('en-SG').format(num);
}

export function formatPercentage(value: Decimal | number | string | null | undefined): string {
  const num = toNumber(value);
  if (num === null) return '-';
  return `${num.toFixed(2)}%`;
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function parseUEN(uen: string): {
  isValid: boolean;
  type?: 'business' | 'local_company' | 'others';
  yearOfRegistration?: string;
} {
  const businessPattern = /^\d{8}[A-Z]$/;
  const localCompanyPattern = /^\d{9}[A-Z]$/;
  const othersPattern = /^[A-Z]\d{2}[A-Z]{2}\d{4}[A-Z]$/;

  if (businessPattern.test(uen)) {
    return {
      isValid: true,
      type: 'business',
      yearOfRegistration: uen.substring(0, 4),
    };
  }

  if (localCompanyPattern.test(uen)) {
    return {
      isValid: true,
      type: 'local_company',
      yearOfRegistration: `20${uen.substring(0, 2)}`,
    };
  }

  if (othersPattern.test(uen)) {
    return {
      isValid: true,
      type: 'others',
      yearOfRegistration: `20${uen.substring(1, 3)}`,
    };
  }

  return { isValid: false };
}

export function getComplianceStatus(
  lastFilingDate: Date | null,
  financialYearEndMonth: number | null
): 'compliant' | 'due_soon' | 'overdue' | 'unknown' {
  if (!financialYearEndMonth) return 'unknown';

  const now = new Date();
  const currentYear = now.getFullYear();
  const fyeMonth = financialYearEndMonth - 1;

  let fyeDate = new Date(currentYear, fyeMonth, 1);
  fyeDate.setMonth(fyeDate.getMonth() + 1);
  fyeDate.setDate(0);

  if (fyeDate > now) {
    fyeDate = new Date(currentYear - 1, fyeMonth, 1);
    fyeDate.setMonth(fyeDate.getMonth() + 1);
    fyeDate.setDate(0);
  }

  const arDueDate = new Date(fyeDate);
  arDueDate.setMonth(arDueDate.getMonth() + 7);

  const daysUntilDue = Math.ceil((arDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= 30) return 'due_soon';
  return 'compliant';
}

export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Text Normalization Utilities
// ============================================================================

/**
 * Common acronyms and abbreviations to preserve in uppercase
 */
const PRESERVED_ACRONYMS = new Set([
  // Company suffixes
  'PTE', 'LTD', 'LLC', 'LLP', 'INC', 'CORP', 'CO', 'BHD', 'SDN',
  // Titles
  'CEO', 'CFO', 'COO', 'CTO', 'CIO', 'MD', 'GM', 'VP', 'SVP', 'EVP', 'AVP',
  // Countries/Regions
  'USA', 'UK', 'UAE', 'HK', 'SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'JP', 'KR', 'CN', 'TW', 'AU', 'NZ',
  // ID types
  'NRIC', 'FIN', 'UEN', 'ROC', 'ACRA',
  // Currency
  'SGD', 'USD', 'MYR', 'IDR', 'THB', 'VND', 'PHP', 'JPY', 'KRW', 'CNY', 'TWD', 'AUD', 'NZD', 'EUR', 'GBP', 'HKD',
  // Common business terms
  'IT', 'HR', 'PR', 'IR', 'AI', 'ML', 'IOT', 'API', 'SaaS', 'B2B', 'B2C',
  // Address components
  'BLK', 'APT', 'FL',
]);

/**
 * Words that should remain lowercase (unless at start of string)
 */
const LOWERCASE_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'as',
]);

/**
 * Check if a string is likely already in proper case (mixed case)
 */
function isAlreadyProperCase(str: string): boolean {
  // If string has both upper and lower case letters (not all caps or all lower)
  const hasUpper = /[A-Z]/.test(str);
  const hasLower = /[a-z]/.test(str);
  return hasUpper && hasLower;
}

/**
 * Check if a word is all uppercase
 */
function _isAllCaps(word: string): boolean {
  return word === word.toUpperCase() && /[A-Z]/.test(word);
}

/**
 * Normalize a single word to title case, preserving acronyms
 */
function normalizeWord(word: string, isFirstWord: boolean = false): string {
  // Empty or whitespace
  if (!word.trim()) return word;

  // Preserve if it's a known acronym
  const upperWord = word.toUpperCase();
  if (PRESERVED_ACRONYMS.has(upperWord)) {
    return upperWord;
  }

  // Check for mixed acronym patterns like "S/O" or "D/O" (son of, daughter of)
  if (/^[A-Z]\/[A-Z]$/i.test(word)) {
    return word.toUpperCase();
  }

  // Handle words with apostrophes (e.g., O'BRIEN -> O'Brien)
  if (word.includes("'")) {
    const parts = word.split("'");
    return parts.map((part, idx) => normalizeWord(part, idx === 0 && isFirstWord)).join("'");
  }

  // Handle hyphenated words (e.g., SENG-HUAT -> Seng-Huat)
  if (word.includes('-')) {
    const parts = word.split('-');
    return parts.map((part, idx) => normalizeWord(part, idx === 0 && isFirstWord)).join('-');
  }

  // Keep lowercase words lowercase (unless first word)
  const lowerWord = word.toLowerCase();
  if (!isFirstWord && LOWERCASE_WORDS.has(lowerWord)) {
    return lowerWord;
  }

  // Numbers and special characters - return as-is
  if (!/[a-zA-Z]/.test(word)) {
    return word;
  }

  // Title case: first letter uppercase, rest lowercase
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Normalize text to proper case (title case with acronym preservation)
 *
 * Examples:
 * - "TAN AH KOW" → "Tan Ah Kow"
 * - "ACME PTE LTD" → "Acme Pte Ltd"
 * - "10 ANSON ROAD #20-01" → "10 Anson Road #20-01"
 * - "JOHN S/O DAVID" → "John S/O David"
 * - "O'BRIEN" → "O'Brien"
 * - "SENG-HUAT" → "Seng-Huat"
 */
export function normalizeCase(text: string | null | undefined): string {
  if (!text) return '';

  // If already in proper case (has both upper and lower), return as-is
  if (isAlreadyProperCase(text)) {
    return text;
  }

  // Split by spaces while preserving multiple spaces
  const words = text.split(/(\s+)/);
  let isFirst = true;

  return words.map((segment) => {
    // Preserve whitespace segments
    if (/^\s+$/.test(segment)) {
      return segment;
    }

    const result = normalizeWord(segment, isFirst);
    if (segment.trim()) {
      isFirst = false;
    }
    return result;
  }).join('');
}

/**
 * Normalize text inside parentheses to title case
 * Handles: "(cayman)" -> "(Cayman)", "(ye Jiajin)" -> "(Ye Jiajin)"
 */
function normalizeParentheticalText(text: string): string {
  // Match text inside parentheses and normalize each word
  return text.replace(/\(([^)]+)\)/g, (match, content) => {
    // Normalize each word inside parentheses
    const normalizedContent = content
      .split(/(\s+)/)
      .map((word: string) => {
        if (/^\s+$/.test(word)) return word; // Preserve whitespace
        if (!word) return word;
        // Title case: first letter upper, rest lower
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join('');
    return `(${normalizedContent})`;
  });
}

/**
 * Normalize a person's name
 * Handles common name patterns and preserves cultural naming conventions
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';

  let result = name;

  // If already proper case, still check for parenthetical text that may need normalization
  if (isAlreadyProperCase(name)) {
    // Check for lowercase words inside parentheses like "(ye Jiajin)"
    if (/\([^)]*[a-z]{2,}/.test(name)) {
      result = normalizeParentheticalText(name);
    }
    return result;
  }

  // Normalize the whole string, then fix parenthetical text
  result = normalizeCase(name);

  // Also normalize parenthetical text which may have become lowercase
  if (/\([^)]+\)/.test(result)) {
    result = normalizeParentheticalText(result);
  }

  return result;
}

/**
 * Normalize a company name, preserving legal suffixes
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return '';

  let result = name;

  // If already proper case, still check for parenthetical text that may need normalization
  if (isAlreadyProperCase(name)) {
    // Check for lowercase words inside parentheses like "(cayman)"
    if (/\([^)]*[a-z]{2,}/.test(name)) {
      result = normalizeParentheticalText(name);
    }
    return result;
  }

  // Normalize the whole string, then fix parenthetical text
  result = normalizeCase(name);

  // Also normalize parenthetical text which may have become lowercase
  if (/\([^)]+\)/.test(result)) {
    result = normalizeParentheticalText(result);
  }

  return result;
}

/**
 * Normalize an address
 * Handles unit numbers, building names, and street names
 */
export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return '';

  // If already proper case, return as-is
  if (isAlreadyProperCase(address)) {
    return address;
  }

  // Split address and normalize each part
  // Preserve patterns like #01-02, unit numbers, postal codes
  const parts = address.split(/(\s+|(?<=#)\d+-\d+|(?<=\s)\d{6}(?=\s|$))/);

  let isFirst = true;
  return parts.map((part) => {
    // Preserve whitespace
    if (/^\s+$/.test(part)) {
      return part;
    }

    // Preserve unit numbers like #01-02
    if (/^#?\d+-\d+$/.test(part)) {
      return part;
    }

    // Preserve postal codes (6 digits)
    if (/^\d{6}$/.test(part)) {
      return part;
    }

    const result = normalizeWord(part, isFirst);
    if (part.trim()) {
      isFirst = false;
    }
    return result;
  }).join('');
}

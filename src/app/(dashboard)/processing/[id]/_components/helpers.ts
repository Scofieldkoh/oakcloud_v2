/** Display configs, formatters and types shared by the processing document detail page. */

import type { PipelineStatus, DuplicateStatus, RevisionStatus } from '@/generated/prisma';
import { CATEGORY_LABELS } from '@/lib/document-categories';
import { SUPPORTED_CURRENCIES } from '@/lib/validations/exchange-rate';
import { MISTRAL_OCR_MODEL_ID } from '@/lib/ocr/constants';
import { AI_MODELS } from '@/lib/ai/models';
import type { AIModel } from '@/lib/ai/types';

// Status display configs
export const pipelineStatusConfig: Record<
  PipelineStatus,
  { label: string; color: string; bgColor: string }
> = {
  UPLOADED: { label: 'Uploaded', color: 'text-text-secondary', bgColor: 'bg-background-tertiary' },
  QUEUED: { label: 'Queued', color: 'text-status-info', bgColor: 'bg-status-info/10' },
  PROCESSING: { label: 'Processing', color: 'text-status-info', bgColor: 'bg-status-info/10' },
  SPLIT_PENDING: { label: 'Split Pending', color: 'text-status-warning', bgColor: 'bg-status-warning/10' },
  SPLIT_DONE: { label: 'Split Done', color: 'text-status-success', bgColor: 'bg-status-success/10' },
  EXTRACTION_DONE: { label: 'Extracted', color: 'text-status-success', bgColor: 'bg-status-success/10' },
  FAILED_RETRYABLE: { label: 'Failed (Retry)', color: 'text-status-warning', bgColor: 'bg-status-warning/10' },
  FAILED_PERMANENT: { label: 'Failed', color: 'text-status-error', bgColor: 'bg-status-error/10' },
  DEAD_LETTER: { label: 'Dead Letter', color: 'text-status-error', bgColor: 'bg-status-error/10' },
};

export function getBatchProcessingProvider(modelId: string): 'mistral' | 'openai' | null {
  if (modelId === MISTRAL_OCR_MODEL_ID) {
    return 'mistral';
  }

  const modelConfig = AI_MODELS[modelId as AIModel];
  return modelConfig?.provider === 'openai' ? 'openai' : null;
}

export const duplicateStatusConfig: Record<
  DuplicateStatus,
  { label: string; color: string; bgColor: string }
> = {
  NONE: { label: 'Not Checked', color: 'text-text-muted', bgColor: 'bg-background-tertiary' },
  SUSPECTED: { label: 'Suspected Duplicate', color: 'text-status-warning', bgColor: 'bg-status-warning/10' },
  CONFIRMED: { label: 'Confirmed Duplicate', color: 'text-status-error', bgColor: 'bg-status-error/10' },
  REJECTED: { label: 'Not Duplicate', color: 'text-status-success', bgColor: 'bg-status-success/10' },
};

export const revisionStatusConfig: Record<
  RevisionStatus,
  { label: string; color: string; bgColor: string }
> = {
  DRAFT: { label: 'Draft', color: 'text-status-warning', bgColor: 'bg-status-warning/10' },
  APPROVED: { label: 'Approved', color: 'text-status-success', bgColor: 'bg-status-success/10' },
  SUPERSEDED: { label: 'Superseded', color: 'text-text-muted', bgColor: 'bg-background-tertiary' },
};

// Use category labels from our utility
export const categoryLabels = CATEGORY_LABELS;

// Use all supported currencies from exchange rate validation (spread to convert readonly to mutable array)
export const currencyOptions = [...SUPPORTED_CURRENCIES];

// GST tax codes with their rates
export const gstTaxCodes = [
  { code: 'SR', label: 'SR (9%)', rate: 0.09 },
  { code: 'SR8', label: 'SR (8%)', rate: 0.08 },
  { code: 'SR7', label: 'SR (7%)', rate: 0.07 },
  { code: 'ZR', label: 'ZR (0%)', rate: 0 },
  { code: 'ES', label: 'ES (Exempt)', rate: 0 },
  { code: 'OS', label: 'OS (Out of Scope)', rate: 0 },
  { code: 'NA', label: 'N/A', rate: 0 },
];

// Helper to get GST rate from tax code
export function getGstRate(taxCode: string | null | undefined): number {
  if (!taxCode) return 0;
  const gstCode = gstTaxCodes.find((g) => g.code === taxCode);
  return gstCode?.rate ?? 0;
}

// Chart of accounts is now fetched from database via useAccountsForSelect hook

// Bounding box type for highlight integration
export interface BoundingBox {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
  fieldKey?: string;
}

// Highlight colors - mild pastel shades for cleaner appearance
export const HIGHLIGHT_COLOR_DEFAULT = '#93C5FD'; // Pastel blue - subtle highlight
export const HIGHLIGHT_COLOR_FOCUS = '#FCD34D'; // Pastel yellow/gold - focused field

export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Currency symbols mapping - SGD displayed as "S$"
export const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: 'S$',
  USD: 'US$',
  EUR: 'â‚¬',
  GBP: ' £',
  JPY: ' ¥',
  CNY: ' ¥',
  HKD: 'HK$',
  AUD: 'A$',
  NZD: 'NZ$',
  CAD: 'C$',
  CHF: 'CHF ',
  MYR: 'RM',
  THB: 'à¸¿',
  IDR: 'Rp',
  PHP: 'â‚±',
  INR: 'â‚¹',
  KRW: 'â‚©',
  TWD: 'NT$',
  VND: 'â‚«',
};

export function formatCurrency(amount: string | number | null, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return '-';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '-';

  const isNegative = num < 0;
  const absNum = Math.abs(num);

  const formatted = new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absNum);

  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;

  return isNegative ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
}

export function formatNumber(value: string | number | null, decimals: number = 2): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';

  const isNegative = num < 0;
  const absNum = Math.abs(num);

  const formatted = absNum.toLocaleString('en-SG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return isNegative ? `(${formatted})` : formatted;
}

// Type for validation issues
export interface ValidationIssue {
  code: string;
  severity: 'WARN' | 'ERROR';
  message: string;
  field?: string;
}

// Evidence type from backend
export interface FieldEvidence {
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  containerPageNumber?: number;
  confidence?: number;
}

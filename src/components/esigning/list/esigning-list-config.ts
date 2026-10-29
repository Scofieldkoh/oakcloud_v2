import type { EsigningEnvelopeListItem } from '@/types/esigning';

/** Tabs, filters, columns and search helpers for the e-signing envelope list. */

export type StatusFilter =
  | 'DRAFT'
  | 'SENT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'VOIDED'
  | 'DECLINED'
  | 'EXPIRED';

export type TabKey = 'all' | 'attention' | 'waiting' | 'completed' | 'voided';

export const TAB_LABELS: Record<TabKey, string> = {
  all: 'All',
  attention: 'Needs Attention',
  waiting: 'Waiting',
  completed: 'Completed',
  voided: 'Voided / Expired',
};

export const TAB_LABELS_SHORT: Record<TabKey, string> = {
  all: 'All',
  attention: 'Attention',
  waiting: 'Waiting',
  completed: 'Done',
  voided: 'Voided',
};

export function getEnvelopeTitleFromFile(file: File): string {
  return file.name.replace(/\.(pdf|docx?|doc)$/i, '') || 'New Envelope';
}

export const TAB_STATUSES: Record<TabKey, StatusFilter[]> = {
  all: [],
  attention: ['DRAFT', 'DECLINED'],
  waiting: ['SENT', 'IN_PROGRESS'],
  completed: ['COMPLETED'],
  voided: ['VOIDED', 'EXPIRED'],
};

export type ViewMode = 'table' | 'card';
export type RecipientStatusFilter = 'QUEUED' | 'NOTIFIED' | 'VIEWED' | 'SIGNED' | 'DECLINED';
export type SigningOrderFilter = 'PARALLEL' | 'SEQUENTIAL' | 'MIXED';
export type EnvelopeSortBy =
  | 'status'
  | 'title'
  | 'companyName'
  | 'details'
  | 'updatedAt';

export const CARD_STATUS_BORDER_CLASS: Record<StatusFilter, string> = {
  DRAFT: 'border-t-slate-400',
  SENT: 'border-t-blue-400',
  IN_PROGRESS: 'border-t-amber-400',
  COMPLETED: 'border-t-emerald-400',
  VOIDED: 'border-t-slate-400',
  DECLINED: 'border-t-rose-400',
  EXPIRED: 'border-t-orange-400',
};

export const ESIGNING_COLUMN_WIDTH_PREF_KEY = 'esigning:list:columns:v1';
export const ESIGNING_TABLE_COLUMNS = [
  'status',
  'envelope',
  'company',
  'details',
  'updated',
] as const;
export type EsigningTableColumnId = (typeof ESIGNING_TABLE_COLUMNS)[number];

export const DEFAULT_ESIGNING_COLUMN_WIDTHS: Record<EsigningTableColumnId, number> = {
  status: 160,
  envelope: 578,
  company: 411,
  details: 224,
  updated: 188,
};

export const ESIGNING_TABLE_COLUMN_LABELS: Record<EsigningTableColumnId, string> = {
  status: 'Status',
  envelope: 'Envelope name',
  company: 'Company',
  details: 'Details',
  updated: 'Last updated',
};

export const ESIGNING_TABLE_SORT_FIELDS: Record<EsigningTableColumnId, EnvelopeSortBy> = {
  status: 'status',
  envelope: 'title',
  company: 'companyName',
  details: 'details',
  updated: 'updatedAt',
};

export interface EnvelopeAdvancedFilters {
  status: StatusFilter | '';
  documentName: string;
  recipientQuery: string;
  recipientStatus: RecipientStatusFilter | '';
  signingOrder: SigningOrderFilter | '';
  createdFrom: string;
  createdTo: string;
  sentFrom: string;
  sentTo: string;
  completedFrom: string;
  completedTo: string;
  createdBy: 'all' | 'me';
}

export const EMPTY_ADVANCED_FILTERS: EnvelopeAdvancedFilters = {
  status: '',
  documentName: '',
  recipientQuery: '',
  recipientStatus: '',
  signingOrder: '',
  createdFrom: '',
  createdTo: '',
  sentFrom: '',
  sentTo: '',
  completedFrom: '',
  completedTo: '',
  createdBy: 'all',
};

export const STATUS_TO_TAB: Record<StatusFilter, TabKey> = {
  DRAFT: 'attention',
  SENT: 'waiting',
  IN_PROGRESS: 'waiting',
  COMPLETED: 'completed',
  VOIDED: 'voided',
  DECLINED: 'attention',
  EXPIRED: 'voided',
};

export const ENVELOPE_STATUS_LABELS: Record<StatusFilter, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  VOIDED: 'Voided',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
};

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatusFilter, string> = {
  QUEUED: 'Pending',
  NOTIFIED: 'Sent',
  VIEWED: 'Viewed',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
};

export const SIGNING_ORDER_FILTER_LABELS: Record<SigningOrderFilter, string> = {
  PARALLEL: 'Parallel signing',
  SEQUENTIAL: 'Sequential signing',
  MIXED: 'Mixed signing',
};

export function formatFilterDateRange(from: string, to: string): string {
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return '';
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getEnvelopeSearchMatchContext(
  envelope: EsigningEnvelopeListItem,
  query: string
): string | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return null;

  if (envelope.title.toLocaleLowerCase().includes(needle)) {
    return `Matched envelope: ${envelope.title}`;
  }

  if (envelope.companyName?.toLocaleLowerCase().includes(needle)) {
    return `Matched company: ${envelope.companyName}`;
  }

  const matchedDocument = envelope.documents.find(
    (document) =>
      document.fileName.toLocaleLowerCase().includes(needle)
      || document.originalFileName?.toLocaleLowerCase().includes(needle)
  );
  if (matchedDocument) {
    const matchedName =
      matchedDocument.originalFileName?.toLocaleLowerCase().includes(needle)
        ? matchedDocument.originalFileName
        : matchedDocument.fileName;
    return `Matched document: ${matchedName}`;
  }

  const matchedRecipient = envelope.recipients.find((recipient) =>
    recipient.name.toLocaleLowerCase().includes(needle)
  );
  if (matchedRecipient) {
    return `Matched recipient: ${matchedRecipient.name}`;
  }

  const matchedEmail = envelope.recipients.find((recipient) =>
    recipient.email?.toLocaleLowerCase().includes(needle)
  );
  if (matchedEmail?.email) {
    return `Matched email: ${matchedEmail.email}`;
  }

  return 'Matched search';
}

export function isStatusDuplicatedByTab(status: StatusFilter, tab: TabKey): boolean {
  const tabStatuses = TAB_STATUSES[tab];
  return tabStatuses.length === 1 && tabStatuses[0] === status;
}

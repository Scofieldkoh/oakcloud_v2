'use client';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ChevronLeft,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  GripVertical,
  History,
  Inbox,
  MousePointerClick,
  Paperclip,
  PenLine,
  RefreshCw,
  Tag,
  Trash2,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import { FilterChip } from '@/components/ui/filter-chip';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useUpsertUserPreference, useUserPreference } from '@/hooks/use-user-preferences';
import {
  useDeleteFormDraft,
  useDeleteFormResponse,
  useExtendFormDraftExpiry,
  useForm,
  useFormDraftAuditLogs,
  useFormResponses,
  useGenerateFormDraftResumeLink,
  useUpdateFormResponseTags,
  type FormResponsesResult,
} from '@/hooks/use-forms';
import {
  RESPONSE_COLUMN_STATUS_ID,
  RESPONSE_COLUMN_SUBMITTED_ID,
  clampResponseColumnWidth,
  formatChoiceAnswer,
  hasUnresolvedFormSubmissionAiWarning,
  isSummaryEligibleFieldType,
  normalizeResponseColumnOrder,
  parseObject,
  parseFormSubmissionAiReview,
  parseFormResponseTableSettings,
  sanitizeResponseColumnWidths,
} from '@/lib/form-utils';
import { copyTextToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZE = 20;
const DRAFT_COLUMN_CODE_ID = '__draft_code';
const DRAFT_COLUMN_SAVED_ID = '__draft_saved';
const DRAFT_COLUMN_EXPIRES_ID = '__draft_expires';
const DRAFT_COLUMN_LOCALE_ID = '__draft_locale';
const SUBMISSION_ATTACHMENTS_COLUMN_ID = '__submission_attachments';
const SUBMISSION_TAGS_COLUMN_ID = '__submission_tags';
const DRAFT_ATTACHMENTS_COLUMN_ID = '__draft_attachments';
const SUBMISSION_SELECT_COLUMN_WIDTH = 72;
const SUBMISSION_OPEN_COLUMN_WIDTH = 56;
const SUBMISSION_ACTION_COLUMN_WIDTH = 64;
const DRAFT_SELECT_COLUMN_WIDTH = 72;
const DRAFT_OPEN_COLUMN_WIDTH = 56;
const DRAFT_ACTION_COLUMN_WIDTH = 128;
const DEFAULT_SUBMISSION_SORT_COLUMN_ID = RESPONSE_COLUMN_SUBMITTED_ID;
const DEFAULT_DRAFT_SORT_COLUMN_ID = DRAFT_COLUMN_SAVED_ID;

type SubmissionSortOrder = 'asc' | 'desc';
type SubmissionFilters = Record<string, string>;

type SubmissionItem = FormResponsesResult['submissions'][number];
type DraftItem = FormResponsesResult['drafts'][number];

type ResponseTableKind = 'submissions' | 'drafts';
type ExportScope = 'all' | 'filtered' | 'selected';
type ExportStatus = 'ALL' | 'COMPLETED' | 'PARTIAL' | 'SPAM' | 'DRAFT' | 'ALL_WITH_DRAFTS';

type ResponseColumnDef = {
  id: string;
  kind:
    | 'submitted'
    | 'status'
    | 'field'
    | 'draftCode'
    | 'draftSaved'
    | 'draftExpires'
    | 'draftLocale'
    | 'attachments'
    | 'tags';
  label: string;
  fieldKey?: string;
  fieldType?: string;
  minWidth: number;
  defaultWidth: number;
};

type ResponseTableLayout = {
  columnOrder: string[];
  columnWidths: Record<string, number>;
};

type ResponseTablePreference = Partial<{
  submissions: Partial<ResponseTableLayout>;
  drafts: Partial<ResponseTableLayout>;
}>;

type AttachmentDialogState = {
  title: string;
  description: string;
  attachments: SubmissionItem['attachments'];
  source: {
    type: 'submission' | 'draft';
    id: string;
  };
} | null;

type TagDialogState = {
  submission: SubmissionItem;
  input: string;
} | null;

const EXPORT_STATUS_OPTIONS: Array<{ value: ExportStatus; label: string }> = [
  { value: 'ALL', label: 'All submitted' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'ALL_WITH_DRAFTS', label: 'Submitted + drafts' },
];

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getExportDateRange(value?: DatePickerValue): { fromDate?: string; toDate?: string } {
  if (!value) return {};

  if (value.mode === 'single' && value.date) {
    const from = new Date(value.date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(value.date);
    to.setHours(23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  if (value.mode === 'range' && value.range?.from) {
    const from = new Date(value.range.from);
    from.setHours(0, 0, 0, 0);
    const to = new Date(value.range.to || value.range.from);
    to.setHours(23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  return {};
}

function getDownloadFileName(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  return fallback;
}

function toDateTimeLocalInputValue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toAnswerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeResponseTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 48);
}

function normalizeResponseTags(values: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const value of values) {
    const tag = normalizeResponseTag(value);
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tags.push(tag);
  }

  return tags.slice(0, 20);
}

function parseTagInput(value: string): string[] {
  return normalizeResponseTags(value.split(','));
}

function getResponseTags(metadata: unknown): string[] {
  const root = parseObject(metadata);
  if (!root || !Array.isArray(root.responseTags)) return [];

  return normalizeResponseTags(root.responseTags.filter((tag): tag is string => typeof tag === 'string'));
}

const SUBMISSION_STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'bg-green-500/10 text-green-700 dark:text-green-400',
  PARTIAL:   'bg-status-warning/10 text-status-warning',
  SPAM:      'bg-red-500/10 text-red-700 dark:text-red-400',
};

function SubmissionStatusBadge({ status }: { status: string }) {
  const cls = SUBMISSION_STATUS_BADGE[status] ?? 'bg-background-tertiary text-text-muted';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function formatLocaleValue(value: unknown): string {
  if (typeof value !== 'string') return '-';
  const trimmed = value.trim();
  return trimmed || '-';
}

function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultFieldColumnWidth(fieldType: string): number {
  if (fieldType === 'LONG_TEXT') return 280;
  if (fieldType === 'FILE_UPLOAD') return 220;
  return 180;
}

function formatSummaryCellValue(fieldType: string, value: unknown): string {
  if (value === null || value === undefined) return '-';

  if (fieldType === 'SIGNATURE') {
    return typeof value === 'string' && value.trim().length > 0 ? 'Signed' : '-';
  }

  if (fieldType === 'FILE_UPLOAD') {
    if (Array.isArray(value)) {
      return value.length > 0 ? `${value.length} file${value.length > 1 ? 's' : ''}` : '-';
    }
    return typeof value === 'string' && value.trim().length > 0 ? value : '-';
  }

  if (fieldType === 'SINGLE_CHOICE' || fieldType === 'MULTIPLE_CHOICE') {
    const choiceText = formatChoiceAnswer(value);
    return choiceText || '-';
  }

  if (Array.isArray(value)) {
    const text = value.map((item) => String(item)).join(', ').trim();
    return text || '-';
  }

  if (typeof value === 'object') {
    try {
      const text = JSON.stringify(value);
      return text.length > 0 ? text : '-';
    } catch {
      return '-';
    }
  }

  const text = String(value).trim();
  return text || '-';
}

function renderDraftCell(draft: DraftItem, column: ResponseColumnDef): string {
  if (column.kind === 'draftCode') return draft.code;
  if (column.kind === 'draftSaved') return formatDate(draft.lastSavedAt);
  if (column.kind === 'draftExpires') return formatDate(draft.expiresAt);
  if (column.kind === 'draftLocale') {
    const metadata = toAnswerRecord(draft.metadata);
    return formatLocaleValue(metadata.locale);
  }

  const answers = toAnswerRecord(draft.answers);
  const value = answers[column.fieldKey || ''];
  return formatSummaryCellValue(column.fieldType || 'SHORT_TEXT', value);
}

function compareDraftRows(
  left: DraftItem,
  right: DraftItem,
  draftSortBy: string,
  draftSortOrder: SubmissionSortOrder,
  orderedDraftColumns: ResponseColumnDef[]
): number {
  const direction = draftSortOrder === 'asc' ? 1 : -1;

  if (draftSortBy === DRAFT_COLUMN_SAVED_ID) {
    return (new Date(left.lastSavedAt).getTime() - new Date(right.lastSavedAt).getTime()) * direction;
  }

  if (draftSortBy === DRAFT_COLUMN_EXPIRES_ID) {
    return (new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime()) * direction;
  }

  if (draftSortBy === DRAFT_ATTACHMENTS_COLUMN_ID) {
    return (left.uploadCount - right.uploadCount) * direction;
  }

  const sortColumn = orderedDraftColumns.find((column) => column.id === draftSortBy);
  const leftValue = sortColumn ? renderDraftCell(left, sortColumn) : '';
  const rightValue = sortColumn ? renderDraftCell(right, sortColumn) : '';
  const comparison = leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' });

  if (comparison !== 0) {
    return comparison * direction;
  }

  return new Date(right.lastSavedAt).getTime() - new Date(left.lastSavedAt).getTime();
}

function parseResponseTablePreference(value: unknown): ResponseTablePreference {
  const root = parseObject(value);
  if (!root) return {};

  const parseLayout = (candidate: unknown): Partial<ResponseTableLayout> | undefined => {
    const record = parseObject(candidate);
    if (!record) return undefined;

    const columnOrder = Array.isArray(record.columnOrder)
      ? record.columnOrder.filter((item): item is string => typeof item === 'string')
      : [];

    const rawWidths = parseObject(record.columnWidths);
    const columnWidths: Record<string, number> = {};
    if (rawWidths) {
      for (const [key, width] of Object.entries(rawWidths)) {
        if (typeof width !== 'number' || !Number.isFinite(width)) continue;
        columnWidths[key] = width;
      }
    }

    return { columnOrder, columnWidths };
  };

  const submissions = parseLayout(root.submissions);
  const drafts = parseLayout(root.drafts);

  return {
    ...(submissions ? { submissions } : {}),
    ...(drafts ? { drafts } : {}),
  };
}

export default function FormResponsesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { success, error: showError } = useToast();
  const formId = params.id;
  const tablePreferenceKey = useMemo(() => `forms:responses:${formId}:table-layout:v2`, [formId]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [draftPage, setDraftPage] = useState(1);
  const [draftPageSize, setDraftPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [submissionSortBy, setSubmissionSortBy] = useState<string>(DEFAULT_SUBMISSION_SORT_COLUMN_ID);
  const [submissionSortOrder, setSubmissionSortOrder] = useState<SubmissionSortOrder>('desc');
  const [draftSortBy, setDraftSortBy] = useState<string>(DEFAULT_DRAFT_SORT_COLUMN_ID);
  const [draftSortOrder, setDraftSortOrder] = useState<SubmissionSortOrder>('desc');
  const [submissionFilters, setSubmissionFilters] = useState<SubmissionFilters>({});
  const [draftFilters, setDraftFilters] = useState<SubmissionFilters>({});
  const [submissionColumnOrder, setSubmissionColumnOrder] = useState<string[]>([]);
  const [submissionColumnWidths, setSubmissionColumnWidths] = useState<Record<string, number>>({});
  const [draggedSubmissionColumnId, setDraggedSubmissionColumnId] = useState<string | null>(null);
  const [draftColumnOrder, setDraftColumnOrder] = useState<string[]>([]);
  const [draftColumnWidths, setDraftColumnWidths] = useState<Record<string, number>>({});
  const [draggedDraftColumnId, setDraggedDraftColumnId] = useState<string | null>(null);
  const [submissionToDelete, setSubmissionToDelete] = useState<SubmissionItem | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<DraftItem | null>(null);
  const [draftToExtend, setDraftToExtend] = useState<DraftItem | null>(null);
  const [draftAuditTarget, setDraftAuditTarget] = useState<DraftItem | null>(null);
  const [draftExpiryInput, setDraftExpiryInput] = useState('');
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<Set<string>>(new Set());
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkDraftDeleteOpen, setIsBulkDraftDeleteOpen] = useState(false);
  const [isBulkDraftDeleting, setIsBulkDraftDeleting] = useState(false);
  const [attachmentDialog, setAttachmentDialog] = useState<AttachmentDialogState>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [exportStatus, setExportStatus] = useState<ExportStatus>('ALL');
  const [exportDateRange, setExportDateRange] = useState<DatePickerValue | undefined>(undefined);
  const [exportIncludeTagsInput, setExportIncludeTagsInput] = useState('');
  const [exportExcludeTagsInput, setExportExcludeTagsInput] = useState('');
  const [tagDialog, setTagDialog] = useState<TagDialogState>(null);

  const submissionColumnOrderRef = useRef<string[]>([]);
  const submissionColumnWidthsRef = useRef<Record<string, number>>({});
  const draftColumnOrderRef = useRef<string[]>([]);
  const draftColumnWidthsRef = useRef<Record<string, number>>({});
  const tablePreferenceRef = useRef<ResponseTablePreference>({});
  const deferredSubmissionFilters = useDeferredValue(submissionFilters);

  const {
    data: form,
    isLoading: isFormLoading,
    isFetching: isFormFetching,
    error: formError,
    refetch: refetchForm,
  } = useForm(formId);
  const {
    data,
    isLoading,
    isFetching: isResponsesFetching,
    error,
    refetch: refetchResponses,
  } = useFormResponses(formId, {
    page,
    limit: pageSize,
    draftPage,
    draftLimit: draftPageSize,
    submissionSortBy,
    submissionSortOrder,
    submissionFilters: deferredSubmissionFilters,
  });
  const deleteResponseMutation = useDeleteFormResponse(formId);
  const updateResponseTagsMutation = useUpdateFormResponseTags(formId);
  const deleteDraftMutation = useDeleteFormDraft(formId);
  const generateDraftResumeLinkMutation = useGenerateFormDraftResumeLink(formId);
  const extendDraftExpiryMutation = useExtendFormDraftExpiry(formId);
  const {
    data: draftAuditLogs,
    isLoading: isDraftAuditLoading,
    error: draftAuditError,
  } = useFormDraftAuditLogs(formId, draftAuditTarget?.id || null, !!draftAuditTarget);
  const { data: tablePreferenceData } = useUserPreference<ResponseTablePreference>(tablePreferenceKey, {
    enabled: !!formId,
  });
  const saveTablePreference = useUpsertUserPreference<ResponseTablePreference>();

  useEffect(() => {
    submissionColumnOrderRef.current = submissionColumnOrder;
  }, [submissionColumnOrder]);

  useEffect(() => {
    submissionColumnWidthsRef.current = submissionColumnWidths;
  }, [submissionColumnWidths]);

  useEffect(() => {
    draftColumnOrderRef.current = draftColumnOrder;
  }, [draftColumnOrder]);

  useEffect(() => {
    draftColumnWidthsRef.current = draftColumnWidths;
  }, [draftColumnWidths]);

  const conversionRate = useMemo(() => {
    if (!form || form.viewsCount === 0) return 0;
    return Number(((form.submissionsCount / form.viewsCount) * 100).toFixed(1));
  }, [form]);

  const responseTableSettings = useMemo(
    () => parseFormResponseTableSettings(form?.settings),
    [form?.settings]
  );
  const parsedTablePreference = useMemo(
    () => parseResponseTablePreference(tablePreferenceData?.value),
    [tablePreferenceData?.value]
  );

  useEffect(() => {
    tablePreferenceRef.current = parsedTablePreference;
  }, [parsedTablePreference]);

  const summaryColumns = useMemo(() => {
    if (!form) return [] as ResponseColumnDef[];

    const fieldByKey = new Map(form.fields.map((field) => [field.key, field]));

    return responseTableSettings.summaryFieldKeys
      .map((fieldKey) => fieldByKey.get(fieldKey))
      .filter((field): field is (typeof form.fields)[number] => !!field && isSummaryEligibleFieldType(field.type))
      .map((field) => ({
        id: field.key,
        kind: 'field' as const,
        label: field.label || field.key,
        fieldKey: field.key,
        fieldType: field.type,
        minWidth: 140,
        defaultWidth: defaultFieldColumnWidth(field.type),
      }));
  }, [form, responseTableSettings.summaryFieldKeys]);

  const submissionColumnMap = useMemo(() => {
    const map = new Map<string, ResponseColumnDef>();

    map.set(RESPONSE_COLUMN_SUBMITTED_ID, {
      id: RESPONSE_COLUMN_SUBMITTED_ID,
      kind: 'submitted',
      label: 'Submitted',
      minWidth: 170,
      defaultWidth: 200,
    });

    for (const column of summaryColumns) {
      map.set(column.id, column);
    }

    map.set(RESPONSE_COLUMN_STATUS_ID, {
      id: RESPONSE_COLUMN_STATUS_ID,
      kind: 'status',
      label: 'Status',
      minWidth: 120,
      defaultWidth: 130,
    });

    map.set(SUBMISSION_TAGS_COLUMN_ID, {
      id: SUBMISSION_TAGS_COLUMN_ID,
      kind: 'tags',
      label: 'Tags',
      minWidth: 160,
      defaultWidth: 190,
    });

    map.set(SUBMISSION_ATTACHMENTS_COLUMN_ID, {
      id: SUBMISSION_ATTACHMENTS_COLUMN_ID,
      kind: 'attachments',
      label: 'Attachments',
      minWidth: 140,
      defaultWidth: 150,
    });

    return map;
  }, [summaryColumns]);

  const draftColumnMap = useMemo(() => {
    const map = new Map<string, ResponseColumnDef>();

    map.set(DRAFT_COLUMN_CODE_ID, {
      id: DRAFT_COLUMN_CODE_ID,
      kind: 'draftCode',
      label: 'Draft ID',
      minWidth: 140,
      defaultWidth: 150,
    });

    map.set(DRAFT_COLUMN_SAVED_ID, {
      id: DRAFT_COLUMN_SAVED_ID,
      kind: 'draftSaved',
      label: 'Last saved',
      minWidth: 170,
      defaultWidth: 180,
    });

    map.set(DRAFT_COLUMN_EXPIRES_ID, {
      id: DRAFT_COLUMN_EXPIRES_ID,
      kind: 'draftExpires',
      label: 'Expires',
      minWidth: 170,
      defaultWidth: 180,
    });

    map.set(DRAFT_COLUMN_LOCALE_ID, {
      id: DRAFT_COLUMN_LOCALE_ID,
      kind: 'draftLocale',
      label: 'Locale',
      minWidth: 120,
      defaultWidth: 140,
    });

    for (const column of summaryColumns) {
      map.set(column.id, column);
    }

    map.set(DRAFT_ATTACHMENTS_COLUMN_ID, {
      id: DRAFT_ATTACHMENTS_COLUMN_ID,
      kind: 'attachments',
      label: 'Attachments',
      minWidth: 140,
      defaultWidth: 150,
    });

    return map;
  }, [summaryColumns]);

  const submissionBaseColumnIds = useMemo(() => Array.from(submissionColumnMap.keys()), [submissionColumnMap]);
  const submissionBaseColumnSignature = useMemo(
    () => submissionBaseColumnIds.join('|'),
    [submissionBaseColumnIds]
  );
  const draftBaseColumnIds = useMemo(() => Array.from(draftColumnMap.keys()), [draftColumnMap]);
  const draftBaseColumnSignature = useMemo(() => draftBaseColumnIds.join('|'), [draftBaseColumnIds]);

  useEffect(() => {
    if (!form) return;

    const nextSubmissionOrder = normalizeResponseColumnOrder(
      submissionBaseColumnIds,
      parsedTablePreference.submissions?.columnOrder ?? responseTableSettings.columnOrder
    );
    const nextSubmissionWidths = sanitizeResponseColumnWidths(
      parsedTablePreference.submissions?.columnWidths ?? responseTableSettings.columnWidths,
      submissionBaseColumnIds
    );

    const nextDraftOrder = normalizeResponseColumnOrder(
      draftBaseColumnIds,
      parsedTablePreference.drafts?.columnOrder ?? []
    );
    const nextDraftWidths = sanitizeResponseColumnWidths(
      parsedTablePreference.drafts?.columnWidths ?? {},
      draftBaseColumnIds
    );

    setSubmissionColumnOrder(nextSubmissionOrder);
    setSubmissionColumnWidths(nextSubmissionWidths);
    setDraftColumnOrder(nextDraftOrder);
    setDraftColumnWidths(nextDraftWidths);
  }, [
    draftBaseColumnIds,
    draftBaseColumnSignature,
    form,
    parsedTablePreference,
    responseTableSettings.columnOrder,
    responseTableSettings.columnWidths,
    submissionBaseColumnIds,
    submissionBaseColumnSignature,
  ]);

  const orderedSubmissionColumns = useMemo(() => {
    const resolvedOrder = normalizeResponseColumnOrder(submissionBaseColumnIds, submissionColumnOrder);
    return resolvedOrder
      .map((columnId) => submissionColumnMap.get(columnId))
      .filter((column): column is ResponseColumnDef => !!column);
  }, [submissionBaseColumnIds, submissionColumnOrder, submissionColumnMap]);

  const orderedDraftColumns = useMemo(() => {
    const resolvedOrder = normalizeResponseColumnOrder(draftBaseColumnIds, draftColumnOrder);
    return resolvedOrder
      .map((columnId) => draftColumnMap.get(columnId))
      .filter((column): column is ResponseColumnDef => !!column);
  }, [draftBaseColumnIds, draftColumnOrder, draftColumnMap]);

  const filteredDrafts = useMemo(() => {
    if (!data?.drafts) return [] as DraftItem[];

    const normalizedFilters = Object.entries(draftFilters)
      .map(([columnId, value]) => [columnId, value.trim().toLowerCase()] as const)
      .filter(([, value]) => value.length > 0);

    if (normalizedFilters.length === 0) {
      return [...data.drafts].sort((left, right) => (
        compareDraftRows(left, right, draftSortBy, draftSortOrder, orderedDraftColumns)
      ));
    }

    return data.drafts.filter((draft) => normalizedFilters.every(([columnId, value]) => {
      const column = orderedDraftColumns.find((candidate) => candidate.id === columnId);
      if (!column) {
        return true;
      }

      return renderDraftCell(draft, column).toLowerCase().includes(value);
    })).sort((left, right) => compareDraftRows(left, right, draftSortBy, draftSortOrder, orderedDraftColumns));
  }, [data?.drafts, draftFilters, draftSortBy, draftSortOrder, orderedDraftColumns]);

  const visibleSubmissionIds = useMemo(
    () => data?.submissions.map((submission) => submission.id) ?? [],
    [data?.submissions]
  );
  const visibleDraftIds = useMemo(
    () => filteredDrafts.map((draft) => draft.id),
    [filteredDrafts]
  );
  const isAllVisibleSubmissionsSelected = visibleSubmissionIds.length > 0
    && visibleSubmissionIds.every((id) => selectedSubmissionIds.has(id));
  const isSomeVisibleSubmissionsSelected = visibleSubmissionIds.some((id) => selectedSubmissionIds.has(id));
  const isAllVisibleDraftsSelected = visibleDraftIds.length > 0
    && visibleDraftIds.every((id) => selectedDraftIds.has(id));
  const isSomeVisibleDraftsSelected = visibleDraftIds.some((id) => selectedDraftIds.has(id));
  const hasActiveSubmissionFilters = Object.values(submissionFilters).some((value) => value.trim().length > 0);
  const hasActiveDraftFilters = Object.values(draftFilters).some((value) => value.trim().length > 0);
  const submissionFilterChips = useMemo(() => (
    Object.entries(submissionFilters)
      .map(([columnId, value]) => ({
        columnId,
        label: submissionColumnMap.get(columnId)?.label || columnId,
        value: value.trim(),
      }))
      .filter((chip) => chip.value.length > 0)
  ), [submissionColumnMap, submissionFilters]);
  const draftFilterChips = useMemo(() => (
    Object.entries(draftFilters)
      .map(([columnId, value]) => ({
        columnId,
        label: draftColumnMap.get(columnId)?.label || columnId,
        value: value.trim(),
      }))
      .filter((chip) => chip.value.length > 0)
  ), [draftColumnMap, draftFilters]);

  useEffect(() => {
    setSelectedSubmissionIds((previous) => new Set(
      [...previous].filter((id) => visibleSubmissionIds.includes(id))
    ));
  }, [visibleSubmissionIds]);

  useEffect(() => {
    setSelectedDraftIds((previous) => new Set(
      [...previous].filter((id) => visibleDraftIds.includes(id))
    ));
  }, [visibleDraftIds]);

  const submissionTableWidth = useMemo(
    () => orderedSubmissionColumns.reduce(
      (total, column) => total + (submissionColumnWidths[column.id] ?? column.defaultWidth),
      SUBMISSION_SELECT_COLUMN_WIDTH + SUBMISSION_OPEN_COLUMN_WIDTH + SUBMISSION_ACTION_COLUMN_WIDTH
    ),
    [orderedSubmissionColumns, submissionColumnWidths]
  );
  const draftTableWidth = useMemo(
    () => orderedDraftColumns.reduce(
      (total, column) => total + (draftColumnWidths[column.id] ?? column.defaultWidth),
      DRAFT_SELECT_COLUMN_WIDTH + DRAFT_OPEN_COLUMN_WIDTH + DRAFT_ACTION_COLUMN_WIDTH
    ),
    [draftColumnWidths, orderedDraftColumns]
  );

  const isRefreshing = isFormFetching || isResponsesFetching;

  const handleRefresh = useCallback(() => {
    void Promise.all([refetchForm(), refetchResponses()]);
  }, [refetchForm, refetchResponses]);

  useKeyboardShortcuts([
    {
      key: 'r',
      ctrl: true,
      handler: handleRefresh,
      description: 'Refresh responses',
    },
  ]);

  async function persistLayout(
    kind: ResponseTableKind,
    baseColumnIds: string[],
    nextOrder: string[],
    nextWidths: Record<string, number>
  ) {
    const sanitizedOrder = normalizeResponseColumnOrder(baseColumnIds, nextOrder);
    const sanitizedWidths = sanitizeResponseColumnWidths(nextWidths, baseColumnIds);
    const nextPreference: ResponseTablePreference = {
      ...tablePreferenceRef.current,
      [kind]: {
        columnOrder: sanitizedOrder,
        columnWidths: sanitizedWidths,
      },
    };

    tablePreferenceRef.current = nextPreference;

    try {
      await saveTablePreference.mutateAsync({
        key: tablePreferenceKey,
        value: nextPreference,
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save table layout');
    }
  }

  function reorderColumns(
    sourceColumnId: string,
    targetColumnId: string,
    baseColumnIds: string[],
    columnOrderRef: { current: string[] },
    columnWidthsRef: { current: Record<string, number> },
    setColumnOrder: Dispatch<SetStateAction<string[]>>,
    kind: ResponseTableKind
  ) {
    const currentOrder = normalizeResponseColumnOrder(baseColumnIds, columnOrderRef.current);
    const fromIndex = currentOrder.indexOf(sourceColumnId);
    const toIndex = currentOrder.indexOf(targetColumnId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(fromIndex, 1);
    if (!moved) return;
    nextOrder.splice(toIndex, 0, moved);

    setColumnOrder(nextOrder);
    void persistLayout(kind, baseColumnIds, nextOrder, columnWidthsRef.current);
  }

  function startColumnResize(
    event: ReactPointerEvent<HTMLDivElement>,
    column: ResponseColumnDef,
    columnWidthsRef: { current: Record<string, number> },
    setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>,
    columnOrderRef: { current: string[] },
    baseColumnIds: string[],
    kind: ResponseTableKind
  ) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidthsRef.current[column.id] ?? column.defaultWidth;
    let latestWidth = startWidth;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      latestWidth = clampResponseColumnWidth(Math.max(column.minWidth, startWidth + delta));
      setColumnWidths((prev) => ({ ...prev, [column.id]: latestWidth }));
    };

    const onUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      const nextWidths = { ...columnWidthsRef.current, [column.id]: latestWidth };
      setColumnWidths(nextWidths);
      void persistLayout(kind, baseColumnIds, columnOrderRef.current, nextWidths);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function exportResponses() {
    if (!form) return;

    const hasSelectedRows = selectedSubmissionIds.size > 0 || selectedDraftIds.size > 0;
    if (exportScope === 'selected' && !hasSelectedRows) {
      showError('Select at least one response or draft to export.');
      return;
    }

    try {
      setIsExporting(true);
      const params = new URLSearchParams();
      const { fromDate, toDate } = getExportDateRange(exportDateRange);

      if (form.tenantId) params.set('tenantId', form.tenantId);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      if (exportScope === 'selected') {
        const submissionIds = Array.from(selectedSubmissionIds);
        const draftIds = Array.from(selectedDraftIds);
        if (submissionIds.length > 0) params.set('submissionIds', JSON.stringify(submissionIds));
        if (draftIds.length > 0) params.set('draftIds', JSON.stringify(draftIds));

        if (draftIds.length > 0 && submissionIds.length > 0) {
          params.set('status', 'ALL_WITH_DRAFTS');
        } else if (draftIds.length > 0) {
          params.set('status', 'DRAFT');
        } else {
          params.set('status', exportStatus);
        }
      } else {
        params.set('status', exportStatus);
      }

      if (exportScope === 'filtered' && hasActiveSubmissionFilters) {
        params.set('submissionFilters', JSON.stringify(submissionFilters));
      }
      const includeTags = parseTagInput(exportIncludeTagsInput);
      const excludeTags = parseTagInput(exportExcludeTagsInput);
      if (includeTags.length > 0) params.set('includeTags', JSON.stringify(includeTags));
      if (excludeTags.length > 0) params.set('excludeTags', JSON.stringify(excludeTags));

      const res = await fetch(`/api/forms/${formId}/responses/export?${params.toString()}`);
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        const message = errorPayload && typeof errorPayload.error === 'string'
          ? errorPayload.error
          : 'Export failed';
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = getDownloadFileName(res.headers.get('Content-Disposition'), 'responses.xlsx');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      success('Export downloaded.');
      setIsExportOpen(false);
    } catch (exportError) {
      showError(exportError instanceof Error ? exportError.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSaveResponseTags() {
    if (!tagDialog) return;

    try {
      const tags = parseTagInput(tagDialog.input);
      await updateResponseTagsMutation.mutateAsync({
        submissionId: tagDialog.submission.id,
        tags,
      });
      success('Response tags updated.');
      setTagDialog(null);
    } catch (updateError) {
      showError(updateError instanceof Error ? updateError.message : 'Failed to update response tags');
    }
  }

  async function handleDeleteSubmission(reason?: string) {
    if (!submissionToDelete) return;

    const deletingLastSubmissionOnPage = (data?.submissions.length ?? 0) === 1 && page > 1;

    try {
      await deleteResponseMutation.mutateAsync({
        submissionId: submissionToDelete.id,
        reason,
      });
      success('Response deleted');
      setSubmissionToDelete(null);

      if (deletingLastSubmissionOnPage) {
        setPage((prev) => Math.max(1, prev - 1));
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete response');
    }
  }

  async function handleDeleteSelectedSubmissions(reason?: string) {
    const submissionIds = Array.from(selectedSubmissionIds);
    if (submissionIds.length === 0) return;

    const deletingAllVisibleSubmissions = visibleSubmissionIds.length > 0
      && visibleSubmissionIds.every((submissionId) => selectedSubmissionIds.has(submissionId))
      && page > 1;

    let deletedCount = 0;
    let failedCount = 0;

    setIsBulkDeleting(true);

    try {
      for (const submissionId of submissionIds) {
        try {
          await deleteResponseMutation.mutateAsync({
            submissionId,
            reason: reason || 'Bulk delete from responses table',
          });
          deletedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (deletedCount > 0) {
        success(`${deletedCount} response${deletedCount === 1 ? '' : 's'} deleted`);
      }

      if (failedCount > 0) {
        showError(`Failed to delete ${failedCount} response${failedCount === 1 ? '' : 's'}`);
      }

      setSelectedSubmissionIds(new Set());
      setIsBulkDeleteOpen(false);

      if (deletedCount > 0 && deletingAllVisibleSubmissions) {
        setPage((previous) => Math.max(1, previous - 1));
      } else if (deletedCount > 0) {
        void refetchResponses();
      }
    } finally {
      setIsBulkDeleting(false);
    }
  }

  async function handleDeleteSelectedDrafts(reason?: string) {
    const draftIds = Array.from(selectedDraftIds);
    if (draftIds.length === 0) return;

    const deletingAllVisibleDrafts = visibleDraftIds.length > 0
      && visibleDraftIds.every((draftId) => selectedDraftIds.has(draftId))
      && draftPage > 1;

    let deletedCount = 0;
    let failedCount = 0;

    setIsBulkDraftDeleting(true);

    try {
      for (const draftId of draftIds) {
        try {
          await deleteDraftMutation.mutateAsync({
            draftId,
            reason: reason || 'Bulk delete from draft responses table',
          });
          deletedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (deletedCount > 0) {
        success(`${deletedCount} draft${deletedCount === 1 ? '' : 's'} deleted`);
      }

      if (failedCount > 0) {
        showError(`Failed to delete ${failedCount} draft${failedCount === 1 ? '' : 's'}`);
      }

      setSelectedDraftIds(new Set());
      setIsBulkDraftDeleteOpen(false);

      if (deletedCount > 0 && deletingAllVisibleDrafts) {
        setDraftPage((previous) => Math.max(1, previous - 1));
      } else if (deletedCount > 0) {
        void refetchResponses();
      }
    } finally {
      setIsBulkDraftDeleting(false);
    }
  }

  async function handleDeleteDraft(reason?: string) {
    if (!draftToDelete) return;

    const deletingLastDraftOnPage = (data?.drafts.length ?? 0) === 1 && draftPage > 1;

    try {
      await deleteDraftMutation.mutateAsync({
        draftId: draftToDelete.id,
        reason,
      });
      success('Draft deleted');
      setDraftToDelete(null);

      if (deletingLastDraftOnPage) {
        setDraftPage((prev) => Math.max(1, prev - 1));
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete draft');
    }
  }

  async function handleCopyDraftResumeLink(draft: DraftItem) {
    try {
      const result = await generateDraftResumeLinkMutation.mutateAsync({
        draftId: draft.id,
        reason: 'Generated resume link from draft entries',
      });
      if (await copyTextToClipboard(result.resumeUrl)) {
        success('Draft resume link copied');
        return;
      }

      showError('Failed to copy draft resume link');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to copy draft resume link');
    }
  }

  function openExtendDraftExpiry(draft: DraftItem) {
    setDraftToExtend(draft);
    setDraftExpiryInput(toDateTimeLocalInputValue(draft.expiresAt));
  }

  async function handleExtendDraftExpiry() {
    if (!draftToExtend) return;

    const expiresAt = new Date(draftExpiryInput);
    if (!draftExpiryInput || Number.isNaN(expiresAt.getTime())) {
      showError('Choose a valid expiry date');
      return;
    }

    try {
      await extendDraftExpiryMutation.mutateAsync({
        draftId: draftToExtend.id,
        expiresAt: expiresAt.toISOString(),
        reason: 'Extended draft expiry from draft entries',
      });
      success('Draft expiry extended');
      setDraftToExtend(null);
      setDraftExpiryInput('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to extend draft expiry');
    }
  }

  function handleSubmissionSort(columnId: string) {
    setPage(1);
    setSelectedSubmissionIds(new Set());

    if (submissionSortBy === columnId) {
      setSubmissionSortOrder((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSubmissionSortBy(columnId);
    setSubmissionSortOrder(columnId === RESPONSE_COLUMN_SUBMITTED_ID ? 'desc' : 'asc');
  }

  function handleSubmissionFilterChange(columnId: string, value: string) {
    setPage(1);
    setSelectedSubmissionIds(new Set());
    setSubmissionFilters((previous) => ({
      ...previous,
      [columnId]: value,
    }));
  }

  function clearSubmissionFilters() {
    setPage(1);
    setSelectedSubmissionIds(new Set());
    setSubmissionFilters({});
  }

  function handleDraftFilterChange(columnId: string, value: string) {
    setSelectedDraftIds(new Set());
    setDraftFilters((previous) => ({
      ...previous,
      [columnId]: value,
    }));
  }

  function clearDraftFilters() {
    setSelectedDraftIds(new Set());
    setDraftFilters({});
  }

  function toggleSubmissionSelection(submissionId: string) {
    setSelectedDraftIds(new Set());
    setSelectedSubmissionIds((previous) => {
      const next = new Set(previous);
      if (next.has(submissionId)) {
        next.delete(submissionId);
      } else {
        next.add(submissionId);
      }
      return next;
    });
  }

  function toggleAllVisibleSubmissionSelection() {
    setSelectedDraftIds(new Set());
    setSelectedSubmissionIds((previous) => {
      const next = new Set(previous);

      if (isAllVisibleSubmissionsSelected) {
        visibleSubmissionIds.forEach((submissionId) => next.delete(submissionId));
      } else {
        visibleSubmissionIds.forEach((submissionId) => next.add(submissionId));
      }

      return next;
    });
  }

  function handleDraftSort(columnId: string) {
    setSelectedDraftIds(new Set());

    if (draftSortBy === columnId) {
      setDraftSortOrder((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setDraftSortBy(columnId);
    setDraftSortOrder(columnId === DRAFT_COLUMN_SAVED_ID ? 'desc' : 'asc');
  }

  function toggleDraftSelection(draftId: string) {
    setSelectedSubmissionIds(new Set());
    setSelectedDraftIds((previous) => {
      const next = new Set(previous);
      if (next.has(draftId)) {
        next.delete(draftId);
      } else {
        next.add(draftId);
      }
      return next;
    });
  }

  function toggleAllVisibleDraftSelection() {
    setSelectedSubmissionIds(new Set());
    setSelectedDraftIds((previous) => {
      const next = new Set(previous);

      if (isAllVisibleDraftsSelected) {
        visibleDraftIds.forEach((draftId) => next.delete(draftId));
      } else {
        visibleDraftIds.forEach((draftId) => next.add(draftId));
      }

      return next;
    });
  }

  if (isFormLoading) {
    return (
      <div className="min-h-screen bg-background-primary">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
          <div className="h-28 animate-pulse rounded-2xl border border-border-primary bg-background-secondary sm:rounded-3xl" />
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl border border-border-primary bg-background-secondary sm:rounded-3xl" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-2xl border border-border-primary bg-background-secondary sm:rounded-3xl" />
        </div>
      </div>
    );
  }

  if (formError || !form) {
    return (
      <div className="min-h-screen bg-background-primary">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
          <Alert variant="error" title="Form not found">
            {formError instanceof Error ? formError.message : 'This form could not be loaded.'}
          </Alert>
        </div>
      </div>
    );
  }

  const viewHref = form.status === 'PUBLISHED'
    ? `/forms/f/${form.slug}`
    : `/forms/f/${form.slug}?preview=1&formId=${form.id}&tenantId=${form.tenantId}`;

  function handleOpenPreview() {
    window.open(viewHref, '_blank', 'noopener,noreferrer');
  }

  function getSubmissionHref(submissionId: string) {
    return `/forms/${params.id}/responses/${submissionId}`;
  }

  function getDraftHref(draftId: string) {
    return `/forms/${params.id}/responses/drafts/${draftId}`;
  }

  function openSubmissionDetail(submissionId: string) {
    router.push(getSubmissionHref(submissionId));
  }

  function openDraftDetail(draftId: string) {
    router.push(getDraftHref(draftId));
  }

  function getAttachmentHref(source: NonNullable<AttachmentDialogState>['source'], uploadId: string): string {
    if (!form) return '#';

    const tenantQuery = form.tenantId ? `?tenantId=${encodeURIComponent(form.tenantId)}&disposition=inline` : '?disposition=inline';

    if (source.type === 'submission') {
      return `/api/forms/${encodeURIComponent(form.id)}/responses/${encodeURIComponent(source.id)}/uploads/${encodeURIComponent(uploadId)}${tenantQuery}`;
    }

    return `/api/forms/${encodeURIComponent(form.id)}/drafts/${encodeURIComponent(source.id)}/uploads/${encodeURIComponent(uploadId)}${tenantQuery}`;
  }

  function renderSubmissionCell(submission: SubmissionItem, column: ResponseColumnDef): ReactNode {
    if (column.kind === 'submitted') return formatDate(submission.submittedAt);
    if (column.kind === 'status') {
      const aiReview = parseFormSubmissionAiReview(submission.metadata);
      const reviewRequired = hasUnresolvedFormSubmissionAiWarning(aiReview);
      const reviewPending = aiReview?.status === 'queued' || aiReview?.status === 'processing';

      return (
        <span className="inline-flex items-center gap-1.5">
          {reviewPending && (
            <RefreshCw className={`h-3.5 w-3.5 shrink-0 text-sky-500 ${aiReview?.status === 'processing' ? 'animate-spin' : ''}`} aria-hidden="true" />
          )}
          {reviewRequired && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          )}
          <SubmissionStatusBadge status={submission.status} />
        </span>
      );
    }

    if (column.kind === 'tags') {
      const tags = getResponseTags(submission.metadata);
      if (tags.length === 0) return '';
      return tags.join(', ');
    }

    const answers = toAnswerRecord(submission.answers);
    const value = answers[column.fieldKey || ''];
    return formatSummaryCellValue(column.fieldType || 'SHORT_TEXT', value);
  }

  function openAttachmentsDialog(
    title: string,
    description: string,
    attachments: SubmissionItem['attachments'],
    source: NonNullable<AttachmentDialogState>['source']
  ) {
    setAttachmentDialog({
      title,
      description,
      attachments,
      source,
    });
  }

  return (
    <div className="min-h-screen bg-background-primary">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">

      {/* Header */}
      <section className="rounded-2xl border border-oak-primary/20 bg-gradient-to-br from-oak-primary/[0.06] to-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1">
            <Link href="/forms" className="inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary">
              <ChevronLeft className="h-4 w-4" />
              Back to Forms
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-primary">
                <FileText className="h-4 w-4" />
              </div>
              <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">
                {form.title}
              </h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                form.status === 'PUBLISHED'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : form.status === 'ARCHIVED'
                  ? 'bg-background-tertiary text-text-muted'
                  : 'bg-status-warning/10 text-status-warning'
              }`}>
                {form.status.charAt(0) + form.status.slice(1).toLowerCase()}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />}
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <span className="hidden xl:inline">Refresh (Ctrl+R)</span>
              <span className="xl:hidden">Refresh</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={handleOpenPreview}>
              {form.status === 'PUBLISHED' ? 'View' : 'Preview'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => router.push(`/forms/${form.id}/builder`)}>
              Edit Form
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => setIsExportOpen(true)}>
              Export
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {([
          { label: 'Total views', value: form.viewsCount, icon: Eye },
          { label: 'Responses', value: form.submissionsCount, icon: ClipboardList },
          { label: 'Conversion rate', value: `${conversionRate}%`, icon: MousePointerClick },
          { label: 'Active drafts', value: data?.draftTotal ?? 0, icon: PenLine },
        ] as const).map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:rounded-3xl">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                <stat.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-xs font-medium text-text-secondary">{stat.label}</div>
            </div>
            <div className="mt-2 text-2xl font-semibold text-text-primary">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-sm sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-primary px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">Submissions</span>
                {data && (
                  <span className="inline-flex items-center rounded-full border border-border-primary px-2 py-0.5 text-xs text-text-secondary">
                    {data.total}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-secondary">
                Sort and filter columns directly in the table.
              </p>
            </div>
          </div>
          {hasActiveSubmissionFilters && (
            <button
              type="button"
              onClick={clearSubmissionFilters}
              className="text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              Clear filters
            </button>
          )}
        </div>

        {submissionFilterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border-primary px-4 py-3">
            <span className="text-xs font-medium text-text-secondary">Active filters:</span>
            {submissionFilterChips.map((chip) => (
              <FilterChip
                key={chip.columnId}
                label={chip.label}
                value={chip.value}
                onRemove={() => handleSubmissionFilterChange(chip.columnId, '')}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="p-4">
            <Alert variant="error">
              {error instanceof Error ? error.message : 'Failed to load responses'}
            </Alert>
          </div>
        )}

        {isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-12 animate-pulse rounded bg-background-tertiary" />
            ))}
          </div>
        )}

        {!isLoading && data && data.submissions.length === 0 && !hasActiveSubmissionFilters && (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-oak-primary/10 text-oak-primary">
              <Inbox className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">No submissions yet</p>
              <p className="mt-1 text-xs text-text-secondary">
                Responses will appear here once someone submits the form.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenPreview}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border-primary bg-background-secondary px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm transition-colors hover:border-oak-primary/40 hover:text-text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {form.status === 'PUBLISHED' ? 'View form' : 'Preview form'}
            </button>
          </div>
        )}

        {!isLoading && data && (data.submissions.length > 0 || hasActiveSubmissionFilters) && (
          <div className="overflow-x-auto px-4 pb-4">
            <table
              className="table-fixed text-sm"
              style={{ width: `${submissionTableWidth}px` }}
            >
              <thead className="bg-background-primary">
                <tr className="border-b border-border-primary bg-background-elevated/60">
                  <th
                    className="pl-4 pr-2 py-2"
                    style={{ width: `${SUBMISSION_SELECT_COLUMN_WIDTH}px`, minWidth: `${SUBMISSION_SELECT_COLUMN_WIDTH}px` }}
                  />
                  <th
                    className="px-2 py-2"
                    style={{ width: `${SUBMISSION_OPEN_COLUMN_WIDTH}px`, minWidth: `${SUBMISSION_OPEN_COLUMN_WIDTH}px` }}
                  />
                  {orderedSubmissionColumns.map((column) => (
                    <th
                      key={`${column.id}:filter`}
                      style={{ width: `${submissionColumnWidths[column.id] ?? column.defaultWidth}px`, minWidth: `${column.minWidth}px` }}
                      className="px-3 py-3"
                    >
                      <input
                        value={submissionFilters[column.id] || ''}
                        onChange={(event) => handleSubmissionFilterChange(column.id, event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        placeholder="Filter"
                        aria-label={`Filter ${column.label}`}
                        className="w-full rounded-md border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-oak-primary"
                      />
                    </th>
                  ))}
                  <th
                    className="px-2 py-2"
                    style={{ width: `${SUBMISSION_ACTION_COLUMN_WIDTH}px`, minWidth: `${SUBMISSION_ACTION_COLUMN_WIDTH}px` }}
                  />
                </tr>
                <tr className="text-left text-xs text-text-secondary">
                  <th
                    className="pl-4 pr-2 py-2 font-medium"
                    style={{ width: `${SUBMISSION_SELECT_COLUMN_WIDTH}px`, minWidth: `${SUBMISSION_SELECT_COLUMN_WIDTH}px` }}
                  >
                    <div onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        size="sm"
                        checked={isAllVisibleSubmissionsSelected}
                        indeterminate={!isAllVisibleSubmissionsSelected && isSomeVisibleSubmissionsSelected}
                        onChange={toggleAllVisibleSubmissionSelection}
                        aria-label="Select all visible submissions"
                        className="justify-center"
                      />
                    </div>
                  </th>
                  <th
                    className="px-2 py-2 font-medium text-center"
                    style={{ width: `${SUBMISSION_OPEN_COLUMN_WIDTH}px`, minWidth: `${SUBMISSION_OPEN_COLUMN_WIDTH}px` }}
                  >
                    <span className="sr-only">Open in new tab</span>
                    <ExternalLink className="mx-auto h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                  </th>
                  {orderedSubmissionColumns.map((column) => {
                    const width = submissionColumnWidths[column.id] ?? column.defaultWidth;
                    const isActiveSort = submissionSortBy === column.id;
                    return (
                      <th
                        key={column.id}
                        style={{ width: `${width}px`, minWidth: `${column.minWidth}px` }}
                        className={cn(
                          'relative px-4 py-2 font-medium select-none',
                          draggedSubmissionColumnId === column.id && 'opacity-50'
                        )}
                        draggable
                        onDragStart={(event) => {
                          setDraggedSubmissionColumnId(column.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', column.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceColumnId = draggedSubmissionColumnId || event.dataTransfer.getData('text/plain');
                          if (!sourceColumnId) return;
                          reorderColumns(
                            sourceColumnId,
                            column.id,
                            submissionBaseColumnIds,
                            submissionColumnOrderRef,
                            submissionColumnWidthsRef,
                            setSubmissionColumnOrder,
                            'submissions'
                          );
                          setDraggedSubmissionColumnId(null);
                        }}
                        onDragEnd={() => setDraggedSubmissionColumnId(null)}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <GripVertical className="h-3.5 w-3.5 text-text-muted" />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSubmissionSort(column.id);
                            }}
                            className={cn(
                              'inline-flex min-w-0 items-center gap-1 text-left hover:text-text-primary',
                              isActiveSort && 'text-text-primary'
                            )}
                            aria-label={`Sort by ${column.label}`}
                          >
                            <span className="truncate">{column.label}</span>
                            {isActiveSort ? (
                              submissionSortOrder === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                            )}
                          </button>
                        </div>
                        <div
                          onPointerDown={(event) => startColumnResize(
                            event,
                            column,
                            submissionColumnWidthsRef,
                            setSubmissionColumnWidths,
                            submissionColumnOrderRef,
                            submissionBaseColumnIds,
                            'submissions'
                          )}
                          className="absolute top-0 -right-2 h-full w-4 cursor-col-resize hover:bg-border-secondary/60 z-10 touch-none"
                          title="Drag to resize"
                        />
                      </th>
                    );
                  })}
                  <th
                    className="px-2 py-2 font-medium text-center"
                    style={{ width: `${SUBMISSION_ACTION_COLUMN_WIDTH}px`, minWidth: `${SUBMISSION_ACTION_COLUMN_WIDTH}px` }}
                  >
                    <span className="sr-only">Delete</span>
                    <Trash2 className="mx-auto h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.submissions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={orderedSubmissionColumns.length + 3}
                      className="px-4 py-10 text-center text-sm text-text-secondary"
                    >
                      No submissions match the current filters.
                    </td>
                  </tr>
                ) : data.submissions.map((submission, index) => {
                  const isSelected = selectedSubmissionIds.has(submission.id);
                  const isAlternate = index % 2 === 1;

                  return (
                    <tr
                      key={submission.id}
                      className={cn(
                        'group cursor-pointer border-t border-border-primary text-text-primary hover:bg-background-primary/60',
                        isSelected ? 'bg-oak-primary/5' : isAlternate ? 'bg-background-primary/40' : 'bg-background-elevated'
                      )}
                      onClick={() => openSubmissionDetail(submission.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openSubmissionDetail(submission.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label="Open submission details"
                    >
                      <td
                        className="pl-4 pr-2 py-3.5 align-middle"
                        style={{ width: `${SUBMISSION_SELECT_COLUMN_WIDTH}px` }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          size="sm"
                          checked={isSelected}
                          onChange={() => toggleSubmissionSelection(submission.id)}
                          aria-label={`Select submission ${submission.id}`}
                          className="justify-center"
                        />
                      </td>
                      <td
                        className="px-2 py-3.5 align-middle"
                        style={{ width: `${SUBMISSION_OPEN_COLUMN_WIDTH}px` }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Tooltip content="Open in new tab">
                          <Link
                            href={getSubmissionHref(submission.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex rounded p-1.5 text-text-secondary hover:bg-background-tertiary hover:text-text-primary"
                            aria-label="Open in new tab"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Tooltip>
                      </td>
                      {orderedSubmissionColumns.map((column) => (
                        <td
                          key={`${submission.id}:${column.id}`}
                          style={{ width: `${submissionColumnWidths[column.id] ?? column.defaultWidth}px` }}
                          className="px-4 py-3.5 align-middle"
                        >
                          {column.kind === 'attachments' ? (
                            submission.attachments.length > 0 ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAttachmentsDialog(
                                    'Submission attachments',
                                    `Attachments linked to the response submitted on ${formatDate(submission.submittedAt)}.`,
                                    submission.attachments,
                                    { type: 'submission', id: submission.id }
                                  );
                                }}
                                className="inline-flex min-w-[6rem] items-center justify-center gap-1.5 whitespace-nowrap rounded border border-border-primary px-2.5 py-1.5 text-xs text-text-secondary hover:bg-background-primary hover:text-text-primary"
                                aria-label={`View attachments for submission ${submission.id}`}
                              >
                                <Paperclip className="h-3.5 w-3.5" />
                                {submission.uploadCount} file{submission.uploadCount === 1 ? '' : 's'}
                              </button>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )
                          ) : (
                            column.kind === 'tags' ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setTagDialog({
                                    submission,
                                    input: getResponseTags(submission.metadata).join(', '),
                                  });
                                }}
                                className="flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-left hover:border-border-primary hover:bg-background-primary"
                                aria-label="Edit response tags"
                              >
                                {getResponseTags(submission.metadata).length > 0 ? (
                                  getResponseTags(submission.metadata).map((tag) => (
                                    <span
                                      key={tag}
                                      className="inline-flex max-w-full items-center gap-1 rounded bg-background-tertiary px-2 py-0.5 text-xs text-text-secondary"
                                    >
                                      <Tag className="h-3 w-3 shrink-0" />
                                      <span className="truncate">{tag}</span>
                                    </span>
                                  ))
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                                    <Tag className="h-3 w-3" />
                                    Add tags
                                  </span>
                                )}
                              </button>
                            ) : (
                              <span className="line-clamp-2 break-words">
                                {renderSubmissionCell(submission, column)}
                              </span>
                            )
                          )}
                        </td>
                      ))}
                      <td
                        className="px-2 py-3.5 align-middle"
                        style={{ width: `${SUBMISSION_ACTION_COLUMN_WIDTH}px` }}
                      >
                        <div className="flex justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Tooltip content="Delete submission">
                            <button
                              type="button"
                              className="rounded p-1.5 text-text-secondary hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSubmissionToDelete(submission);
                              }}
                              aria-label="Delete submission"
                              disabled={deleteResponseMutation.isPending && submissionToDelete?.id === submission.id}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > 0 && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            limit={data.limit}
            onPageChange={setPage}
            onLimitChange={(nextLimit) => {
              setPageSize(nextLimit);
              setPage(1);
              setSelectedSubmissionIds(new Set());
            }}
          />
        )}
      </div>

      <BulkActionsToolbar
        selectedCount={selectedDraftIds.size > 0 ? selectedDraftIds.size : selectedSubmissionIds.size}
        onClearSelection={() => {
          setSelectedSubmissionIds(new Set());
          setSelectedDraftIds(new Set());
        }}
        actions={[
          {
            id: 'export',
            label: 'Export',
            icon: Download,
            description: selectedDraftIds.size > 0 && selectedSubmissionIds.size > 0
              ? 'Export selected responses and drafts'
              : selectedDraftIds.size > 0 ? 'Export selected drafts' : 'Export selected responses',
            isLoading: isExporting,
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: Trash2,
            description: selectedDraftIds.size > 0 ? 'Delete selected drafts' : 'Delete selected submissions',
            variant: 'danger',
            isLoading: selectedDraftIds.size > 0 ? isBulkDraftDeleting : isBulkDeleting,
          },
        ]}
        onAction={(actionId) => {
          if (actionId === 'export') {
            setExportScope('selected');
            setIsExportOpen(true);
            return;
          }
          if (actionId !== 'delete') return;
          if (selectedDraftIds.size > 0) {
            setIsBulkDraftDeleteOpen(true);
            return;
          }
          if (selectedSubmissionIds.size > 0) {
            setIsBulkDeleteOpen(true);
          }
        }}
      />

      <div className="overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-sm sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-primary px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
              <PenLine className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">Draft entries</span>
                {data && (
                  <span className="inline-flex items-center rounded-full border border-border-primary px-2 py-0.5 text-xs text-text-secondary">
                    {data.draftTotal}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-secondary">
                Saved drafts not yet submitted.
              </p>
            </div>
          </div>
          {hasActiveDraftFilters && (
            <button
              type="button"
              onClick={clearDraftFilters}
              className="text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              Clear filters
            </button>
          )}
        </div>

        {draftFilterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border-primary px-4 py-3">
            <span className="text-xs font-medium text-text-secondary">Active filters:</span>
            {draftFilterChips.map((chip) => (
              <FilterChip
                key={chip.columnId}
                label={chip.label}
                value={chip.value}
                onRemove={() => handleDraftFilterChange(chip.columnId, '')}
              />
            ))}
          </div>
        )}

        {isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="h-12 animate-pulse rounded bg-background-tertiary" />
            ))}
          </div>
        )}

        {!isLoading && data && data.drafts.length === 0 && !hasActiveDraftFilters && (
          <div className="px-4 py-8 text-center text-sm text-text-secondary">No active draft entries.</div>
        )}

        {!isLoading && data && (data.drafts.length > 0 || hasActiveDraftFilters) && (
          <div className="overflow-x-auto px-4 pb-4">
            <table
              className="table-fixed text-sm"
              style={{ width: `${draftTableWidth}px` }}
            >
              <thead className="bg-background-primary">
                <tr className="border-b border-border-primary bg-background-elevated/60">
                  <th
                    className="pl-4 pr-2 py-2"
                    style={{ width: `${DRAFT_SELECT_COLUMN_WIDTH}px`, minWidth: `${DRAFT_SELECT_COLUMN_WIDTH}px` }}
                  />
                  <th
                    className="px-2 py-2"
                    style={{ width: `${DRAFT_OPEN_COLUMN_WIDTH}px`, minWidth: `${DRAFT_OPEN_COLUMN_WIDTH}px` }}
                  />
                  {orderedDraftColumns.map((column) => (
                    <th
                      key={`draft-filter-${column.id}`}
                      style={{ width: `${draftColumnWidths[column.id] ?? column.defaultWidth}px`, minWidth: `${column.minWidth}px` }}
                      className="px-3 py-3"
                    >
                      <input
                        value={draftFilters[column.id] || ''}
                        onChange={(event) => handleDraftFilterChange(column.id, event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        placeholder="Filter"
                        aria-label={`Filter ${column.label}`}
                        className="w-full rounded-md border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-oak-primary"
                      />
                    </th>
                  ))}
                  <th
                    className="px-2 py-2"
                    style={{ width: `${DRAFT_ACTION_COLUMN_WIDTH}px`, minWidth: `${DRAFT_ACTION_COLUMN_WIDTH}px` }}
                  />
                </tr>
                <tr className="text-left text-xs text-text-secondary">
                  <th
                    className="pl-4 pr-2 py-2 font-medium"
                    style={{ width: `${DRAFT_SELECT_COLUMN_WIDTH}px`, minWidth: `${DRAFT_SELECT_COLUMN_WIDTH}px` }}
                  >
                    <div onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        size="sm"
                        checked={isAllVisibleDraftsSelected}
                        indeterminate={!isAllVisibleDraftsSelected && isSomeVisibleDraftsSelected}
                        onChange={toggleAllVisibleDraftSelection}
                        aria-label="Select all visible drafts"
                        className="justify-center"
                      />
                    </div>
                  </th>
                  <th
                    className="px-2 py-2 font-medium text-center"
                    style={{ width: `${DRAFT_OPEN_COLUMN_WIDTH}px`, minWidth: `${DRAFT_OPEN_COLUMN_WIDTH}px` }}
                  >
                    <span className="sr-only">Open in new tab</span>
                    <ExternalLink className="mx-auto h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                  </th>
                  {orderedDraftColumns.map((column) => {
                    const width = draftColumnWidths[column.id] ?? column.defaultWidth;
                    const isActiveSort = draftSortBy === column.id;

                    return (
                      <th
                        key={`draft-${column.id}`}
                        style={{ width: `${width}px`, minWidth: `${column.minWidth}px` }}
                        className={cn(
                          'relative px-4 py-2 font-medium select-none',
                          draggedDraftColumnId === column.id && 'opacity-50'
                        )}
                        draggable
                        onDragStart={(event) => {
                          setDraggedDraftColumnId(column.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', column.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceColumnId = draggedDraftColumnId || event.dataTransfer.getData('text/plain');
                          if (!sourceColumnId) return;
                          reorderColumns(
                            sourceColumnId,
                            column.id,
                            draftBaseColumnIds,
                            draftColumnOrderRef,
                            draftColumnWidthsRef,
                            setDraftColumnOrder,
                            'drafts'
                          );
                          setDraggedDraftColumnId(null);
                        }}
                        onDragEnd={() => setDraggedDraftColumnId(null)}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <GripVertical className="h-3.5 w-3.5 text-text-muted" />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDraftSort(column.id);
                            }}
                            className={cn(
                              'inline-flex min-w-0 items-center gap-1 text-left hover:text-text-primary',
                              isActiveSort && 'text-text-primary'
                            )}
                            aria-label={`Sort by ${column.label}`}
                          >
                            <span className="truncate">{column.label}</span>
                            {isActiveSort ? (
                              draftSortOrder === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                            )}
                          </button>
                        </div>
                        <div
                          onPointerDown={(event) => startColumnResize(
                            event,
                            column,
                            draftColumnWidthsRef,
                            setDraftColumnWidths,
                            draftColumnOrderRef,
                            draftBaseColumnIds,
                            'drafts'
                          )}
                          className="absolute top-0 -right-2 h-full w-4 cursor-col-resize hover:bg-border-secondary/60 z-10 touch-none"
                          title="Drag to resize"
                        />
                      </th>
                    );
                  })}
                  <th
                    className="px-2 py-2 font-medium text-center"
                    style={{ width: `${DRAFT_ACTION_COLUMN_WIDTH}px`, minWidth: `${DRAFT_ACTION_COLUMN_WIDTH}px` }}
                  >
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDrafts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={orderedDraftColumns.length + 3}
                      className="px-4 py-10 text-center text-sm text-text-secondary"
                    >
                      No draft entries match the current filters.
                    </td>
                  </tr>
                ) : filteredDrafts.map((draft, index) => {
                  const isSelected = selectedDraftIds.has(draft.id);
                  const isAlternate = index % 2 === 1;

                  return (
                    <tr
                      key={draft.id}
                      className={cn(
                        'group cursor-pointer border-t border-border-primary text-text-primary hover:bg-background-primary/60',
                        isSelected ? 'bg-oak-primary/5' : isAlternate ? 'bg-background-primary/40' : 'bg-background-elevated'
                      )}
                      onClick={() => openDraftDetail(draft.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDraftDetail(draft.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label="Open draft details"
                    >
                      <td
                        className="pl-4 pr-2 py-3.5 align-middle"
                        style={{ width: `${DRAFT_SELECT_COLUMN_WIDTH}px` }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          size="sm"
                          checked={isSelected}
                          onChange={() => toggleDraftSelection(draft.id)}
                          aria-label={`Select draft ${draft.code}`}
                          className="justify-center"
                        />
                      </td>
                      <td
                        className="px-2 py-3.5 align-middle"
                        style={{ width: `${DRAFT_OPEN_COLUMN_WIDTH}px` }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Tooltip content="Open in new tab">
                          <Link
                            href={getDraftHref(draft.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex rounded p-1.5 text-text-secondary hover:bg-background-tertiary hover:text-text-primary"
                            aria-label="Open in new tab"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Tooltip>
                      </td>
                      {orderedDraftColumns.map((column) => (
                        <td
                          key={`${draft.id}:${column.id}`}
                          style={{ width: `${draftColumnWidths[column.id] ?? column.defaultWidth}px` }}
                          className="px-4 py-3.5 align-middle"
                        >
                          {column.kind === 'attachments' ? (
                            draft.attachments.length > 0 ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAttachmentsDialog(
                                    `Draft ${draft.code} attachments`,
                                    `Attachments linked to draft ${draft.code}.`,
                                    draft.attachments,
                                    { type: 'draft', id: draft.id }
                                  );
                                }}
                                className="inline-flex min-w-[6rem] items-center justify-center gap-1.5 whitespace-nowrap rounded border border-border-primary px-2.5 py-1.5 text-xs text-text-secondary hover:bg-background-primary hover:text-text-primary"
                                aria-label={`View attachments for draft ${draft.code}`}
                              >
                                <Paperclip className="h-3.5 w-3.5" />
                                {draft.uploadCount} file{draft.uploadCount === 1 ? '' : 's'}
                              </button>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )
                          ) : (
                            <span className={cn(
                              'line-clamp-2 break-words',
                              column.kind === 'draftCode' && 'font-mono text-xs sm:text-sm'
                            )}>
                              {renderDraftCell(draft, column)}
                            </span>
                          )}
                        </td>
                      ))}
                      <td
                        className="px-2 py-3.5 align-middle"
                        style={{ width: `${DRAFT_ACTION_COLUMN_WIDTH}px` }}
                      >
                        <div className="flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Tooltip content="Copy resume link">
                            <button
                              type="button"
                              className="rounded p-1.5 text-text-secondary hover:bg-background-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleCopyDraftResumeLink(draft);
                              }}
                              aria-label="Copy draft resume link"
                              disabled={generateDraftResumeLinkMutation.isPending}
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Extend expiry">
                            <button
                              type="button"
                              className="rounded p-1.5 text-text-secondary hover:bg-background-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={(event) => {
                                event.stopPropagation();
                                openExtendDraftExpiry(draft);
                              }}
                              aria-label="Extend draft expiry"
                              disabled={extendDraftExpiryMutation.isPending}
                            >
                              <CalendarClock className="w-4 h-4" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Audit log">
                            <button
                              type="button"
                              className="rounded p-1.5 text-text-secondary hover:bg-background-tertiary hover:text-text-primary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDraftAuditTarget(draft);
                              }}
                              aria-label="View draft audit log"
                            >
                              <History className="w-4 h-4" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete draft">
                            <button
                              type="button"
                              className="rounded p-1.5 text-text-secondary hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDraftToDelete(draft);
                              }}
                              aria-label="Delete draft"
                              disabled={deleteDraftMutation.isPending && draftToDelete?.id === draft.id}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && data.draftTotal > 0 && (
          <Pagination
            page={data.draftPage}
            totalPages={data.draftTotalPages}
            total={data.draftTotal}
            limit={data.draftLimit}
            onPageChange={setDraftPage}
            onLimitChange={(nextLimit) => {
              setDraftPageSize(nextLimit);
              setDraftPage(1);
              setSelectedDraftIds(new Set());
            }}
          />
        )}
      </div>

      <ConfirmDialog
        isOpen={!!submissionToDelete}
        onClose={() => setSubmissionToDelete(null)}
        onConfirm={handleDeleteSubmission}
        title="Delete response"
        description={submissionToDelete ? `Are you sure you want to delete the response submitted on ${formatDate(submissionToDelete.submittedAt)}? This action cannot be undone.` : undefined}
        confirmLabel="Delete response"
        isLoading={deleteResponseMutation.isPending}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteOpen}
        onClose={() => setIsBulkDeleteOpen(false)}
        onConfirm={handleDeleteSelectedSubmissions}
        title="Delete selected responses"
        description={`Are you sure you want to delete ${selectedSubmissionIds.size} selected response${selectedSubmissionIds.size === 1 ? '' : 's'}? This action cannot be undone.`}
        confirmLabel="Delete selected"
        isLoading={isBulkDeleting}
      />

      <ConfirmDialog
        isOpen={isBulkDraftDeleteOpen}
        onClose={() => setIsBulkDraftDeleteOpen(false)}
        onConfirm={handleDeleteSelectedDrafts}
        title="Delete selected drafts"
        description={`Are you sure you want to delete ${selectedDraftIds.size} selected draft${selectedDraftIds.size === 1 ? '' : 's'}? This action cannot be undone.`}
        confirmLabel="Delete selected"
        isLoading={isBulkDraftDeleting}
      />

      <ConfirmDialog
        isOpen={!!draftToDelete}
        onClose={() => setDraftToDelete(null)}
        onConfirm={handleDeleteDraft}
        title="Delete draft"
        description={draftToDelete ? `Are you sure you want to delete draft ${draftToDelete.code}? This action cannot be undone.` : undefined}
        confirmLabel="Delete draft"
        isLoading={deleteDraftMutation.isPending}
      />

      <Modal
        isOpen={!!tagDialog}
        onClose={() => {
          if (!updateResponseTagsMutation.isPending) setTagDialog(null);
        }}
        title="Response tags"
        description="Use comma-separated labels such as old, duplicate, or superseded."
        size="sm"
      >
        <ModalBody className="space-y-3">
          <label htmlFor="response-tags" className="text-sm font-medium text-text-primary">
            Tags
          </label>
          <input
            id="response-tags"
            type="text"
            value={tagDialog?.input || ''}
            onChange={(event) => {
              const value = event.target.value;
              setTagDialog((previous) => previous ? { ...previous, input: value } : previous);
            }}
            placeholder="old, superseded"
            className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-oak-primary"
          />
          <div className="flex flex-wrap gap-1">
            {parseTagInput(tagDialog?.input || '').map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded bg-background-tertiary px-2 py-0.5 text-xs text-text-secondary">
                <Tag className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTagDialog(null)}
            disabled={updateResponseTagsMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveResponseTags}
            isLoading={updateResponseTagsMutation.isPending}
          >
            Save tags
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={isExportOpen}
        onClose={() => {
          if (!isExporting) setIsExportOpen(false);
        }}
        title="Export responses"
        size="md"
      >
        <ModalBody className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Export scope</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                { value: 'all' as const, label: 'All' },
                { value: 'filtered' as const, label: 'Current filters' },
                { value: 'selected' as const, label: 'Selected' },
              ]).map((option) => {
                const selectedCount = selectedSubmissionIds.size + selectedDraftIds.size;
                const isDisabled = option.value === 'selected' && selectedCount === 0;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExportScope(option.value)}
                    disabled={isDisabled}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm transition-colors',
                      exportScope === option.value
                        ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                        : 'border-border-primary bg-background-primary text-text-secondary hover:text-text-primary',
                      isDisabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-text-primary">Status</span>
              <select
                value={exportStatus}
                onChange={(event) => setExportStatus(event.target.value as ExportStatus)}
                disabled={exportScope === 'selected' && selectedDraftIds.size > 0 && selectedSubmissionIds.size === 0}
                className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-oak-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {EXPORT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <DatePicker
              label="Date range"
              value={exportDateRange}
              onChange={setExportDateRange}
              placeholder="All dates"
              defaultTab="range"
              size="sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-text-primary">Include tags</span>
              <input
                type="text"
                value={exportIncludeTagsInput}
                onChange={(event) => setExportIncludeTagsInput(event.target.value)}
                placeholder="duplicate, superseded"
                className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-oak-primary"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-text-primary">Exclude tags</span>
              <input
                type="text"
                value={exportExcludeTagsInput}
                onChange={(event) => setExportExcludeTagsInput(event.target.value)}
                placeholder="old"
                className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-oak-primary"
              />
            </label>
          </div>

          <div className="rounded-md border border-border-primary bg-background-primary p-3 text-sm text-text-secondary">
            <div className="flex items-center justify-between gap-3">
              <span>Selected responses</span>
              <span className="font-medium text-text-primary">{selectedSubmissionIds.size}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span>Selected drafts</span>
              <span className="font-medium text-text-primary">{selectedDraftIds.size}</span>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsExportOpen(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Download className="w-4 h-4" />}
            onClick={exportResponses}
            isLoading={isExporting}
          >
            Export Excel
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={!!draftToExtend}
        onClose={() => {
          setDraftToExtend(null);
          setDraftExpiryInput('');
        }}
        title="Extend draft expiry"
        description={draftToExtend ? `Set a later expiry date for draft ${draftToExtend.code}.` : undefined}
        size="sm"
      >
        <ModalBody className="space-y-3">
          <label htmlFor="draft-expiry" className="text-sm font-medium text-text-primary">
            New expiry date
          </label>
          <input
            id="draft-expiry"
            type="datetime-local"
            value={draftExpiryInput}
            onChange={(event) => setDraftExpiryInput(event.target.value)}
            className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-oak-primary"
          />
          {draftToExtend && (
            <p className="text-xs text-text-secondary">
              Current expiry: {formatDate(draftToExtend.expiresAt)}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraftToExtend(null);
              setDraftExpiryInput('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExtendDraftExpiry}
            isLoading={extendDraftExpiryMutation.isPending}
          >
            Extend expiry
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={!!draftAuditTarget}
        onClose={() => setDraftAuditTarget(null)}
        title="Draft audit log"
        description={draftAuditTarget ? `Activity for draft ${draftAuditTarget.code}.` : undefined}
        size="lg"
      >
        <ModalBody className="space-y-3">
          {isDraftAuditLoading ? (
            <p className="text-sm text-text-secondary">Loading audit log...</p>
          ) : draftAuditError instanceof Error ? (
            <p className="text-sm text-status-error">{draftAuditError.message}</p>
          ) : !draftAuditLogs || draftAuditLogs.length === 0 ? (
            <p className="text-sm text-text-secondary">No audit log entries found for this draft.</p>
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {draftAuditLogs.map((log) => {
                const actor = log.user
                  ? `${log.user.firstName} ${log.user.lastName}`.trim() || log.user.email
                  : 'System / public respondent';
                const metadataText = log.metadata && typeof log.metadata === 'object'
                  ? JSON.stringify(log.metadata, null, 2)
                  : '';

                return (
                  <div key={log.id} className="rounded-lg border border-border-primary bg-background-primary p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-text-primary">{log.summary || log.action}</p>
                        <p className="text-xs text-text-secondary">{formatDate(log.createdAt)}</p>
                      </div>
                      <span className="inline-flex w-fit rounded-full bg-background-tertiary px-2 py-0.5 text-2xs font-medium text-text-secondary">
                        {log.action}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-text-secondary sm:grid-cols-2">
                      <div>Actor: {actor}</div>
                      <div>IP: {log.ipAddress || '-'}</div>
                    </div>
                    {log.reason && (
                      <p className="mt-2 text-xs text-text-secondary">Reason: {log.reason}</p>
                    )}
                    {metadataText && (
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-background-elevated p-2 text-2xs text-text-secondary">
                        {metadataText}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setDraftAuditTarget(null)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={!!attachmentDialog}
        onClose={() => setAttachmentDialog(null)}
        title={attachmentDialog?.title}
        description={attachmentDialog?.description}
        size="lg"
      >
        <ModalBody className="space-y-3">
          {!attachmentDialog || attachmentDialog.attachments.length === 0 ? (
            <p className="text-sm text-text-secondary">No attachments linked.</p>
          ) : (
            <div className="space-y-2">
              {attachmentDialog.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={getAttachmentHref(attachmentDialog!.source, attachment.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-primary bg-background-primary px-3 py-2 transition-colors hover:bg-background-elevated"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">{attachment.fileName}</p>
                    <p className="text-xs text-text-secondary">
                      {formatFileSize(attachment.sizeBytes)} • {attachment.mimeType}
                    </p>
                  </div>
                  <div className="shrink-0 text-xs text-text-muted">
                    {formatDate(attachment.createdAt)}
                  </div>
                </a>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setAttachmentDialog(null)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
      </div>
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import type {
  EsigningEnvelopeStatus,
  EsigningFieldType,
  EsigningPdfGenerationStatus,
  EsigningRecipientAccessMode,
  EsigningRecipientStatus,
  EsigningRecipientType,
  EsigningSigningOrder,
} from '@/generated/prisma';
import type {
  EsigningCopyDeliveryStatusDto,
  EsigningEnvelopeRecipientDto,
  EsigningFieldDefinitionDto,
} from '@/types/esigning';
import type { BoundingBox } from '@/components/processing/document-page-viewer';
import { cn } from '@/lib/utils';

const BASE_PILL_CLASS =
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium';

const ENVELOPE_STATUS_STYLES: Record<EsigningEnvelopeStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-100 text-slate-700',
  SENT: 'border-blue-200 bg-blue-100 text-blue-700',
  IN_PROGRESS: 'border-amber-200 bg-amber-100 text-amber-700',
  COMPLETED: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  VOIDED: 'border-slate-200 bg-slate-100 text-slate-700',
  DECLINED: 'border-rose-200 bg-rose-100 text-rose-700',
  EXPIRED: 'border-orange-200 bg-orange-100 text-orange-700',
};

const RECIPIENT_STATUS_STYLES: Record<EsigningRecipientStatus, string> = {
  QUEUED: 'border-slate-200 bg-slate-100 text-slate-700',
  NOTIFIED: 'border-blue-200 bg-blue-100 text-blue-700',
  VIEWED: 'border-violet-200 bg-violet-100 text-violet-700',
  SIGNED: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  DECLINED: 'border-rose-200 bg-rose-100 text-rose-700',
};

const PDF_STATUS_STYLES: Record<EsigningPdfGenerationStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-100 text-amber-700',
  PROCESSING: 'border-sky-200 bg-sky-100 text-sky-700',
  COMPLETED: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  FAILED: 'border-rose-200 bg-rose-100 text-rose-700',
};

const COPY_DELIVERY_STATUS_LABELS: Record<EsigningCopyDeliveryStatusDto, string> = {
  AWAITING_COMPLETION: 'Copy after completion',
  PENDING: 'Copy pending',
  RETRYING: 'Retrying copy',
  SENT: 'Copy sent',
  FAILED: 'Copy failed',
  NOT_TRACKED: 'Delivery not tracked',
};

const COPY_DELIVERY_STATUS_STYLES: Record<EsigningCopyDeliveryStatusDto, string> = {
  AWAITING_COMPLETION: 'border-slate-200 bg-slate-100 text-slate-600',
  PENDING: 'border-amber-200 bg-amber-100 text-amber-700',
  RETRYING: 'border-orange-200 bg-orange-100 text-orange-700',
  SENT: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  FAILED: 'border-rose-200 bg-rose-100 text-rose-700',
  NOT_TRACKED: 'border-slate-200 bg-slate-100 text-slate-500',
};

export const ESIGNING_SIGNING_ORDER_LABELS: Record<EsigningSigningOrder, string> = {
  PARALLEL: 'Parallel',
  SEQUENTIAL: 'Sequential',
  MIXED: 'Mixed',
};

export const ESIGNING_RECIPIENT_TYPE_LABELS: Record<EsigningRecipientType, string> = {
  SIGNER: 'Signer',
  CC: 'Receives Copy',
};

export const ESIGNING_ACCESS_MODE_LABELS: Record<EsigningRecipientAccessMode, string> = {
  EMAIL_LINK: 'Email Link',
  EMAIL_WITH_CODE: 'Email + Code',
  MANUAL_LINK: 'Manual Link',
};

export const ESIGNING_FIELD_TYPE_LABELS: Record<EsigningFieldType, string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date Signed',
  NAME: 'Name',
  TEXT: 'Text',
  CHECKBOX: 'Checkbox',
  COMPANY: 'Company',
  TITLE: 'Title',
};

export function formatEsigningDateTime(value?: string | null): string {
  if (!value) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatEsigningFileSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function fromPercentInput(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, parsed / 100));
}

export function toPercentInput(value: number): string {
  return (value * 100).toFixed(1).replace(/\.0$/, '');
}

function Pill({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return <span className={cn(BASE_PILL_CLASS, className)}>{children}</span>;
}

export function EnvelopeStatusBadge({ status }: { status: EsigningEnvelopeStatus }) {
  return <Pill className={ENVELOPE_STATUS_STYLES[status]}>{status.replace('_', ' ')}</Pill>;
}

export function RecipientStatusBadge({ status, accessMode }: {
  status: EsigningRecipientStatus;
  accessMode: EsigningRecipientAccessMode;
}) {
  const label = status === 'NOTIFIED' && accessMode === 'MANUAL_LINK'
    ? 'LINK READY'
    : status.replace('_', ' ');
  return <Pill className={RECIPIENT_STATUS_STYLES[status]}>{label}</Pill>;
}

export function CopyDeliveryStatusBadge({
  status,
}: {
  status: EsigningCopyDeliveryStatusDto;
}) {
  return (
    <Pill className={COPY_DELIVERY_STATUS_STYLES[status]}>
      {COPY_DELIVERY_STATUS_LABELS[status]}
    </Pill>
  );
}

export function PdfGenerationBadge({ status }: { status: EsigningPdfGenerationStatus }) {
  return <Pill className={PDF_STATUS_STYLES[status]}>{status}</Pill>;
}

export function FieldTypeBadge({ type }: { type: EsigningFieldType }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border-primary bg-background-tertiary px-2 py-0.5 text-xs text-text-secondary">
      {ESIGNING_FIELD_TYPE_LABELS[type]}
    </span>
  );
}

export function getRecipientSummary(recipient: EsigningEnvelopeRecipientDto): string {
  if (recipient.type === 'CC') {
    return 'Copy only';
  }

  return `${recipient.requiredFieldsAssigned} required fields, ${recipient.signatureFieldsAssigned} signature blocks`;
}

export function buildFieldHighlights(
  fields: EsigningFieldDefinitionDto[],
  recipients: EsigningEnvelopeRecipientDto[],
  documentId: string,
  activeFieldId?: string | null
): BoundingBox[] {
  const recipientColorMap = new Map(recipients.map((recipient) => [recipient.id, recipient.colorTag]));

  return fields
    .filter((field) => field.documentId === documentId)
    .map((field) => ({
      pageNumber: field.pageNumber,
      x: field.xPercent,
      y: field.yPercent,
      width: field.widthPercent,
      height: field.heightPercent,
      label: field.label ?? ESIGNING_FIELD_TYPE_LABELS[field.type],
      color: field.id === activeFieldId ? '#f97316' : recipientColorMap.get(field.recipientId) ?? '#1d4ed8',
    }));
}

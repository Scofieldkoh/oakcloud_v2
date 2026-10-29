'use client';
import { esigningDisplayName } from '@/lib/esigning-branding';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Eye,
  FilePlus2,
  FileText,
  Loader2,
  PenLine,
  Send,
  ShieldAlert,
  ShieldCheck,
  Upload,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  EsigningEnvelopeStatus,
  EsigningRecipientAccessMode,
  EsigningRecipientStatus,
  EsigningRecipientType,
} from '@/generated/prisma';
import { Alert } from '@/components/ui/alert';
import {
  EnvelopeStatusBadge,
  ESIGNING_RECIPIENT_TYPE_LABELS,
  formatEsigningDateTime,
} from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';

// ─── Recipient color palette ──────────────────────────────────────────────────

const RECIPIENT_COLOR_SETS = [
  {
    avatar: 'bg-teal-600 text-white',
    cardBorder: 'border-teal-200 dark:border-teal-800/40',
    cardBg: 'bg-teal-50/50 dark:bg-teal-900/10',
    name: 'text-teal-700 dark:text-teal-400',
    tag: 'border-teal-200 bg-teal-100 text-teal-700',
    timelineDot: 'border-teal-500 bg-teal-50 text-teal-600',
    evidenceIcon: 'text-teal-600',
  },
  {
    avatar: 'bg-indigo-600 text-white',
    cardBorder: 'border-indigo-200 dark:border-indigo-800/40',
    cardBg: 'bg-indigo-50/50 dark:bg-indigo-900/10',
    name: 'text-indigo-700 dark:text-indigo-400',
    tag: 'border-indigo-200 bg-indigo-100 text-indigo-700',
    timelineDot: 'border-indigo-500 bg-indigo-50 text-indigo-600',
    evidenceIcon: 'text-indigo-600',
  },
  {
    avatar: 'bg-amber-600 text-white',
    cardBorder: 'border-amber-200 dark:border-amber-800/40',
    cardBg: 'bg-amber-50/50 dark:bg-amber-900/10',
    name: 'text-amber-700 dark:text-amber-400',
    tag: 'border-amber-200 bg-amber-100 text-amber-700',
    timelineDot: 'border-amber-500 bg-amber-50 text-amber-600',
    evidenceIcon: 'text-amber-600',
  },
  {
    avatar: 'bg-rose-600 text-white',
    cardBorder: 'border-rose-200 dark:border-rose-800/40',
    cardBg: 'bg-rose-50/50 dark:bg-rose-900/10',
    name: 'text-rose-700 dark:text-rose-400',
    tag: 'border-rose-200 bg-rose-100 text-rose-700',
    timelineDot: 'border-rose-500 bg-rose-50 text-rose-600',
    evidenceIcon: 'text-rose-600',
  },
  {
    avatar: 'bg-violet-600 text-white',
    cardBorder: 'border-violet-200 dark:border-violet-800/40',
    cardBg: 'bg-violet-50/50 dark:bg-violet-900/10',
    name: 'text-violet-700 dark:text-violet-400',
    tag: 'border-violet-200 bg-violet-100 text-violet-700',
    timelineDot: 'border-violet-500 bg-violet-50 text-violet-600',
    evidenceIcon: 'text-violet-600',
  },
  {
    avatar: 'bg-sky-600 text-white',
    cardBorder: 'border-sky-200 dark:border-sky-800/40',
    cardBg: 'bg-sky-50/50 dark:bg-sky-900/10',
    name: 'text-sky-700 dark:text-sky-400',
    tag: 'border-sky-200 bg-sky-100 text-sky-700',
    timelineDot: 'border-sky-500 bg-sky-50 text-sky-600',
    evidenceIcon: 'text-sky-600',
  },
] as const;

type RecipientColorSet = (typeof RECIPIENT_COLOR_SETS)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActionIcon(action?: string): LucideIcon {
  switch (action) {
    case 'CREATED': return FilePlus2;
    case 'SENT': return Send;
    case 'VIEWED': return Eye;
    case 'CONSENTED': return ShieldCheck;
    case 'SIGNED': return PenLine;
    case 'DECLINED': return XCircle;
    case 'VOIDED': return Ban;
    case 'COMPLETED': return CheckCircle2;
    case 'REMINDER_SENT': return Bell;
    case 'EXPIRED': return Clock;
    case 'PDF_GENERATION_FAILED': return AlertTriangle;
    default: return Activity;
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface VerificationResponse {
  certificateId: string;
  envelopeId: string;
  title: string;
  status: EsigningEnvelopeStatus;
  completedAt: string | null;
  tenantName: string;
  companyName: string | null;
  documents: Array<{
    id: string;
    fileName: string;
    hash: string;
    hasSignedCopy: boolean;
  }>;
  recipients: Array<{
    id: string;
    name: string;
    emailMasked: string;
    type: EsigningRecipientType;
    status: EsigningRecipientStatus;
    accessMode: EsigningRecipientAccessMode;
    accessModeLabel: string;
    signingOrder: number | null;
    viewedAt: string | null;
    consentedAt: string | null;
    consentIp: string | null;
    consentDevice: string | null;
    signedAt: string | null;
    signedIp: string | null;
    signedDevice: string | null;
  }>;
  events: TimelineEvent[];
}

interface VerificationMatchResponse {
  matched: boolean;
  fileHash: string;
  document: VerificationResponse['documents'][number] | null;
}

interface TimelineEvent {
  id: string;
  timestamp: string | null;
  action?: string;
  label: string;
  recipientId?: string | null;
  recipientName?: string | null;
  isPositive: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyHashButton({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="ml-1.5 inline-flex flex-shrink-0 items-center gap-1 rounded border border-border-primary px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-background-tertiary"
    >
      <ClipboardCopy className="h-2.5 w-2.5" />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DropZone({
  isChecking,
  onFile,
}: {
  isChecking: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file?.type === 'application/pdf') {
      onFile(file);
    }
  }

  function handleChange() {
    const file = inputRef.current?.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
        isDragOver
          ? 'border-oak-primary bg-oak-primary/5 text-oak-primary'
          : 'border-border-primary bg-background-primary text-text-muted hover:border-oak-primary/50 hover:text-text-secondary',
      )}
    >
      <Upload className={cn('h-7 w-7', isDragOver && 'text-oak-primary')} />
      <div>
        <p className="text-sm font-medium text-text-primary">
          {isChecking ? 'Verifying…' : 'Drop a PDF here, or click to browse'}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">PDF files only</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        name="verification-file"
        accept="application/pdf"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border-primary pb-4">
      <Icon className="h-4 w-4 text-oak-primary" />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-primary">{title}</h2>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EsigningVerifyPage() {
  const params = useParams();
  const certificateId = params.certificateId as string;
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<VerificationMatchResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadVerification() {
      try {
        setIsLoading(true);
        const response = await fetch(`/api/public-bootstrap/verify/${encodeURIComponent(certificateId)}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Certificate not found');
        }
        if (!cancelled) {
          setData(result.certificate ?? result);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load certificate');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadVerification();
    return () => {
      cancelled = true;
    };
  }, [certificateId]);

  async function checkFile(file: File) {
    try {
      setIsChecking(true);
      setMatchResult(null);
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch(`/api/esigning/verify/${encodeURIComponent(certificateId)}/check`, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Failed to verify file hash');
      }
      setMatchResult(result);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : 'Failed to verify file hash');
    } finally {
      setIsChecking(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-primary">
        <Loader2 className="h-8 w-8 animate-spin text-oak-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-primary p-6">
        <div className="w-full max-w-lg rounded-2xl border border-border-primary bg-background-secondary p-8 shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-4 text-center text-2xl font-semibold text-text-primary">Certificate unavailable</h1>
          <p className="mt-2 text-center text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  // Build recipient → color index map
  const recipientColorMap = new Map<string, RecipientColorSet>();
  data.recipients.forEach((r, i) => {
    recipientColorMap.set(r.id, RECIPIENT_COLOR_SETS[i % RECIPIENT_COLOR_SETS.length]);
  });

  const timeline = data.events;

  return (
    <div className="min-h-screen bg-background-primary">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">

        {/* ── Certificate Header ─────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-sm sm:rounded-3xl">
          {/* Brand accent bar */}
          <div className="h-1 w-full bg-oak-primary" />
          <div className="p-4 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-oak-primary" />
                  <span className="text-xs font-semibold uppercase tracking-[0.15em] text-oak-primary">
                    Certificate of Completion
                  </span>
                </div>
                <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{data.title}</h1>
                <p className="text-sm text-text-secondary">
                  {esigningDisplayName(data.tenantName)}
                  {data.companyName ? <span className="text-text-muted"> · {data.companyName}</span> : null}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <EnvelopeStatusBadge status={data.status} />
                  {data.completedAt ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border-primary px-2.5 py-1 text-xs text-text-secondary">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      Completed {formatEsigningDateTime(data.completedAt)}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Certificate ID badge */}
              <div className="flex-shrink-0 rounded-xl border border-border-primary bg-background-tertiary px-4 py-3 sm:text-right">
                <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-muted">Certificate ID</div>
                <div className="mt-1.5 font-mono text-sm font-bold text-text-primary">{data.certificateId}</div>
                <div className="mt-1 text-[10px] text-text-muted">{data.recipients.length} recipient{data.recipients.length !== 1 ? 's' : ''} · {data.documents.length} document{data.documents.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4 sm:space-y-6">

            {/* ── Audit Trail ───────────────────────────────────────────────── */}
            <section className="rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
              <SectionHeader icon={Activity} title="Audit Trail" />
              <div className="mt-5 space-y-0">
                {timeline.map((event, index) => {
                  const Icon = getActionIcon(event.action);
                  const recipientColor = event.recipientId
                    ? recipientColorMap.get(event.recipientId)
                    : undefined;

                  // Dot styling: use recipient color for recipient events, else positive/negative/neutral
                  const dotClass = recipientColor
                    ? recipientColor.timelineDot
                    : event.isPositive
                      ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                      : 'border-rose-400 bg-rose-50 text-rose-500';

                  // For recipient-linked events, highlight their name inline
                  const hasRecipient = Boolean(event.recipientId && event.recipientName);

                  return (
                    <div key={event.id} className="flex gap-3.5">
                      {/* Timeline spine */}
                      <div className="flex flex-col items-center">
                        <div className={cn('mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2', dotClass)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        {index < timeline.length - 1 ? (
                          <div className="my-1 w-px flex-1 bg-border-primary" />
                        ) : null}
                      </div>

                      {/* Event content */}
                      <div className={cn('min-w-0 flex-1', index < timeline.length - 1 ? 'pb-4' : 'pb-0')}>
                        <p className="text-sm font-medium text-text-primary leading-snug">
                          {hasRecipient && event.recipientName
                            ? (() => {
                                const name = event.recipientName;
                                const nameIdx = event.label.lastIndexOf(name);
                                if (nameIdx === -1) return event.label;
                                const before = event.label.slice(0, nameIdx);
                                const after = event.label.slice(nameIdx + name.length);
                                return (
                                  <>
                                    {before}
                                    <span className={recipientColor?.name ?? 'text-text-primary'}>
                                      {name}
                                    </span>
                                    {after}
                                  </>
                                );
                              })()
                            : event.label
                          }
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {event.timestamp ? formatEsigningDateTime(event.timestamp) : '—'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Recipients ───────────────────────────────────────────────── */}
            <section className="rounded-2xl border border-border-primary bg-background-secondary p-3 shadow-sm sm:rounded-3xl sm:p-6">
              <SectionHeader icon={Send} title="Signatories & Recipients" />
              <div className="mt-4 grid gap-3 sm:mt-5">
                {data.recipients.map((recipient) => {
                  const colors = recipientColorMap.get(recipient.id) ?? RECIPIENT_COLOR_SETS[0];
                  const initials = getInitials(recipient.name);

                  return (
                    <div
                      key={recipient.id}
                      className={cn(
                        'overflow-hidden rounded-xl border',
                        colors.cardBorder,
                        colors.cardBg,
                      )}
                    >
                      {/* Recipient header row */}
                      <div className="flex flex-wrap items-start gap-3 p-3 sm:flex-nowrap sm:p-4 sm:pb-3">
                        {/* Avatar */}
                        <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold', colors.avatar)}>
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
                          <div className={cn('text-sm font-semibold leading-snug', colors.name)}>{recipient.name}</div>
                          <div className="mt-0.5 break-words text-xs leading-snug text-text-secondary">{recipient.emailMasked}</div>
                        </div>
                        {/* Badges */}
                        <div className="flex w-full flex-wrap gap-1.5 pl-12 sm:w-auto sm:justify-end sm:pl-0">
                          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', colors.tag)}>
                            {ESIGNING_RECIPIENT_TYPE_LABELS[recipient.type]}
                          </span>
                          <span className="inline-flex items-center rounded-full border border-border-primary bg-background-primary px-2 py-0.5 text-[11px] text-text-secondary">
                            {recipient.accessModeLabel}
                          </span>
                        </div>
                      </div>

                      {/* Evidence rows */}
                      <div className="space-y-2.5 border-t border-border-primary bg-background-primary/50 px-3 py-3 sm:space-y-2 sm:px-4">
                        {/* Viewed */}
                        <div className="flex items-start gap-2.5 text-xs">
                          <Eye className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', recipient.viewedAt ? colors.evidenceIcon : 'text-text-muted')} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                              <span className="font-medium text-text-primary">Viewed</span>
                              <span className="text-text-secondary">
                                {recipient.viewedAt ? formatEsigningDateTime(recipient.viewedAt) : 'Not recorded'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Consented */}
                        <div className="flex items-start gap-2.5 text-xs">
                          <ShieldCheck className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', recipient.consentedAt ? colors.evidenceIcon : 'text-text-muted')} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                              <span className="font-medium text-text-primary">Consented</span>
                              <span className="text-text-secondary">
                                {recipient.consentedAt ? formatEsigningDateTime(recipient.consentedAt) : 'Not recorded'}
                              </span>
                            </div>
                            {recipient.consentedAt && (recipient.consentIp || recipient.consentDevice) ? (
                              <div className="mt-0.5 break-words leading-snug text-text-muted">
                                {[recipient.consentIp, recipient.consentDevice].filter(Boolean).join(' · ')}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Signed */}
                        <div className="flex items-start gap-2.5 text-xs">
                          <PenLine className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', recipient.signedAt ? colors.evidenceIcon : recipient.status === 'DECLINED' ? 'text-rose-500' : 'text-text-muted')} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                              <span className="font-medium text-text-primary">Signed</span>
                              <span className={cn(recipient.signedAt ? colors.name : recipient.status === 'DECLINED' ? 'text-rose-600' : 'text-text-secondary')}>
                                {recipient.signedAt
                                  ? formatEsigningDateTime(recipient.signedAt)
                                  : recipient.status === 'DECLINED'
                                    ? 'Declined to sign'
                                    : 'Awaiting signature'}
                              </span>
                            </div>
                            {recipient.signedAt && (recipient.signedIp || recipient.signedDevice) ? (
                              <div className="mt-0.5 break-words leading-snug text-text-muted">
                                {[recipient.signedIp, recipient.signedDevice].filter(Boolean).join(' · ')}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Documents ────────────────────────────────────────────────── */}
            <section className="rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
              <SectionHeader icon={FileText} title="Documents" />
              <div className="mt-5 grid gap-3">
                {data.documents.map((document) => (
                  <div
                    key={document.id}
                    className={cn(
                      'rounded-xl border p-4',
                      document.hasSignedCopy
                        ? 'border-oak-primary/30 bg-oak-primary/5'
                        : 'border-border-primary bg-background-primary',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileText className={cn('h-4 w-4 flex-shrink-0', document.hasSignedCopy ? 'text-oak-primary' : 'text-text-muted')} />
                        <span className="text-sm font-semibold text-text-primary">{document.fileName}</span>
                      </div>
                      <span
                        className={cn(
                          'flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                          document.hasSignedCopy
                            ? 'border-oak-primary/30 text-oak-primary'
                            : 'border-border-primary text-text-muted',
                        )}
                      >
                        {document.hasSignedCopy ? 'Signed artifact' : 'Original hash only'}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-background-tertiary px-3 py-2">
                      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">SHA-256</span>
                      <code className="flex-1 break-all text-[11px] text-text-secondary">{document.hash}</code>
                      <CopyHashButton hash={document.hash} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ── Verify a File (sidebar) ─────────────────────────────────── */}
          <section className="rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
            <SectionHeader icon={ShieldCheck} title="Verify a File" />
            <p className="mt-3 text-sm text-text-secondary">
              Upload a PDF to compare its SHA-256 hash against the documents registered under this certificate.
            </p>
            <div className="mt-4">
              <DropZone isChecking={isChecking} onFile={checkFile} />
            </div>

            {matchResult ? (
              <div className="mt-4">
                {matchResult.matched ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/40 dark:bg-emerald-900/20">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm font-semibold">Hash matched</span>
                    </div>
                    <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                      This file matches <strong>{matchResult.document?.fileName}</strong>.
                    </p>
                    <code className="mt-2 block break-all rounded bg-emerald-100 px-2 py-1.5 text-[11px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      {matchResult.fileHash}
                    </code>
                  </div>
                ) : (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800/40 dark:bg-rose-900/20">
                    <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                      <XCircle className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm font-semibold">Hash mismatch</span>
                    </div>
                    <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">
                      The uploaded file does not match any document registered under this certificate.
                    </p>
                    <code className="mt-2 block break-all rounded bg-rose-100 px-2 py-1.5 text-[11px] text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                      {matchResult.fileHash}
                    </code>
                  </div>
                )}
              </div>
            ) : null}

            {error ? (
              <Alert variant="error" title="Verification error" className="mt-4">
                {error}
              </Alert>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

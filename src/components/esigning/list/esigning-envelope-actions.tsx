'use client';

import Link from 'next/link';
import { AlertTriangle, Copy, Download, ExternalLink, MoreHorizontal, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import { Dropdown, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import type { EsigningEnvelopeListItem } from '@/types/esigning';

export function EmailDeliveryWarningBadge({ envelope }: { envelope: EsigningEnvelopeListItem }) {
  if (envelope.emailDelivery.status !== 'failed') {
    return null;
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
      title="Some e-signing emails failed to send"
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      Email failed
    </span>
  );
}

export interface EnvelopeActionsDropdownProps {
  envelope: EsigningEnvelopeListItem;
  onDuplicate: (envelope: EsigningEnvelopeListItem) => void;
  onResend: (envelope: EsigningEnvelopeListItem) => void;
  onDelete: (envelope: EsigningEnvelopeListItem) => void;
  onVoid: (envelope: EsigningEnvelopeListItem) => void;
  onRetryPdf: (envelopeId: string) => void;
  onDownload: (
    envelopeId: string,
    tenantId: string,
    variant: 'documents' | 'documents_with_certificates' | 'certificates'
  ) => void;
}

export function EnvelopeActionsDropdown({
  envelope,
  onDuplicate,
  onResend,
  onDelete,
  onVoid,
  onRetryPdf,
  onDownload,
}: EnvelopeActionsDropdownProps) {
  const hasActions =
    envelope.canResend ||
    envelope.canDelete ||
    envelope.canDuplicate ||
    envelope.canVoid ||
    envelope.canRetryCompletionProcessing ||
    envelope.status === 'COMPLETED';

  if (!hasActions) {
    return null;
  }

  return (
    <Dropdown>
      <DropdownTrigger asChild aria-label={`Actions for ${envelope.title}`}>
        <button className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-background-tertiary hover:text-text-primary">
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownTrigger>
      <DropdownMenu>
        <Link href={`/esigning/${envelope.id}`}>
          <DropdownItem icon={<ExternalLink className="h-4 w-4" />}>Open envelope</DropdownItem>
        </Link>

        {envelope.status === 'COMPLETED' ? (
          <>
            <DropdownItem
              icon={<Download className="h-4 w-4" />}
              onClick={() => onDownload(envelope.id, envelope.tenantId, 'documents')}
            >
              Document only
            </DropdownItem>
            <DropdownItem
              icon={<Download className="h-4 w-4" />}
              onClick={() => onDownload(envelope.id, envelope.tenantId, 'documents_with_certificates')}
            >
              Document + Certificate
            </DropdownItem>
            <DropdownItem
              icon={<Download className="h-4 w-4" />}
              onClick={() => onDownload(envelope.id, envelope.tenantId, 'certificates')}
            >
              Certificate only
            </DropdownItem>
          </>
        ) : null}

        {envelope.canResend ? (
          <DropdownItem
            icon={<Send className="h-4 w-4" />}
            onClick={() => onResend(envelope)}
          >
            Resend active requests
          </DropdownItem>
        ) : null}

        {envelope.canDuplicate ? (
          <DropdownItem
            icon={<Copy className="h-4 w-4" />}
            onClick={() => onDuplicate(envelope)}
          >
            Duplicate envelope
          </DropdownItem>
        ) : null}

        {envelope.canRetryCompletionProcessing ? (
          <DropdownItem
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => onRetryPdf(envelope.id)}
          >
            {envelope.pdfGenerationStatus === 'FAILED'
              ? 'Retry processing'
              : 'Resume processing'}
          </DropdownItem>
        ) : null}

        {envelope.canVoid || envelope.canDelete ? <DropdownSeparator /> : null}

        {envelope.canVoid ? (
          <DropdownItem
            destructive
            icon={<XCircle className="h-4 w-4" />}
            onClick={() => onVoid(envelope)}
          >
            Void envelope
          </DropdownItem>
        ) : null}

        {envelope.canDelete ? (
          <DropdownItem
            destructive
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => onDelete(envelope)}
          >
            {envelope.status === 'COMPLETED' ? 'Delete envelope' : 'Delete draft'}
          </DropdownItem>
        ) : null}
      </DropdownMenu>
    </Dropdown>
  );
}

/** The row actions every envelope view passes to `EnvelopeActionsDropdown`. */
export type EnvelopeActionHandlers = Omit<EnvelopeActionsDropdownProps, 'envelope'>;

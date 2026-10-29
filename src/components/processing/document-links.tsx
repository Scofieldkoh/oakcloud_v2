'use client';

import { useState, useCallback } from 'react';
import {
  Link2,
  Plus,
  X,
  Search,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  useDocumentLinks,
  useLinkableDocuments,
  useCreateDocumentLink,
  useDeleteDocumentLink,
  type DocumentLink,
  type LinkableDocument,
} from '@/hooks/use-processing-documents';
import Link from 'next/link';

// Link type options for the dropdown
const linkTypeOptions = [
  { value: 'RELATED', label: 'Related Document' },
  { value: 'PO_TO_DN', label: 'PO \u2192 Delivery Note' },
  { value: 'PO_TO_INVOICE', label: 'PO \u2192 Invoice' },
  { value: 'DN_TO_INVOICE', label: 'Delivery Note \u2192 Invoice' },
  { value: 'INVOICE_TO_CN', label: 'Invoice \u2192 Credit Note' },
  { value: 'INVOICE_TO_DN_ADJ', label: 'Invoice \u2192 Debit Note' },
  { value: 'QUOTE_TO_PO', label: 'Quote \u2192 PO' },
  { value: 'CONTRACT_TO_PO', label: 'Contract \u2192 PO' },
];

interface DocumentLinksProps {
  documentId: string;
  canUpdate: boolean;
}

export function DocumentLinks({ documentId, canUpdate }: DocumentLinksProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);

  const { data: links, isLoading } = useDocumentLinks(documentId);
  const deleteLinkMutation = useDeleteDocumentLink();

  const handleDeleteLink = async () => {
    if (!deletingLinkId) return;
    try {
      await deleteLinkMutation.mutateAsync({
        documentId,
        linkId: deletingLinkId,
      });
      setDeletingLinkId(null);
    } catch (err) {
      console.error('Failed to delete link:', err);
    }
  };

  // Currency symbols mapping - SGD displayed as "S$"
  const CURRENCY_SYMBOLS: Record<string, string> = {
    SGD: 'S$', USD: 'US$', EUR: 'â‚¬', GBP: ' £', JPY: ' ¥', HKD: 'HK$', AUD: 'A$', MYR: 'RM',
  };

  const formatCurrency = (amount: string | null, currency: string | null) => {
    if (!amount) return '-';
    const num = parseFloat(amount);
    if (isNaN(num)) return '-';

    const formatted = new Intl.NumberFormat('en-SG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);

    const currCode = currency || 'SGD';
    const symbol = CURRENCY_SYMBOLS[currCode] || `${currCode} `;
    return `${symbol}${formatted}`;
  };

  return (
    <div className="mt-6">
      {/* Header - matches section headers in the page */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between mb-3 group"
      >
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            Linked Documents
          </span>
          {links && links.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-oak-primary/10 text-oak-primary">
              {links.length}
            </span>
          )}
        </div>
        <span className="text-text-muted group-hover:text-text-secondary transition-colors">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
            </div>
          ) : links && links.length > 0 ? (
            <div className="space-y-2">
              {links.map((link) => (
                <LinkedDocumentCard
                  key={link.linkId}
                  link={link}
                  canDelete={canUpdate}
                  onDelete={() => setDeletingLinkId(link.linkId)}
                  formatCurrency={formatCurrency}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted py-2">No linked documents</p>
          )}

          {canUpdate && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowAddModal(true)}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Link Document
            </Button>
          )}
        </div>
      )}

      {/* Add Link Modal */}
      <AddLinkModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        documentId={documentId}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingLinkId}
        onClose={() => setDeletingLinkId(null)}
        onConfirm={handleDeleteLink}
        title="Remove Link"
        description="Are you sure you want to remove this document link? The documents will no longer be associated."
        confirmLabel="Remove"
        variant="danger"
        isLoading={deleteLinkMutation.isPending}
      />
    </div>
  );
}

// Linked document card component
function LinkedDocumentCard({
  link,
  canDelete,
  onDelete,
  formatCurrency,
}: {
  link: DocumentLink;
  canDelete: boolean;
  onDelete: () => void;
  formatCurrency: (amount: string | null, currency: string | null) => string;
}) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded border border-border-primary bg-background-secondary hover:bg-background-tertiary transition-colors group">
      <FileText className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Link
            href={`/processing/${link.id}`}
            className="text-sm text-text-primary hover:text-oak-primary truncate"
          >
            {link.fileName}
          </Link>
          <Link
            href={`/processing/${link.id}`}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <ExternalLink className="w-3 h-3 text-text-muted hover:text-oak-primary" />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
          <span className="px-1.5 py-0.5 rounded bg-background-tertiary text-text-muted text-2xs">
            {link.linkTypeLabel}
          </span>
          {link.vendorName && <span>{link.vendorName}</span>}
          {link.documentNumber && <span>#{link.documentNumber}</span>}
          {link.totalAmount && (
            <span className="font-medium text-text-primary">
              {formatCurrency(link.totalAmount, link.currency)}
            </span>
          )}
        </div>
        {link.notes && (
          <p className="text-2xs text-text-muted mt-1 truncate">{link.notes}</p>
        )}
      </div>
      {canDelete && (
        <button
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-status-error/10 transition-all flex-shrink-0"
          title="Remove link"
        >
          <Trash2 className="w-3.5 h-3.5 text-status-error" />
        </button>
      )}
    </div>
  );
}

// Add link modal component
function AddLinkModal({
  isOpen,
  onClose,
  documentId,
}: {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<LinkableDocument | null>(null);
  const [linkType, setLinkType] = useState('RELATED');
  const [notes, setNotes] = useState('');

  const { data: linkableDocuments, isLoading } = useLinkableDocuments(
    isOpen ? documentId : null,
    searchQuery
  );
  const createLinkMutation = useCreateDocumentLink();

  const handleClose = useCallback(() => {
    setSearchQuery('');
    setSelectedDoc(null);
    setLinkType('RELATED');
    setNotes('');
    onClose();
  }, [onClose]);

  const handleCreate = async () => {
    if (!selectedDoc) return;
    try {
      await createLinkMutation.mutateAsync({
        documentId,
        targetDocumentId: selectedDoc.id,
        linkType,
        notes: notes || undefined,
      });
      handleClose();
    } catch (err) {
      console.error('Failed to create link:', err);
    }
  };

  // Currency symbols mapping - SGD displayed as "S$"
  const CURRENCY_SYMBOLS: Record<string, string> = {
    SGD: 'S$', USD: 'US$', EUR: 'â‚¬', GBP: ' £', JPY: ' ¥', HKD: 'HK$', AUD: 'A$', MYR: 'RM',
  };

  const formatCurrency = (amount: string | null, currency: string | null) => {
    if (!amount) return '-';
    const num = parseFloat(amount);
    if (isNaN(num)) return '-';

    const formatted = new Intl.NumberFormat('en-SG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);

    const currCode = currency || 'SGD';
    const symbol = CURRENCY_SYMBOLS[currCode] || `${currCode} `;
    return `${symbol}${formatted}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-SG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Link Document" size="lg">
      <div className="p-4 space-y-4">
        {/* Step 1: Search and select document */}
        {!selectedDoc ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by filename, vendor, or document number..."
                className="input input-sm pl-10 w-full"
                autoFocus
              />
            </div>

            <div className="max-h-80 overflow-y-auto border border-border-primary rounded">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
                </div>
              ) : linkableDocuments && linkableDocuments.length > 0 ? (
                <div className="divide-y divide-border-primary">
                  {linkableDocuments.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      className="w-full flex items-start gap-3 p-3 hover:bg-background-tertiary transition-colors text-left"
                    >
                      <FileText className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-primary truncate">
                          {doc.fileName}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary mt-0.5">
                          {doc.documentCategory && (
                            <span className="px-1.5 py-0.5 rounded bg-background-tertiary text-2xs">
                              {doc.documentCategory.replace(/_/g, ' ')}
                            </span>
                          )}
                          {doc.vendorName && <span>{doc.vendorName}</span>}
                          {doc.documentNumber && <span>#{doc.documentNumber}</span>}
                          {doc.totalAmount && (
                            <span className="font-medium text-text-primary">
                              {formatCurrency(doc.totalAmount, doc.currency)}
                            </span>
                          )}
                          <span className="text-text-muted">
                            {formatDate(doc.createdAt)}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-text-muted">
                  <FileText className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">
                    {searchQuery
                      ? 'No matching documents found'
                      : 'No documents available to link'}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Step 2: Configure link */}
            <div className="p-3 rounded border border-border-primary bg-background-secondary">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-oak-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">
                    {selectedDoc.fileName}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary mt-0.5">
                    {selectedDoc.vendorName && <span>{selectedDoc.vendorName}</span>}
                    {selectedDoc.documentNumber && (
                      <span>#{selectedDoc.documentNumber}</span>
                    )}
                    {selectedDoc.totalAmount && (
                      <span className="font-medium text-text-primary">
                        {formatCurrency(selectedDoc.totalAmount, selectedDoc.currency)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedDoc(null)}
                  className="p-1 rounded hover:bg-background-tertiary transition-colors"
                >
                  <X className="w-4 h-4 text-text-muted" />
                </button>
              </div>
            </div>

            <div>
              <label className="label mb-1.5">Link Type</label>
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                className="input input-sm w-full"
              >
                {linkTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label mb-1.5">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a note about this link..."
                className="input input-sm w-full h-20 resize-none"
              />
            </div>
          </>
        )}
      </div>

      {/* Actions Footer */}
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-primary bg-background-tertiary">
        <Button variant="secondary" size="sm" onClick={handleClose}>
          Cancel
        </Button>
        {selectedDoc && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreate}
            isLoading={createLinkMutation.isPending}
            leftIcon={<Link2 className="w-3.5 h-3.5" />}
          >
            Create Link
          </Button>
        )}
      </div>
    </Modal>
  );
}

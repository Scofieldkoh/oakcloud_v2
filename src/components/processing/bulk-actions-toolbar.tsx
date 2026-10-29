'use client';

import { useState, useMemo } from 'react';
import {
  CheckCircle,
  Play,
  Trash2,
  Download,
  FileSpreadsheet,
  X,
  AlertTriangle,
  Loader2,
  Merge,
  Calculator,
} from 'lucide-react';
import { useBulkOperation, useBulkDownloadZip, useBulkExport, useBulkMerge, type ProcessingDocumentListItem } from '@/hooks/use-processing-documents';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

type BulkOperation = 'APPROVE' | 'TRIGGER_EXTRACTION' | 'DELETE' | 'DOWNLOAD_ZIP' | 'EXPORT' | 'MERGE';

/** Amounts aggregated by currency */
interface CurrencyAmounts {
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  count: number;
}

/** Summary statistics for selected documents */
interface SelectionSummary {
  count: number;
  /** Amounts grouped by document currency */
  byCurrency: CurrencyAmounts[];
  /** Home currency totals (if all docs have same home currency) */
  home: {
    currency: string | null;
    subtotal: number;
    tax: number;
    total: number;
    isMixed: boolean; // true if multiple home currencies
  };
  hasAmounts: boolean;
}

interface BulkActionsToolbarProps {
  selectedIds: string[];
  /** Optional: Pass selected documents to show amount summaries */
  selectedDocuments?: ProcessingDocumentListItem[];
  onClearSelection: () => void;
  className?: string;
}

const operations: {
  id: BulkOperation;
  label: string;
  icon: typeof CheckCircle;
  description: string;
  variant: 'default' | 'warning' | 'danger';
  requiresConfirmation: boolean;
  minSelection?: number;
  maxSelection?: number;
}[] = [
    {
      id: 'DOWNLOAD_ZIP',
      label: 'Download ZIP',
      icon: Download,
      description: 'Download selected documents as ZIP',
      variant: 'default',
      requiresConfirmation: false,
    },
    {
      id: 'EXPORT',
      label: 'Export Excel',
      icon: FileSpreadsheet,
      description: 'Export selected documents to Excel',
      variant: 'default',
      requiresConfirmation: false,
    },
    {
      id: 'APPROVE',
      label: 'Approve',
      icon: CheckCircle,
      description: 'Approve selected documents with DRAFT revisions',
      variant: 'default',
      requiresConfirmation: true,
    },
    {
      id: 'TRIGGER_EXTRACTION',
      label: 'Re-extract',
      icon: Play,
      description: 'Trigger extraction for selected documents',
      variant: 'default',
      requiresConfirmation: true,
    },
    {
      id: 'DELETE',
      label: 'Delete',
      icon: Trash2,
      description: 'Delete selected documents',
      variant: 'danger',
      requiresConfirmation: true,
    },
    {
      id: 'MERGE',
      label: 'Merge',
      icon: Merge,
      description: 'Merge selected documents into one PDF',
      variant: 'default',
      requiresConfirmation: true,
      minSelection: 2, // Requires at least 2 documents
      maxSelection: 100,
    },
  ];

// Currency symbols mapping - matches processing page
const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: 'S$',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  HKD: 'HK$',
  AUD: 'A$',
  MYR: 'RM',
};

/** Format currency amount with symbol - matches processing page formatCurrency */
function formatCurrency(amount: number, currency: string): string {
  if (amount === 0) return '-';
  const formatted = new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return `${symbol}${formatted}`;
}

/** Calculate selection summary from documents */
function calculateSummary(documents: ProcessingDocumentListItem[]): SelectionSummary {
  const currencyMap = new Map<string, CurrencyAmounts>();
  const homeCurrencies = new Set<string>();
  let homeSubtotal = 0;
  let homeTax = 0;
  let homeTotal = 0;
  let hasAmounts = false;

  for (const doc of documents) {
    const rev = doc.currentRevision;
    if (!rev) continue;

    const currency = rev.currency || 'USD';
    const subtotal = parseFloat(rev.subtotal || '0') || 0;
    const tax = parseFloat(rev.taxAmount || '0') || 0;
    const total = parseFloat(rev.totalAmount || '0') || 0;

    if (subtotal !== 0 || tax !== 0 || total !== 0) {
      hasAmounts = true;
    }

    // Aggregate by document currency
    const existing = currencyMap.get(currency);
    if (existing) {
      existing.subtotal += subtotal;
      existing.tax += tax;
      existing.total += total;
      existing.count += 1;
    } else {
      currencyMap.set(currency, { currency, subtotal, tax, total, count: 1 });
    }

    // Aggregate home currency amounts
    if (rev.homeCurrency) {
      homeCurrencies.add(rev.homeCurrency);
      homeSubtotal += parseFloat(rev.homeSubtotal || '0') || 0;
      homeTax += parseFloat(rev.homeTaxAmount || '0') || 0;
      homeTotal += parseFloat(rev.homeEquivalent || '0') || 0;
    }
  }

  // Sort currencies by total amount (descending)
  const byCurrency = Array.from(currencyMap.values()).sort((a, b) => b.total - a.total);

  return {
    count: documents.length,
    byCurrency,
    home: {
      currency: homeCurrencies.size === 1 ? Array.from(homeCurrencies)[0] : null,
      subtotal: homeSubtotal,
      tax: homeTax,
      total: homeTotal,
      isMixed: homeCurrencies.size > 1,
    },
    hasAmounts,
  };
}

export function BulkActionsToolbar({
  selectedIds,
  selectedDocuments,
  onClearSelection,
  className,
}: BulkActionsToolbarProps) {
  const bulkOperation = useBulkOperation();
  const bulkDownloadZip = useBulkDownloadZip();
  const bulkExport = useBulkExport();
  const bulkMerge = useBulkMerge();
  const { success, error: toastError } = useToast();

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    operation: BulkOperation | null;
  }>({ isOpen: false, operation: null });

  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Calculate summary when documents are provided
  const summary = useMemo(() => {
    if (!selectedDocuments || selectedDocuments.length === 0) return null;
    return calculateSummary(selectedDocuments);
  }, [selectedDocuments]);

  const handleDownloadZip = async () => {
    setActiveOperationId('DOWNLOAD_ZIP');
    try {
      const blob = await bulkDownloadZip.mutateAsync(selectedIds);

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      link.download = `documents-${dateStr}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      success(`Downloaded ${selectedIds.length} document${selectedIds.length > 1 ? 's' : ''} as ZIP`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to download ZIP');
    } finally {
      setActiveOperationId(null);
    }
  };

  const handleExport = async () => {
    setActiveOperationId('EXPORT');
    try {
      const blob = await bulkExport.mutateAsync(selectedIds);

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      link.download = `export-${dateStr}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      success(`Exported ${selectedIds.length} document${selectedIds.length > 1 ? 's' : ''} to Excel`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to export');
    } finally {
      setActiveOperationId(null);
    }
  };

  const handleOperation = (operation: BulkOperation) => {
    const op = operations.find((o) => o.id === operation);
    if (op && !op.requiresConfirmation) {
      // Execute immediately without confirmation
      if (operation === 'DOWNLOAD_ZIP') {
        handleDownloadZip();
      } else if (operation === 'EXPORT') {
        handleExport();
      }
      return;
    }
    setConfirmDialog({ isOpen: true, operation });
  };

  const executeOperation = async () => {
    if (!confirmDialog.operation || confirmDialog.operation === 'DOWNLOAD_ZIP' || confirmDialog.operation === 'EXPORT') return;

    try {
      // Handle MERGE operation separately
      if (confirmDialog.operation === 'MERGE') {
        const result = await bulkMerge.mutateAsync(selectedIds);
        success(
          `Successfully merged ${selectedIds.length} documents into one. Created document: ${result.mergedDocumentId}`
        );
        setConfirmDialog({ isOpen: false, operation: null });
        onClearSelection();
        return;
      }

      // Handle other bulk operations (APPROVE, TRIGGER_EXTRACTION, DELETE)
      const result = await bulkOperation.mutateAsync({
        operation: confirmDialog.operation,
        documentIds: selectedIds,
      });

      if (result.summary.succeeded > 0) {
        success(
          `Successfully processed ${result.summary.succeeded} of ${result.summary.total} documents`
        );
      }

      if (result.summary.failed > 0) {
        const failedResults = result.results.filter((r) => !r.success);
        const errorMessages = [...new Set(failedResults.map((r) => r.error))].join(', ');
        toastError(`${result.summary.failed} documents failed: ${errorMessages}`);
      }

      setConfirmDialog({ isOpen: false, operation: null });
      onClearSelection();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to execute bulk operation');
    }
  };

  const currentOp = operations.find((op) => op.id === confirmDialog.operation);

  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className={cn(
          'fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40',
          'bg-background-primary border border-border-primary rounded-lg shadow-xl',
          'flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3',
          'max-w-[calc(100%-2rem)] sm:max-w-none',
          'animate-in slide-in-from-bottom-4',
          className
        )}
      >
        {/* Selection count and summary toggle */}
        <div className="flex items-center gap-1 sm:gap-2 pr-2 sm:pr-3 border-r border-border-primary">
          <span className="text-xs sm:text-sm text-text-secondary whitespace-nowrap">
            <span className="font-medium text-text-primary">{selectedIds.length}</span>
            <span className="hidden xs:inline"> selected</span>
          </span>
          {/* Summary toggle button - only show if we have documents with amounts */}
          {summary?.hasAmounts && (
            <button
              onClick={() => setShowSummary(!showSummary)}
              className={cn(
                'btn-ghost btn-xs p-1 min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0',
                showSummary && 'bg-oak-primary/10 text-oak-primary'
              )}
              title={showSummary ? 'Hide totals' : 'Show totals'}
            >
              <Calculator className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClearSelection}
            className="btn-ghost btn-xs p-1 min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          {operations.map((op) => {
            const Icon = op.icon;
            const isLoading =
              (bulkOperation.isPending && confirmDialog.operation === op.id && op.id !== 'MERGE') ||
              (bulkMerge.isPending && confirmDialog.operation === 'MERGE' && op.id === 'MERGE') ||
              (activeOperationId === op.id);
            const meetsMinSelection = !op.minSelection || selectedIds.length >= op.minSelection;
            const meetsMaxSelection = !op.maxSelection || selectedIds.length <= op.maxSelection;
            const isDisabled =
              bulkOperation.isPending ||
              bulkMerge.isPending ||
              activeOperationId !== null ||
              !meetsMinSelection ||
              !meetsMaxSelection;

            return (
              <button
                key={op.id}
                onClick={() => handleOperation(op.id)}
                disabled={isDisabled}
                className={cn(
                  'flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-2 sm:py-1.5 rounded-md transition-colors',
                  'min-h-[40px] sm:min-h-0',
                  op.variant === 'danger'
                    ? 'hover:bg-status-error/10 hover:text-status-error text-text-secondary'
                    : op.variant === 'warning'
                      ? 'hover:bg-status-warning/10 hover:text-status-warning text-text-secondary'
                      : 'hover:bg-oak-light/10 hover:text-oak-primary text-text-secondary',
                  isDisabled && 'opacity-50 cursor-not-allowed'
                )}
                title={
                  !meetsMinSelection && op.minSelection
                    ? `Requires at least ${op.minSelection} documents selected`
                    : !meetsMaxSelection && op.maxSelection
                      ? `Supports up to ${op.maxSelection} documents at once`
                    : op.description
                }
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                <span className="text-xs sm:text-sm hidden sm:inline">{op.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary Panel - appears above the toolbar */}
      {showSummary && summary && summary.hasAmounts && (
        <div
          className={cn(
            'fixed bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 z-40',
            'bg-background-primary border border-border-primary rounded-lg shadow-xl',
            'px-4 py-3 min-w-[340px] max-w-[90vw]',
            'animate-in slide-in-from-bottom-2 fade-in-0'
          )}
        >
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Calculator className="w-4 h-4 text-oak-primary" />
              Selection Summary
            </h4>
            <button
              onClick={() => setShowSummary(false)}
              className="btn-ghost btn-xs p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Document currency totals */}
            {summary.byCurrency.map((curr) => (
              <div key={curr.currency}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-text-primary">
                    {curr.currency}
                    <span className="text-text-muted font-normal text-xs ml-1.5">
                      ({curr.count} doc{curr.count > 1 ? 's' : ''})
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-text-muted mb-0.5">Subtotal</div>
                    <div className="text-sm text-text-primary">{formatCurrency(curr.subtotal, curr.currency)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted mb-0.5">Tax</div>
                    <div className="text-sm text-text-primary">{formatCurrency(curr.tax, curr.currency)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted mb-0.5">Total</div>
                    <div className="text-sm text-text-primary font-medium">{formatCurrency(curr.total, curr.currency)}</div>
                  </div>
                </div>
              </div>
            ))}

            {/* Home currency totals */}
            {summary.home.currency && !summary.home.isMixed && (
              <div className="border-t border-border-primary pt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-oak-primary">
                    Home Currency
                    <span className="text-xs ml-1.5">({summary.home.currency})</span>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-text-muted mb-0.5">Subtotal</div>
                    <div className="text-sm text-text-primary">{formatCurrency(summary.home.subtotal, summary.home.currency)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted mb-0.5">Tax</div>
                    <div className="text-sm text-text-primary">{formatCurrency(summary.home.tax, summary.home.currency)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted mb-0.5">Total</div>
                    <div className="text-sm text-oak-primary font-medium">{formatCurrency(summary.home.total, summary.home.currency)}</div>
                  </div>
                </div>
              </div>
            )}
            {summary.home.isMixed && (
              <div className="border-t border-border-primary pt-3">
                <p className="text-xs text-text-muted">
                  Home currency totals unavailable (mixed currencies)
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, operation: null })}
        onConfirm={executeOperation}
        title={`${currentOp?.label} ${selectedIds.length} Documents`}
        description={
          <div className="space-y-2">
            <p>{currentOp?.description}</p>
            {confirmDialog.operation === 'DELETE' && (
              <div className="flex items-start gap-2 p-2 bg-status-warning/10 rounded text-sm text-status-warning">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Deleted documents can be restored from Data Purge.</span>
              </div>
            )}
          </div>
        }
        confirmLabel={
          bulkOperation.isPending || bulkMerge.isPending
            ? 'Processing...'
            : `${currentOp?.label} ${selectedIds.length} Documents`
        }
        variant={confirmDialog.operation === 'DELETE' ? 'danger' : 'info'}
        isLoading={bulkOperation.isPending || bulkMerge.isPending}
      />
    </>
  );
}

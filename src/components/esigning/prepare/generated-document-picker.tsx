'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Loader2, Search } from 'lucide-react';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { CompanySelect } from '@/components/ui/company-select';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface GeneratedDocumentPickerItem {
  id: string;
  title: string;
  updatedAt: string;
  company?: {
    id: string;
    name: string;
    uen?: string | null;
  } | null;
}

interface GeneratedDocumentPickerResponse {
  documents: GeneratedDocumentPickerItem[];
  total: number;
}

interface GeneratedDocumentPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (documentIds: string[]) => Promise<void>;
  attachedDocumentIds?: string[];
  tenantId?: string | null;
  isConfirming?: boolean;
}

const MAX_RESULTS = 100;

function withTenant(path: string, tenantId?: string | null): string {
  if (!tenantId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({}));
  return typeof payload?.error === 'string' ? payload.error : 'Failed to load generated documents';
}

export function GeneratedDocumentPicker({
  isOpen,
  onClose,
  onConfirm,
  attachedDocumentIds = [],
  tenantId,
  isConfirming = false,
}: GeneratedDocumentPickerProps) {
  const [documents, setDocuments] = useState<GeneratedDocumentPickerItem[]>([]);
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setDocuments([]);
    setSearch('');
    setCompanyId('');
    setSortOrder('desc');
    setSelectedIds(new Set());
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      status: 'FINALIZED',
      sortBy: 'updatedAt',
      sortOrder,
      page: '1',
      limit: String(MAX_RESULTS),
    });
    if (companyId) params.set('companyId', companyId);

    async function loadDocuments() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          withTenant(`/api/generated-documents?${params.toString()}`, tenantId),
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const payload = (await response.json()) as Partial<GeneratedDocumentPickerResponse>;
        setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load generated documents');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadDocuments();
    return () => controller.abort();
  }, [companyId, isOpen, sortOrder, tenantId]);

  const attachedIds = useMemo(() => new Set(attachedDocumentIds), [attachedDocumentIds]);
  const visibleDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return documents;

    return documents.filter((document) =>
      [document.title, document.company?.name ?? ''].some((value) =>
        value.toLowerCase().includes(normalizedSearch),
      ),
    );
  }, [documents, search]);

  const selectableDocuments = visibleDocuments.filter((document) => !attachedIds.has(document.id));
  const selectedCount = selectedIds.size;

  function toggleDocument(documentId: string) {
    if (attachedIds.has(documentId) || isConfirming) return;

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }

  function toggleVisibleDocuments() {
    if (isConfirming || selectableDocuments.length === 0) return;

    setSelectedIds((current) => {
      const next = new Set(current);
      const allVisibleSelected = selectableDocuments.every((document) => next.has(document.id));
      selectableDocuments.forEach((document) => {
        if (allVisibleSelected) {
          next.delete(document.id);
        } else {
          next.add(document.id);
        }
      });
      return next;
    });
  }

  async function handleConfirm() {
    if (selectedCount === 0 || isConfirming) return;
    await onConfirm([...selectedIds]);
  }

  const allVisibleSelected = selectableDocuments.length > 0 && selectableDocuments.every((document) => selectedIds.has(document.id));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add from Generated documents"
      description="Choose finalized documents to attach to this signing envelope."
      size="5xl"
      closeOnOverlayClick={!isConfirming}
      closeOnEscape={!isConfirming}
      className="overflow-hidden"
    >
      <div className="flex max-h-[min(78vh,720px)] flex-col">
        <div className="space-y-3 border-b border-border-primary p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_135px]">
            <label className="relative block">
              <span className="mb-2 block text-xs font-medium text-text-secondary">Search</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search generated documents"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by document or company..."
                  disabled={isConfirming}
                  className="h-10 w-full rounded-lg border border-border-primary bg-background-primary pl-10 pr-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted hover:border-oak-primary/50 focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/30 disabled:opacity-60"
                />
              </span>
            </label>

            <CompanySelect
              value={companyId}
              onChange={(nextCompanyId) => setCompanyId(nextCompanyId)}
              label="Filter by company"
              placeholder="All companies"
              disabled={isConfirming}
              enabled={isOpen}
            />

            <label className="block">
              <span className="mb-2 block text-xs font-medium text-text-secondary">Sort by updated date</span>
              <select
                aria-label="Sort by updated date"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as 'desc' | 'asc')}
                disabled={isConfirming}
                className="h-10 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary outline-none transition-colors hover:border-oak-primary/50 focus:border-oak-primary focus:ring-2 focus:ring-oak-primary/30 disabled:opacity-60"
              >
                <option value="desc">Latest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
            <span>{isLoading ? 'Loading finalized documents...' : `${visibleDocuments.length} document${visibleDocuments.length === 1 ? '' : 's'} shown`}</span>
            {selectableDocuments.length > 0 && (
              <button
                type="button"
                onClick={toggleVisibleDocuments}
                disabled={isConfirming}
                className="font-medium text-oak-primary hover:text-oak-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allVisibleSelected ? 'Clear shown' : 'Select shown'}
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-text-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-oak-primary" />
              Loading finalized documents
            </div>
          ) : error ? (
            <div className="rounded-xl border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error" role="alert">
              {error}
            </div>
          ) : visibleDocuments.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border-primary bg-background-primary px-6 text-center">
              <FileText className="h-8 w-8 text-text-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-text-primary">No finalized documents found</p>
              <p className="mt-1 text-xs text-text-muted">Try another company or search term.</p>
            </div>
          ) : (
            <div className="space-y-2" role="list" aria-label="Finalized generated documents">
              {visibleDocuments.map((document) => {
                const isAttached = attachedIds.has(document.id);
                const isSelected = selectedIds.has(document.id);
                return (
                  <label
                    key={document.id}
                    data-testid={`generated-document-option-${document.id}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors sm:items-center',
                      isAttached
                        ? 'cursor-not-allowed border-border-primary bg-background-tertiary/60 opacity-65'
                        : isSelected
                          ? 'border-oak-primary/50 bg-oak-primary/5'
                          : 'border-border-primary bg-background-primary hover:border-oak-primary/40 hover:bg-background-tertiary',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleDocument(document.id)}
                      disabled={isAttached || isConfirming}
                      aria-label={`Select ${document.title}`}
                      className="mt-1 h-4 w-4 shrink-0 accent-oak-primary sm:mt-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-oak-primary" aria-hidden="true" />
                        <span className="truncate text-sm font-medium text-text-primary">{document.title}</span>
                        {isAttached && (
                          <span className="shrink-0 rounded-full bg-background-tertiary px-2 py-0.5 text-[10px] font-medium text-text-muted">
                            Added
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                        <span>{document.company?.name ?? 'No company'}</span>
                        <span>Updated {formatDate(document.updatedAt)}</span>
                      </span>
                    </span>
                    {isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-oak-primary" aria-hidden="true" />}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <ModalFooter className="justify-between">
          <span className="text-sm text-text-secondary" aria-live="polite">
            {selectedCount > 0 ? `${selectedCount} selected` : 'Select one or more documents'}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isConfirming}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleConfirm()}
              disabled={selectedCount === 0}
              isLoading={isConfirming}
              leftIcon={!isConfirming ? <Check className="h-4 w-4" /> : undefined}
            >
              Add selected
            </Button>
          </div>
        </ModalFooter>
      </div>
    </Modal>
  );
}

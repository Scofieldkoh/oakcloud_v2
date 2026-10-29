'use client';

import { ChevronDown, ChevronUp, Download, Eye, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { EsigningEnvelopeDocumentDto } from '@/types/esigning';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export function DocumentTable({
  documents,
  canEdit,
  isUpdating,
  onReorder,
  onToggleVisibility,
  onRename,
  onDelete,
}: {
  documents: EsigningEnvelopeDocumentDto[];
  canEdit: boolean;
  isUpdating: boolean;
  onReorder: (documentId: string, sortOrder: number) => Promise<void>;
  onToggleVisibility: (
    documentId: string,
    visibility: 'SIGNER_ONLY' | 'EVERYONE'
  ) => Promise<void>;
  onRename: (documentId: string, fileName: string) => Promise<void>;
  onDelete: (documentId: string) => void;
}) {
  const toast = useToast();

  async function moveDocument(documentId: string, index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= documents.length) return;

    try {
      await onReorder(documentId, targetIndex);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder document');
    }
  }

  async function toggleVisibility(document: EsigningEnvelopeDocumentDto) {
    const currentVisibility = document.visibility ?? 'SIGNER_ONLY';
    const nextVisibility = currentVisibility === 'SIGNER_ONLY' ? 'EVERYONE' : 'SIGNER_ONLY';

    try {
      await onToggleVisibility(document.id, nextVisibility);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update document visibility');
    }
  }

  async function renameDocument(document: EsigningEnvelopeDocumentDto) {
    const nextFileName = window.prompt('Rename document', document.fileName)?.trim();
    if (!nextFileName || nextFileName === document.fileName) {
      return;
    }

    try {
      await onRename(document.id, nextFileName);
      toast.success('Document renamed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename document');
    }
  }

  return (
    <div
      data-testid="esigning-document-table-container"
      className="overflow-x-auto rounded-xl border border-border-primary"
    >
      <table className="w-full min-w-[430px] text-sm">
        <thead className="bg-background-tertiary">
          <tr className="border-b border-border-primary">
            <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary">Document</th>
            <th className="w-32 px-3 py-2 text-left text-xs font-medium text-text-secondary">Visibility</th>
            <th className="w-32 px-3 py-2 text-right text-xs font-medium text-text-secondary">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc, index) => {
            const visibility = doc.visibility ?? 'SIGNER_ONLY';
            return (
              <tr
                key={doc.id}
                className="border-b border-border-primary last:border-b-0 odd:bg-background-secondary even:bg-background-primary"
              >
                <td className="px-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${doc.fileName} earlier`}
                      title="Move earlier"
                      disabled={!canEdit || isUpdating || index === 0}
                      onClick={() => void moveDocument(doc.id, index, -1)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-background-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${doc.fileName} later`}
                      title="Move later"
                      disabled={!canEdit || isUpdating || index === documents.length - 1}
                      onClick={() => void moveDocument(doc.id, index, 1)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-background-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <FileText className="ml-1 h-4 w-4 shrink-0 text-text-muted" />
                    <button
                      type="button"
                      onClick={() => window.open(doc.pdfUrl, '_blank', 'noreferrer')}
                      className="min-w-0 truncate text-left font-medium text-text-primary hover:text-oak-primary hover:underline"
                      title={`Preview ${doc.fileName}`}
                    >
                      {doc.fileName}
                    </button>
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    disabled={!canEdit || isUpdating}
                    onClick={() => void toggleVisibility(doc)}
                    title={
                      visibility === 'SIGNER_ONLY'
                        ? 'Only signers assigned fields on this document can see it. Click to show it to everyone.'
                        : 'Every signer can see this document. Click to restrict it to assigned signers.'
                    }
                    className={cn(
                      'inline-flex min-w-[92px] items-center justify-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      visibility === 'SIGNER_ONLY'
                        ? 'border-oak-primary/30 bg-oak-primary/10 text-oak-primary hover:bg-oak-primary/15'
                        : 'border-border-primary bg-background-secondary text-text-secondary hover:bg-background-tertiary'
                    )}
                  >
                    {visibility === 'SIGNER_ONLY' ? 'Signer only' : 'Everyone'}
                  </button>
                </td>
                <td className="px-3 py-1.5">
                  <Dropdown className="flex justify-end">
                    <DropdownTrigger
                      asChild
                      aria-label={`More actions for ${doc.fileName}`}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-background-tertiary hover:text-text-primary">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    </DropdownTrigger>
                    <DropdownMenu align="right">
                      <DropdownItem
                        icon={<Eye className="h-4 w-4" />}
                        onClick={() => window.open(doc.pdfUrl, '_blank', 'noreferrer')}
                      >
                        Preview
                      </DropdownItem>
                      <DropdownItem
                        icon={<Download className="h-4 w-4" />}
                        onClick={() => {
                          const separator = doc.pdfUrl.includes('?') ? '&' : '?';
                          window.open(`${doc.pdfUrl}${separator}download=true`, '_blank', 'noreferrer');
                        }}
                      >
                        Download
                      </DropdownItem>
                      {canEdit ? (
                        <DropdownItem
                          icon={<Pencil className="h-4 w-4" />}
                          disabled={isUpdating}
                          onClick={() => void renameDocument(doc)}
                        >
                          Rename
                        </DropdownItem>
                      ) : null}
                      {canEdit ? (
                        <DropdownItem
                          icon={<Trash2 className="h-4 w-4" />}
                          disabled={isUpdating}
                          destructive
                          onClick={() => onDelete(doc.id)}
                        >
                          Delete
                        </DropdownItem>
                      ) : null}
                    </DropdownMenu>
                  </Dropdown>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

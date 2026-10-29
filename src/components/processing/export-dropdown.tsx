'use client';

import { useState, useRef, useEffect } from 'react';
import { FileSpreadsheet, ChevronDown, Loader2, Link as LinkIcon } from 'lucide-react';
import { useDocumentExport } from '@/hooks/use-processing-documents';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface ExportDropdownProps {
  documentId: string;
  hasLinkedDocuments: boolean;
  className?: string;
}

export function ExportDropdown({
  documentId,
  hasLinkedDocuments,
  className,
}: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const documentExport = useDocumentExport();
  const { success, error: toastError } = useToast();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = async (includeLinked: boolean) => {
    setIsOpen(false);
    try {
      const blob = await documentExport.mutateAsync({ documentId, includeLinked });

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      link.download = includeLinked
        ? `export-with-links-${dateStr}.xlsx`
        : `export-${dateStr}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      success(includeLinked ? 'Exported document with linked documents' : 'Exported document');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to export');
    }
  };

  // Simple button when no linked documents
  if (!hasLinkedDocuments) {
    return (
      <button
        onClick={() => handleExport(false)}
        disabled={documentExport.isPending}
        className={cn('btn-secondary btn-sm', className)}
        title="Export to Excel"
      >
        {documentExport.isPending ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
        )}
        Export
      </button>
    );
  }

  // Dropdown with options when linked documents exist
  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={documentExport.isPending}
        className="btn-secondary btn-sm"
        title="Export to Excel"
      >
        {documentExport.isPending ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
        )}
        Export
        <ChevronDown className="w-3.5 h-3.5 ml-1" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-56 rounded-md shadow-lg bg-background-primary border border-border-primary z-50">
          <div className="py-1">
            <button
              onClick={() => handleExport(false)}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-primary hover:bg-background-secondary transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4 text-text-secondary" />
              <span>Export Current Document</span>
            </button>
            <button
              onClick={() => handleExport(true)}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-primary hover:bg-background-secondary transition-colors"
            >
              <LinkIcon className="w-4 h-4 text-text-secondary" />
              <span>Export with Linked Documents</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

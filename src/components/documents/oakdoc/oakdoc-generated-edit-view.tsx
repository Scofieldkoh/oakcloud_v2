'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OakDocGeneratedDocumentEditor } from '@/components/documents/oakdoc-generated-document-editor';
import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';

export interface OakDocGeneratedEditViewProps {
  documentId: string;
  title: string;
  status: 'DRAFT' | 'FINALIZED' | 'ARCHIVED';
  revision: number;
  templateName?: string | null;
  documentHref: string;
}

/**
 * Direct edit URL for native documents. It reuses the shared OakDoc host and
 * never mounts the A4 editor for DOCX-native content.
 */
export function OakDocGeneratedEditView({
  documentId,
  title,
  status,
  revision: initialRevision,
  templateName,
  documentHref,
}: OakDocGeneratedEditViewProps) {
  const [revision, setRevision] = useState(initialRevision);
  const [dirty, setDirty] = useState(false);
  const navigationGuard = useUnsavedNavigationGuard(dirty, {
    description: 'You have unsaved Word edits. Leave without saving them?',
  });
  const readOnly = status !== 'DRAFT';

  return (
    <div className="flex h-screen flex-col bg-background-primary">
      <div className="flex-shrink-0 border-b border-border-primary bg-background-secondary px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-text-primary">{title}</h1>
            <p className="truncate text-xs text-text-muted">
              {templateName ? `Template: ${templateName} · ` : ''}Word document
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigationGuard.requestNavigation(documentHref)}
          >
            Back to document
          </Button>
        </div>
        {readOnly && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            This document is {status.toLowerCase()} and opens read-only. Un-finalize it to make changes.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <OakDocGeneratedDocumentEditor
          documentId={documentId}
          title={title}
          revision={revision}
          readOnly={readOnly}
          onDirtyChange={setDirty}
          onSaved={(result) => setRevision(result.revision)}
        />
      </div>
      {navigationGuard.dialog}
    </div>
  );
}

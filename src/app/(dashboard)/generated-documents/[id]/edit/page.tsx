'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  readTaskLaunchContext,
  withTaskLaunchContext,
} from '@/lib/task-launch-context';
import { readGeneratedDocumentEngineState, type DocumentEngineState } from '@/lib/document-editor/document-engine';
import { OakDocGeneratedEditView } from '@/components/documents/oakdoc/oakdoc-generated-edit-view';

interface GeneratedDocument {
  title: string;
  status: 'DRAFT' | 'FINALIZED' | 'ARCHIVED';
  revision: number;
  metadata?: unknown;
  template?: { name: string } | null;
}

interface ApiErrorPayload {
  error?: string;
}

interface EngineProbe {
  engine: DocumentEngineState;
  title: string;
  status: GeneratedDocument['status'];
  revision: number;
  templateName: string | null;
}

/**
 * Engine-aware edit route: native documents open in the shared OakDoc host,
 * damaged native metadata fails closed, and documents that are not OakDoc
 * (old A4 records, ungenerated drafts) go to their detail page, which says
 * why they cannot be opened.
 */
export default function DocumentEditPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const documentId = params.id as string;
  const taskContext = useMemo(() => readTaskLaunchContext(searchParams), [searchParams]);
  const documentHref = withTaskLaunchContext(`/generated-documents/${documentId}`, taskContext);
  const [probe, setProbe] = useState<EngineProbe | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setProbe(null);
    setProbeError(null);
    void fetch(`/api/generated-documents/${encodeURIComponent(documentId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((payload as ApiErrorPayload).error || 'Failed to fetch document');
        const document = payload as GeneratedDocument;
        setProbe({
          engine: readGeneratedDocumentEngineState(document.metadata),
          title: document.title,
          status: document.status,
          revision: document.revision,
          templateName: document.template?.name ?? null,
        });
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setProbeError(caught instanceof Error ? caught.message : 'Failed to fetch document');
      });
    return () => controller.abort();
  }, [documentId]);

  const isA4 = probe?.engine === 'A4';
  useEffect(() => {
    if (isA4) router.replace(documentHref);
  }, [documentHref, isA4, router]);

  if (probeError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p role="alert" className="text-sm text-status-error">{probeError}</p>
      </div>
    );
  }
  if (!probe || probe.engine === 'A4') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-accent-primary" aria-label="Loading document" />
      </div>
    );
  }
  if (probe.engine === 'INVALID') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p role="alert" className="max-w-md text-center text-sm text-status-error">
          This document has damaged Word document metadata and cannot be edited. Contact an administrator.
        </p>
      </div>
    );
  }
  if (probe.engine === 'OAKDOC') {
    return (
      <OakDocGeneratedEditView
        documentId={documentId}
        title={probe.title}
        status={probe.status}
        revision={probe.revision}
        templateName={probe.templateName}
        documentHref={documentHref}
      />
    );
  }
  return null;
}

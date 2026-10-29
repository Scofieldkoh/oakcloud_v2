'use client';

import { RefreshCw, Play, AlertCircle } from 'lucide-react';

export function NoExtractionPlaceholder({
  canTrigger,
  isPending,
  pipelineStatus,
  onTrigger,
}: {
  canTrigger: boolean;
  isPending: boolean;
  pipelineStatus: string;
  onTrigger: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <AlertCircle className="w-12 h-12 text-text-muted opacity-50 mb-4" />
      <h3 className="text-lg font-semibold text-text-primary mb-2">No Extracted Data</h3>
      <p className="text-sm text-text-muted mb-6 max-w-sm">
        {canTrigger
          ? 'This document has not been extracted yet. Click the button below to extract data from this document.'
          : pipelineStatus === 'PROCESSING'
            ? 'Extraction is currently in progress...'
            : 'Extraction is not available for this document status.'}
      </p>
      {canTrigger && (
        <button onClick={() => onTrigger()} disabled={isPending} className="btn-primary btn-sm">
          {isPending ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
              Extracting...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 mr-1.5" />
              Trigger Extraction
            </>
          )}
        </button>
      )}
    </div>
  );
}

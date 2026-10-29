'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StandardContextOption } from '@/components/ui/ai-model-selector';
import type {
  DocumentExtractionPromptSettings,
} from '@/components/processing/document-extraction-prompt-modal';

export function useDocumentExtractionPromptSettings(enabled = true) {
  const [settings, setSettings] = useState<DocumentExtractionPromptSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/workspace/document-extraction-prompt');
      if (!response.ok) return;
      const body = await response.json();
      setSettings(body.data);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const standardContextOptions = useMemo<StandardContextOption[]>(
    () =>
      (settings?.quickContexts ?? []).map((context) => ({
        id: context.id,
        label: context.label,
        getValue: () => context.value,
      })),
    [settings?.quickContexts]
  );

  return {
    settings,
    setSettings,
    isLoading,
    reload: loadSettings,
    standardContextOptions,
  };
}

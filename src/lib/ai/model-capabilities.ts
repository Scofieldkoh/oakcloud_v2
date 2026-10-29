export type DocumentInputMode = 'auto' | 'pdf' | 'image';

export interface PdfInputTestResult {
  success: boolean;
  testedAt: string;
  error?: string;
}

export interface ConnectorModelDocumentSettings {
  modelId: string;
  supportsPdfInput?: boolean;
  documentInputMode?: DocumentInputMode;
  lastPdfInputTest?: PdfInputTestResult;
}

export function normalizeDocumentInputMode(value: unknown): DocumentInputMode {
  return value === 'pdf' || value === 'image' || value === 'auto' ? value : 'auto';
}

export function getEffectiveDocumentInputMode(
  model: Pick<ConnectorModelDocumentSettings, 'supportsPdfInput' | 'documentInputMode'>
): 'pdf' | 'image' {
  const mode = normalizeDocumentInputMode(model.documentInputMode);
  if (mode === 'pdf') return 'pdf';
  if (mode === 'image') return 'image';
  return model.supportsPdfInput ? 'pdf' : 'image';
}

export function readConnectorModelDocumentSettings(
  settings: unknown,
  modelId: string
): ConnectorModelDocumentSettings | null {
  const settingsObject =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const modelArrays = [settingsObject.models, settingsObject.customModels];

  for (const value of modelArrays) {
    if (!Array.isArray(value)) continue;

    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const model = item as Record<string, unknown>;
      const entryModelId = typeof model.modelId === 'string' ? model.modelId.trim() : '';
      if (entryModelId !== modelId) continue;

      const lastPdfInputTest =
        model.lastPdfInputTest &&
        typeof model.lastPdfInputTest === 'object' &&
        !Array.isArray(model.lastPdfInputTest)
          ? (model.lastPdfInputTest as Record<string, unknown>)
          : null;

      return {
        modelId: entryModelId,
        supportsPdfInput:
          typeof model.supportsPdfInput === 'boolean' ? model.supportsPdfInput : undefined,
        documentInputMode: normalizeDocumentInputMode(model.documentInputMode),
        lastPdfInputTest: lastPdfInputTest
          ? {
              success: lastPdfInputTest.success === true,
              testedAt:
                typeof lastPdfInputTest.testedAt === 'string'
                  ? lastPdfInputTest.testedAt
                  : new Date(0).toISOString(),
              error:
                typeof lastPdfInputTest.error === 'string'
                  ? lastPdfInputTest.error
                  : undefined,
            }
          : undefined,
      };
    }
  }

  return null;
}

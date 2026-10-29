import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOCUMENT_EXTRACTION_QUICK_CONTEXTS,
  getDocumentExtractionPromptSettingsFromWorkspace,
  resolveDocumentExtractionPrompt,
} from '@/services/document-extraction-prompt-settings.service';

describe('document extraction prompt settings', () => {
  it('returns defaults when workspace settings are missing or malformed', () => {
    expect(getDocumentExtractionPromptSettingsFromWorkspace(null)).toMatchObject({
      quickContexts: DEFAULT_DOCUMENT_EXTRACTION_QUICK_CONTEXTS,
    });

    expect(getDocumentExtractionPromptSettingsFromWorkspace({ documentExtractionPrompt: 'bad' }))
      .toMatchObject({
        quickContexts: DEFAULT_DOCUMENT_EXTRACTION_QUICK_CONTEXTS,
      });
  });

  it('normalizes saved prompt settings and removes invalid quick contexts', () => {
    const settings = getDocumentExtractionPromptSettingsFromWorkspace({
      documentExtractionPrompt: {
        promptTemplate: 'Prompt [AdditionalContext]',
        quickContexts: [
          { id: 'keep', label: 'Keep', value: 'Use [CurrentDate]' },
          { id: '', label: 'Bad', value: 'No id' },
          { id: 'bad-value', label: 'Bad value', value: '' },
        ],
      },
    });

    expect(settings.promptTemplate).toBe('Prompt [AdditionalContext]');
    expect(settings.quickContexts).toEqual([
      { id: 'keep', label: 'Keep', value: 'Use [CurrentDate]' },
    ]);
  });

  it('resolves known variables before sending the prompt to extraction providers', () => {
    const prompt = resolveDocumentExtractionPrompt(
      [
        'Base',
        '[AdditionalContext]',
        '[RecentTransactions]',
        '[Details]',
        '[ChartOfAccounts]',
        '[CurrentDate]',
        '[Timezone]',
      ].join('\n'),
      {
        additionalContext: 'Focus on totals',
        recentTransactions: 'Past three transactions',
        chartOfAccounts: 'COA list',
        currentDate: '2026-06-29',
        timeZone: 'Asia/Singapore',
      }
    );

    expect(prompt).toContain('Focus on totals');
    expect(prompt).toContain('Past three transactions');
    expect(prompt).toContain('COA list');
    expect(prompt).toContain('2026-06-29');
    expect(prompt).toContain('Asia/Singapore');
    expect(prompt).not.toContain('[AdditionalContext]');
    expect(prompt).not.toContain('[Details]');
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldGeneralTab } from '@/components/forms/field-general-tab';
import { defaultField } from '@/components/forms/builder-utils';

vi.mock('@/hooks/use-form-option-presets', () => ({
  useFormOptionPresets: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => <div /> }));

const warning = {
  id: 'health-1',
  formId: 'form-1',
  fieldKey: 'resource_link',
  checkedUrl: 'https://example.com/missing',
  classification: 'FAILED' as const,
  lastHttpStatus: 404,
  lastErrorCode: null,
  lastErrorMessage: null,
  consecutiveFailures: 2,
  lastCheckedAt: '2026-08-01T02:00:00+08:00',
  lastSucceededAt: null,
  warningActivatedAt: '2026-08-01T02:00:00+08:00',
};

describe('URL field health warning', () => {
  it('shows active warning detail for the affected URL information field', () => {
    const field = {
      ...defaultField('PARAGRAPH', 0),
      key: 'resource_link',
      inputType: 'info_url' as const,
      placeholder: warning.checkedUrl,
    };
    render(<FieldGeneralTab field={field} onChange={vi.fn()} urlHealth={warning} />);

    expect(screen.getByRole('alert', { name: 'Broken link warning' })).toBeVisible();
    expect(screen.getByText(/Last checked 1 Aug 2026, 2:00 am/i)).toBeVisible();
    expect(screen.getByText('HTTP 404')).toBeVisible();
    expect(screen.getByText(/2 consecutive failures/i)).toBeVisible();
  });

  it('does not show warnings before activation', () => {
    const field = { ...defaultField('PARAGRAPH', 0), inputType: 'info_url' as const };
    render(<FieldGeneralTab field={field} onChange={vi.fn()} urlHealth={{ ...warning, warningActivatedAt: null }} />);
    expect(screen.queryByRole('alert', { name: 'Broken link warning' })).not.toBeInTheDocument();
  });
});

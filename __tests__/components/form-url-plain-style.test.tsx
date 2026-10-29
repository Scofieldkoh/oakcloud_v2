import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PublicFormPage from '@/app/(public)/forms/f/[slug]/page';
import { FieldGeneralTab } from '@/components/forms/field-general-tab';
import { defaultField } from '@/components/forms/builder-utils';

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'resource-form' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/forms/f/resource-form',
}));
vi.mock('@/components/esigning/signing/esigning-signature-modal', () => ({ EsigningSignatureModal: () => null }));
vi.mock('@/hooks/use-form-option-presets', () => ({
  useFormOptionPresets: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => <div /> }));

describe('plain URL information style', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers Plain text style for URL information fields', () => {
    const field = { ...defaultField('PARAGRAPH', 0), inputType: 'info_url' as const };
    render(<FieldGeneralTab field={field} onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Plain text style' })).toBeVisible();
  });

  it('renders a plain public link without the inner bordered box', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      form: {
        id: 'form-1', slug: 'resource-form', title: 'Resources', description: null,
        status: 'PUBLISHED', tenantLogoUrl: null, tenantName: 'OakCloud', settings: {},
        fields: [{
          id: 'field-1', type: 'PARAGRAPH', label: 'Resource', key: 'resource_link',
          placeholder: 'https://example.com/resource', subtext: 'Open resource', helpText: null,
          inputType: 'info_url', options: null, validation: { infoBareStyle: true }, condition: null,
          isRequired: false, hideLabel: false, isReadOnly: false, layoutWidth: 100, position: 0,
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    render(<PublicFormPage />);
    const link = await screen.findByRole('link', { name: 'Open resource' });
    expect(link.parentElement).not.toHaveClass('border');
    expect(link.parentElement).not.toHaveClass('bg-background-primary');
  });
});

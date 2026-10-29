import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicFormPage from '@/app/(public)/forms/f/[slug]/page';
import { buildSgCompanyIncorporationFields } from '@/lib/form-templates/sg-company-incorporation';
import { saveFormFieldsSchema } from '@/lib/validations/form-builder';

// eslint-disable-next-line no-var
var currentSearchParams = '';

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'annual-return-declaration' }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(currentSearchParams),
  usePathname: () => '/forms/f/annual-return-declaration',
}));

vi.mock('@/components/esigning/signing/esigning-signature-modal', () => ({
  EsigningSignatureModal: () => null,
}));

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    placeholder,
    clearable,
    disabled,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    clearable?: boolean;
    disabled?: boolean;
  }) => (
    <div>
      <select
        aria-label={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {clearable && value && !disabled ? (
        <button type="button" aria-label="Clear selection" onClick={() => onChange('')}>
          Clear
        </button>
      ) : null}
    </div>
  ),
}));

const publicForm = {
  id: 'form-1',
  slug: 'annual-return-declaration',
  title: 'Annual Return Declaration',
  description: null,
  status: 'PUBLISHED',
  tenantLogoUrl: null,
  tenantName: 'OakCloud',
  fields: [] as Array<Record<string, unknown>>,
  settings: {
    i18n: {
      defaultLocale: 'en',
      enabledLocales: ['en'],
      translations: {
        en: {
          ui: {
            loading_form: 'Loading translated form...',
            submit: 'Send declaration',
          },
        },
      },
    },
  },
};

let currentPublicForm = publicForm;
let currentNameCheckFails = false;
let currentNameCheckHasSimilar = false;

function dropdownForm(isRequired: boolean) {
  return {
    ...publicForm,
    fields: [{
      id: 'field-1',
      type: 'DROPDOWN',
      label: 'Industry',
      key: 'industry',
      placeholder: 'Select an industry',
      subtext: null,
      helpText: null,
      inputType: null,
      options: [{ value: 'A', label: 'Agriculture' }, { value: 'B', label: 'Banking' }],
      validation: null,
      condition: null,
      isRequired,
      hideLabel: false,
      isReadOnly: false,
      layoutWidth: 100,
      position: 0,
    }],
  };
}

function backgroundForm(url: string | null, opacity = 55) {
  return {
    ...publicForm,
    settings: {
      ...publicForm.settings,
      ...(url ? { backgroundImageUrl: url } : {}),
      backgroundImageOpacity: opacity,
    },
  };
}

function companyNameCheckForm() {
  return {
    ...publicForm,
    fields: [{
      id: 'field-name-check',
      type: 'COMPANY_NAME_CHECK',
      label: 'Proposed company name',
      key: 'company_name',
      placeholder: 'e.g. Acme Holdings',
      subtext: null,
      helpText: null,
      inputType: 'text',
      options: [],
      validation: null,
      condition: null,
      isRequired: false,
      hideLabel: false,
      isReadOnly: false,
      layoutWidth: 100,
      position: 0,
    }],
  };
}

function reviewStepForm(nameCheckMode: 'strict' | 'advisory' = 'strict') {
  return {
    ...publicForm,
    settings: {
      ...publicForm.settings,
      completion: {
        reviewStep: true,
        reviewTitle: 'Check your answers',
        submitLabel: 'Submit company details',
        successTitle: 'Company details submitted',
        successMessage: 'Your reference is {reference}.',
        showPdfActions: false,
      },
    },
    fields: [{
      ...companyNameCheckForm().fields[0],
      validation: { nameCheckMode },
    }],
  };
}

/** The incorporation template's people page, followed by the capital page. */
function incorporationPeopleForm() {
  const all = saveFormFieldsSchema.parse({
    fields: buildSgCompanyIncorporationFields({ firmName: 'Oaktree', ssicPresetId: '00000000-0000-4000-8000-000000000001', nationalityPresetId: '00000000-0000-4000-8000-000000000002', countryPresetId: '00000000-0000-4000-8000-000000000003' }),
  }).fields;
  const start = all.findIndex((field) => field.key === 'page_parties') + 1;
  const end = all.findIndex((field) => field.key === 'page_capital');
  const companyType = all.find((field) => field.key === 'company_type')!;
  const fields = [companyType, ...all.slice(start, end + 1), { type: 'SHORT_TEXT', key: 'capital_note', label: 'Capital note', isRequired: false }];
  return {
    ...publicForm,
    settings: { ...publicForm.settings, template: { key: 'sg_company_incorporation', version: 2 } },
    fields: fields.map((field, index) => ({
      subtext: null,
      helpText: null,
      inputType: null,
      options: [],
      validation: null,
      condition: null,
      hideLabel: false,
      isReadOnly: false,
      layoutWidth: 100,
      placeholder: null,
      ...field,
      ...(field.key === 'party_nationality' ? { optionPresetId: null, options: [{ value: 'Singaporean', label: 'Singaporean' }] } : {}),
      id: `field-${index}`,
      position: index,
    })),
  };
}

describe('PublicFormPage', () => {
  beforeEach(() => {
    currentSearchParams = '';
    currentPublicForm = publicForm;
    currentNameCheckFails = false;
    currentNameCheckHasSimilar = false;
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/public-bootstrap/forms/annual-return-declaration') {
        return new Response(JSON.stringify({ form: currentPublicForm }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/forms/name-check') {
        if (currentNameCheckFails) {
          return new Response(
            JSON.stringify({ error: 'Availability check temporarily unavailable. Please try again.' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (currentNameCheckHasSimilar) {
          return new Response(
            JSON.stringify({
              available: false,
              checkedAt: '2026-08-06T00:00:00.000Z',
              records: [{
                uen: '201904999E',
                entityName: 'BIF IV ACME HOLDINGS PTE. LTD.',
                entityStatus: 'LIVE COMPANY',
              }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ available: true, checkedAt: '2026-08-06T00:00:00.000Z', records: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === '/api/forms/public/annual-return-declaration/submit') {
        return new Response(
          JSON.stringify({
            id: 'sub-1',
            submittedAt: '2026-08-06T00:00:00.000Z',
            pdfDownloadToken: 'token',
            pdfDownloadTokenTtlSeconds: 1800,
            pdfEmailAccessToken: 'mail-token',
            pdfEmailAccessTokenTtlSeconds: 1800,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      void init;
      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a public form once when localized UI labels become available', async () => {
    render(<PublicFormPage />);

    await screen.findByRole('heading', { name: 'Annual Return Declaration' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('lets respondents clear an optional dropdown selection', async () => {
    currentPublicForm = dropdownForm(false);
    render(<PublicFormPage />);

    const combobox = await screen.findByRole('combobox', { name: 'Select an industry' });
    fireEvent.change(combobox, { target: { value: 'A' } });
    expect(combobox).toHaveValue('A');

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(combobox).toHaveValue('');
  });

  it('allows clearing a required dropdown but retains required validation', async () => {
    currentPublicForm = dropdownForm(true);
    render(<PublicFormPage />);

    const combobox = await screen.findByRole('combobox', { name: 'Select an industry' });
    fireEvent.change(combobox, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send declaration' }));

    expect(await screen.findByText('Industry is required')).toBeVisible();
  });

  it('renders the configured background image at the saved opacity', async () => {
    currentPublicForm = backgroundForm('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png', 55);
    const { container } = render(<PublicFormPage />);

    await screen.findByRole('heading', { name: 'Annual Return Declaration' });

    const backgroundLayer = container.querySelector('.fixed[aria-hidden="true"]') as HTMLElement | null;
    expect(backgroundLayer).not.toBeNull();
    expect(backgroundLayer?.style.backgroundImage).toBe(
      'url("/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png")'
    );
    expect(backgroundLayer?.style.opacity).toBe('0.55');
    expect(container.firstElementChild).toHaveClass('bg-gradient-to-b');
  });

  it('keeps the default gradient when no background is configured', async () => {
    const { container } = render(<PublicFormPage />);

    await screen.findByRole('heading', { name: 'Annual Return Declaration' });

    expect(container.querySelector('.fixed[aria-hidden="true"]')).toBeNull();
    expect(container.firstElementChild).toHaveClass('bg-gradient-to-b');
  });

  it('skips the background layer in embed mode', async () => {
    currentSearchParams = 'embed=1';
    currentPublicForm = backgroundForm('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
    const { container } = render(<PublicFormPage />);

    await screen.findByRole('button', { name: 'Send declaration' });

    expect(container.querySelector('.fixed[aria-hidden="true"]')).toBeNull();
  });

  it('lets respondents check company name availability', async () => {
    currentPublicForm = companyNameCheckForm();
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));

    expect(await screen.findByText('No similar names found — the name appears to be available for incorporation.')).toBeVisible();
  });

  it('shows a retryable error when the availability check fails', async () => {
    currentPublicForm = companyNameCheckForm();
    currentNameCheckFails = true;
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));

    expect(await screen.findByText('Availability check temporarily unavailable. Please try again.')).toBeVisible();
  });

  it('clears the availability result when the name is edited', async () => {
    currentPublicForm = companyNameCheckForm();
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));
    await screen.findByText(/No similar names found/);

    fireEvent.change(input, { target: { value: 'Acme Holdings 2' } });

    expect(screen.queryByText(/No similar names found/)).not.toBeInTheDocument();
  });

  it('blocks submission until availability is checked', async () => {
    currentPublicForm = companyNameCheckForm();
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send declaration' }));

    expect(await screen.findByText('Check availability before submitting')).toBeVisible();
  });

  it('blocks submission when similar names are found', async () => {
    currentPublicForm = companyNameCheckForm();
    currentNameCheckHasSimilar = true;
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));
    await screen.findByText(/Similar names found — final availability is determined by ACRA/);

    fireEvent.click(screen.getByRole('button', { name: 'Send declaration' }));

    expect(await screen.findByText('Similar names found — please enter an available company name.')).toBeVisible();
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/submit'))).toBe(false);
  });

  it('includes the check result in submission metadata', async () => {
    currentPublicForm = companyNameCheckForm();
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));
    await screen.findByText(/No similar names found/);

    fireEvent.click(screen.getByRole('button', { name: 'Send declaration' }));

    await waitFor(() => {
      const submitCall = vi.mocked(global.fetch).mock.calls.find(
        ([url]) => String(url).includes('/submit')
      );
      expect(submitCall).toBeTruthy();
      const body = JSON.parse(String(submitCall?.[1]?.body));
      expect(body.metadata.nameCheckResults.company_name).toMatchObject({
        name: 'Acme Holdings',
        available: true,
      });
    });
  });

  it('shows a review step before submitting and a reference afterwards', async () => {
    currentPublicForm = reviewStepForm('advisory');
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check name' }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Review answers' }));

    expect(await screen.findByText('Check your answers')).toBeVisible();
    expect(screen.getAllByText('Acme Holdings')[0]).toBeVisible();
    // Fields stay mounted (hidden) so going back keeps every answer.
    expect(input.closest('.hidden')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Submit company details' }));
    expect(await screen.findByText('Company details submitted')).toBeVisible();
    expect(screen.getByText(/Your reference is SUB1/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('stops the page until an advisory name has been checked', async () => {
    currentPublicForm = reviewStepForm('advisory');
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review answers' }));
    expect(await screen.findByText('Select Check name before continuing')).toBeVisible();
    expect(screen.queryByText('Check your answers')).not.toBeInTheDocument();
  });

  it('offers a company the shareholder role only', async () => {
    currentPublicForm = incorporationPeopleForm();
    render(<PublicFormPage />);

    expect(await screen.findByRole('checkbox', { name: 'Director' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'A company' }));
    expect(screen.getByRole('checkbox', { name: 'Shareholder' })).toBeInTheDocument();
    for (const role of ['Director', 'Managing director', 'CEO', 'Company secretary']) {
      expect(screen.queryByRole('checkbox', { name: role })).not.toBeInTheDocument();
    }
  });

  it('shows incorporation roles as buttons and stops the page until the list is complete', async () => {
    currentPublicForm = incorporationPeopleForm();
    render(<PublicFormPage />);

    fireEvent.change(await screen.findByRole('textbox', { name: /Full name/ }), { target: { value: 'Tan Mei Ling' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Email/ }), { target: { value: 'mei@example.com' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Passport\/FIN\/NRIC/ }), { target: { value: 'S1234567D' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Select nationality' }), { target: { value: 'Singaporean' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Residential address/ }), { target: { value: '1 Harbour Road, Singapore 123456' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Contact number/ }), { target: { value: '91234567' } });
    const director = screen.getByRole('checkbox', { name: 'Director' });
    fireEvent.click(director);
    expect(director).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Add at least one shareholder.')).toBeVisible();
    expect(screen.queryByText('Capital note')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Shareholder' }));
    expect(screen.queryByText('Add at least one shareholder.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Shareholding/ }), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/They must add up to exactly 100%/)).toBeVisible();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Shareholding/ }), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Capital note')).toBeVisible();
  });

  it('lets respondents continue when an advisory name check is unavailable', async () => {
    currentPublicForm = reviewStepForm('advisory');
    currentNameCheckFails = true;
    render(<PublicFormPage />);

    const input = await screen.findByRole('textbox', { name: 'Proposed company name' });
    fireEvent.change(input, { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check name' }));
    await waitFor(() => expect(screen.queryByText('Availability check temporarily unavailable. Please try again.')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Review answers' }));
    expect(await screen.findByText('Check your answers')).toBeVisible();
  });
});

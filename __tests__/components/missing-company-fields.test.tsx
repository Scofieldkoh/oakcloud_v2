import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MissingCompanyFields } from '@/components/documents/generation-batch/missing-company-fields';

const company = { id: 'company-1', name: 'ABC Pte Ltd' };
const tags = [
  'company.name',
  'company.firstFinancialYearEnd',
  'company.secondaryActivity',
  'selectedDirector.name',
];

let fieldValues: Record<string, string>;
let saveResponse: { status: number; body: unknown };
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  fieldValues = {
    'company.name': 'ABC Pte Ltd',
    'company.firstFinancialYearEnd': '',
    'company.secondaryActivity': '',
  };
  saveResponse = { status: 200, body: { fieldId: 'firstFinancialYearEnd', value: '2026-12-31', values: {} } };
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (saveResponse.status === 200) fieldValues = { ...fieldValues, 'company.firstFinancialYearEnd': '31 Dec 2026' };
      return jsonResponse(saveResponse.status, saveResponse.body);
    }
    return jsonResponse(200, { values: fieldValues });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function enterDate(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('MissingCompanyFields', () => {
  it('warns about blank company values the template prints', async () => {
    render(<MissingCompanyFields company={company} templateFieldTags={tags} onPatch={vi.fn()} />);

    expect(await screen.findByText('Missing company information')).toBeInTheDocument();
    expect(screen.getByText(/ABC Pte Ltd has no value for/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Missing company values' });
    expect(within(list).getByText('First financial year end')).toBeInTheDocument();
    // Worked-out values such as the secondary activity are often legitimately blank, so they stay hidden.
    expect(screen.queryByText(/Secondary Activity/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/companies/company-1/document-fields?tags=${encodeURIComponent('company.firstFinancialYearEnd,company.name,company.secondaryActivity')}`,
      expect.anything(),
    );
  });

  it('shows nothing when every printed value is on record', async () => {
    fieldValues = { 'company.name': 'ABC Pte Ltd', 'company.firstFinancialYearEnd': '31 Dec 2026', 'company.secondaryActivity': 'x' };
    const { container } = render(<MissingCompanyFields company={company} templateFieldTags={tags} onPatch={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('uses an entered value for this document only after confirmation', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(<MissingCompanyFields company={company} templateFieldTags={tags} onPatch={onPatch} />);
    await screen.findByText('Missing company information');

    await user.click(screen.getByRole('button', { name: 'Use value' }));
    expect(screen.getByText('Enter a valid date.')).toBeInTheDocument();

    enterDate('First financial year end', '2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Use value' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Save First financial year end\?/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Save 31 Dec 2026 as the first financial year end in ABC Pte Ltd's compliance data?");
    await user.click(within(dialog).getByRole('button', { name: 'Use for this document only' }));

    expect(onPatch).toHaveBeenCalledWith({ companyFieldValues: { firstFinancialYearEnd: '2026-12-31' } });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
  });

  it('saves an entered value to the company and refreshes', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(<MissingCompanyFields company={company} templateFieldTags={tags} onPatch={onPatch} />);
    await screen.findByText('Missing company information');

    enterDate('First financial year end', '2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Use value' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save to company' }));

    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ companyFieldValues: {} }));
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/company-1/document-fields', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ fieldId: 'firstFinancialYearEnd', value: '2026-12-31' }),
    }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Missing company values' })).not.toBeInTheDocument());
  });

  it('keeps the dialog open with the reason when saving is refused', async () => {
    saveResponse = { status: 403, body: { error: 'Forbidden' } };
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(<MissingCompanyFields company={company} templateFieldTags={tags} onPatch={onPatch} />);
    await screen.findByText('Missing company information');

    enterDate('First financial year end', '2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Use value' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save to company' }));

    expect(await within(dialog).findByText(/do not have permission to update this company/)).toBeInTheDocument();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('offers to save or clear a value set for this document only', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <MissingCompanyFields
        company={company}
        templateFieldTags={tags}
        documentValues={{ firstFinancialYearEnd: '2026-12-31' }}
        onPatch={onPatch}
      />,
    );
    expect(await screen.findByText('31 Dec 2026')).toBeInTheDocument();
    expect(screen.getByText(/for this document only/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onPatch).toHaveBeenCalledWith({ companyFieldValues: {} });

    await user.click(screen.getByRole('button', { name: 'Save to company' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Use for this document only' })).not.toBeInTheDocument();
  });
});

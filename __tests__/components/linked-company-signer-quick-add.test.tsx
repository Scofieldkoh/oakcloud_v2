import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedCompanySignerQuickAdd } from '@/components/esigning/prepare/linked-company-signer-quick-add';
import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';
import type { EsigningRecipientInput } from '@/lib/validations/esigning';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const partyOptionsMock = vi.hoisted(() => ({
  contacts: [
    {
      id: 'party-1',
      contactId: 'contact-1',
      name: 'Alice Tan',
      email: 'alice@example.com',
      appointments: ['Director'],
    },
    {
      id: 'party-2',
      contactId: 'contact-2',
      name: 'Bob Lim',
      email: null,
      appointments: ['Shareholder'],
    },
  ],
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { tenantId: 'workspace-1', isSuperAdmin: false } }),
}));

vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => 'workspace-1',
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => toastMocks,
}));

vi.mock('@/hooks/use-document-party-options', () => ({
  useDocumentPartyOptions: () => ({
    directors: [],
    shareholders: [],
    contacts: partyOptionsMock.contacts,
    isLoading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock('@/components/ui/contact-search-select', () => ({
  ContactSearchSelect: () => <div data-testid="contact-search-select" />,
}));

describe('LinkedCompanySignerQuickAdd bulk add', () => {
  beforeEach(() => {
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
    partyOptionsMock.contacts = [
      {
        id: 'party-1',
        contactId: 'contact-1',
        name: 'Alice Tan',
        email: 'alice@example.com',
        appointments: ['Director'],
      },
      {
        id: 'party-2',
        contactId: 'contact-2',
        name: 'Bob Lim',
        email: null,
        appointments: ['Shareholder'],
      },
    ];
  });

  it('adds all available company contacts as manual-link signers', async () => {
    const user = userEvent.setup();
    const onAddRecipient = vi.fn<(data: EsigningRecipientInput) => Promise<void>>().mockResolvedValue(undefined);

    render(
      <LinkedCompanySignerQuickAdd
        companyId="company-1"
        companyName="Golden Lotus Information Service Pte Ltd"
        recipients={[]}
        canEdit
        onAddRecipient={onAddRecipient}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add all as signers' }));

    await waitFor(() => expect(onAddRecipient).toHaveBeenCalledTimes(2));
    expect(onAddRecipient).toHaveBeenNthCalledWith(1, {
      name: 'Alice Tan',
      email: 'alice@example.com',
      type: 'SIGNER',
      signingOrder: null,
      accessMode: 'MANUAL_LINK',
    });
    expect(onAddRecipient).toHaveBeenNthCalledWith(2, {
      name: 'Bob Lim',
      email: null,
      type: 'SIGNER',
      signingOrder: null,
      accessMode: 'MANUAL_LINK',
    });
    expect(toastMocks.success).toHaveBeenCalledWith('Added 2 company contacts as signers.');
  });

  it('does not bulk-add a company contact already present as a signer', async () => {
    const user = userEvent.setup();
    const onAddRecipient = vi.fn<(data: EsigningRecipientInput) => Promise<void>>().mockResolvedValue(undefined);
    const existingRecipient = {
      type: 'SIGNER',
      name: 'Alice Tan',
      email: 'alice@example.com',
    } as EsigningEnvelopeRecipientDto;

    render(
      <LinkedCompanySignerQuickAdd
        companyId="company-1"
        companyName="Golden Lotus Information Service Pte Ltd"
        recipients={[existingRecipient]}
        canEdit
        onAddRecipient={onAddRecipient}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add all as signers' }));

    await waitFor(() => expect(onAddRecipient).toHaveBeenCalledTimes(1));
    expect(onAddRecipient).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Bob Lim',
      email: null,
      accessMode: 'MANUAL_LINK',
    }));
  });

  it('disables bulk add when the envelope has reached the recipient limit', () => {
    const recipients = Array.from({ length: 20 }, (_, index) => ({
      id: `recipient-${index}`,
      type: 'SIGNER',
      name: `Signer ${index}`,
      email: `signer${index}@example.com`,
    })) as EsigningEnvelopeRecipientDto[];

    render(
      <LinkedCompanySignerQuickAdd
        companyId="company-1"
        companyName="Golden Lotus Information Service Pte Ltd"
        recipients={recipients}
        canEdit
        onAddRecipient={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add all as signers' })).toBeDisabled();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import EditContactPage from '@/app/(dashboard)/contacts/[id]/edit/page';

const hookMocks = vi.hoisted(() => ({
  contact: null as Record<string, unknown> | null,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    use: (value: unknown) => {
      if (value && typeof value === 'object' && 'then' in value) {
        return { id: 'contact-1' };
      }
      return value;
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-contacts', () => ({
  useContact: () => ({ data: hookMocks.contact, isLoading: false, error: null }),
  useUpdateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: { createContact: true, updateContact: true },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/use-unsaved-navigation-guard', () => ({
  useUnsavedNavigationGuard: () => ({ requestNavigation: vi.fn(), requestAction: vi.fn(), disarm: vi.fn(), rearm: vi.fn(), dialog: null }),
}));

vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: vi.fn() }),
}));

function makeContact(firstName: string) {
  return {
    id: 'contact-1',
    contactType: 'INDIVIDUAL',
    firstName,
    lastName: 'Contact',
    alias: null,
    identificationType: null,
    identificationNumber: null,
    nationality: 'SINGAPOREAN',
    dateOfBirth: null,
    corporateName: null,
    corporateUen: null,
    fullAddress: null,
    fullName: `${firstName} Contact`,
  };
}

describe('EditContactPage', () => {
  beforeEach(() => {
    hookMocks.contact = makeContact('Existing');
  });

  it('keeps a dirty field when the contact query refreshes', async () => {
    const { rerender } = render(
      <EditContactPage params={Promise.resolve({ id: 'contact-1' })} />
    );

    const firstNameInput = await screen.findByPlaceholderText('John');
    expect(firstNameInput).toHaveValue('Existing');
    fireEvent.change(firstNameInput, { target: { value: 'My draft' } });

    hookMocks.contact = makeContact('Server refresh');
    rerender(<EditContactPage params={Promise.resolve({ id: 'contact-1' })} />);

    await waitFor(() => expect(firstNameInput).toHaveValue('My draft'));
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PublicSigningPage from '@/app/(public)/esigning/sign/[token]/page';

vi.mock('@/components/esigning/esigning-sign-page', async () => {
  const { useQueryClient } = await vi.importActual<
    typeof import('@tanstack/react-query')
  >('@tanstack/react-query');
  const { useToast } = await vi.importActual<
    typeof import('@/components/ui/toast')
  >('@/components/ui/toast');

  return {
    EsigningSignPage: function SigningContextConsumer() {
      useQueryClient();
      useToast();
      return <div>Public signing ready</div>;
    },
  };
});

describe('public signing route context', () => {
  it('renders with its required lightweight contexts', () => {
    expect(() => render(<PublicSigningPage />)).not.toThrow();
    expect(screen.getByText('Public signing ready')).toBeInTheDocument();
  });
});

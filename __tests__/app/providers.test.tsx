import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useQueryClient } from '@tanstack/react-query';
import { Providers } from '@/app/providers';

function QueryDefaultsProbe() {
  const queryClient = useQueryClient();
  const queryDefaults = queryClient.getDefaultOptions().queries;

  return (
    <output data-testid="query-defaults">
      {String(queryDefaults?.refetchOnMount)}|{String(queryDefaults?.refetchOnWindowFocus)}
    </output>
  );
}

describe('Providers', () => {
  it('refreshes cached queries on mount and window focus by default', () => {
    render(
      <Providers>
        <QueryDefaultsProbe />
      </Providers>
    );

    expect(screen.getByTestId('query-defaults')).toHaveTextContent('always|always');
  });
});

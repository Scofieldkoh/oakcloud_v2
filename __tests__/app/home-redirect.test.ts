import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});

vi.mock('next/navigation', () => ({
  redirect,
}));

describe('home route', () => {
  it('redirects to Companies as the default starting page', async () => {
    const { default: HomePage } = await import('@/app/(auth)/page');

    expect(() => HomePage()).toThrow('redirect:/companies');
    expect(redirect).toHaveBeenCalledWith('/companies');
  });
});

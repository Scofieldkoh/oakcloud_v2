import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAvailability: vi.fn(),
  checkRateLimit: vi.fn(),
}));

class MockCompanyNameCheckUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanyNameCheckUnavailableError';
  }
}

vi.mock('@/lib/external/company-name-check', () => ({
  checkCompanyNameAvailability: mocks.checkAvailability,
  CompanyNameCheckUnavailableError: MockCompanyNameCheckUnavailableError,
  COMPANY_NAME_MAX_LENGTH: 300,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: () => '203.0.113.10',
  getRateLimitKey: (operation: string, ip: string) => `${operation}:${ip}`,
  RATE_LIMIT_CONFIGS: {
    FORM_NAME_CHECK: { maxRequests: 20, windowMs: 60_000 },
  },
}));

describe('POST /api/forms/name-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 60_000,
      isLockedOut: false,
    });
  });

  it('returns the availability result', async () => {
    mocks.checkAvailability.mockResolvedValue({
      available: true,
      checkedAt: '2026-08-06T00:00:00.000Z',
      records: [],
    });

    const { POST } = await import('@/app/api/forms/name-check/route');
    const request = new Request('http://localhost/api/forms/name-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Holdings' }),
    });
    const response = await POST(request as NextRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      checkedAt: '2026-08-06T00:00:00.000Z',
      records: [],
    });
    expect(mocks.checkAvailability).toHaveBeenCalledWith('Acme Holdings');
  });

  it('returns 400 for an empty name', async () => {
    const { POST } = await import('@/app/api/forms/name-check/route');
    const request = new Request('http://localhost/api/forms/name-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    const response = await POST(request as NextRequest);

    expect(response.status).toBe(400);
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
  });

  it('returns 502 when the upstream check is unavailable', async () => {
    mocks.checkAvailability.mockRejectedValue(
      new MockCompanyNameCheckUnavailableError('upstream down')
    );

    const { POST } = await import('@/app/api/forms/name-check/route');
    const request = new Request('http://localhost/api/forms/name-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Holdings' }),
    });
    const response = await POST(request as NextRequest);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Availability check temporarily unavailable. Please try again.',
    });
  });

  it('returns 429 when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      isLockedOut: false,
      reason: 'rate_limit_exceeded',
    });

    const { POST } = await import('@/app/api/forms/name-check/route');
    const request = new Request('http://localhost/api/forms/name-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Holdings' }),
    });
    const response = await POST(request as NextRequest);

    expect(response.status).toBe(429);
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
  });
});

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Mock environment variables for tests
// JWT_SECRET must be at least 32 characters long
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-at-least-32-chars-long';
// Preserve the explicitly selected disposable assistant integration database.
// All other test runs receive the local placeholder and cannot accidentally
// connect to an application database.
if (!process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
}

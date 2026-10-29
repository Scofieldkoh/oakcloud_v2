import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/config', () => ({
  getStorageConfig: () => ({ s3Bucket: 'bucket' }),
}));

import {
  getFormBackgroundPublicUrl,
  isFormBackgroundStorageKey,
  normalizeFormBackgroundUrl,
} from '@/lib/form-background-url';

describe('form background URL helpers', () => {
  it('accepts valid form background storage keys', () => {
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.png')).toBe(true);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.jpeg')).toBe(true);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.WEBP')).toBe(true);
  });

  it('rejects non-background and malformed keys', () => {
    expect(isFormBackgroundStorageKey('tenant-1/branding/logo.png')).toBe(false);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.svg')).toBe(false);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/background.png')).toBe(false);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.png/extra')).toBe(false);
  });

  it('builds a public URL from a storage key', () => {
    expect(getFormBackgroundPublicUrl('tenant-1/forms/form-1/branding/background.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('normalizes a raw storage key to the app URL', () => {
    expect(normalizeFormBackgroundUrl('tenant-1/forms/form-1/branding/background.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('normalizes an app storage URL to itself', () => {
    expect(normalizeFormBackgroundUrl('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('normalizes an S3 URL to the app URL', () => {
    expect(normalizeFormBackgroundUrl('https://s3.amazonaws.com/bucket/tenant-1/forms/form-1/branding/background.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('passes arbitrary URLs through unchanged', () => {
    expect(normalizeFormBackgroundUrl('https://example.com/bg.png')).toBe('https://example.com/bg.png');
    expect(normalizeFormBackgroundUrl('tenant-1/other/file.png')).toBe('tenant-1/other/file.png');
  });

  it('returns null for empty values', () => {
    expect(normalizeFormBackgroundUrl(null)).toBeNull();
    expect(normalizeFormBackgroundUrl(undefined)).toBeNull();
    expect(normalizeFormBackgroundUrl('   ')).toBeNull();
  });
});

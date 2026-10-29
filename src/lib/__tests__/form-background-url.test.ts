import { describe, expect, it } from 'vitest';
import { StorageKeys } from '@/lib/storage/config';
import {
  getFormBackgroundPublicUrl,
  isFormBackgroundStorageKey,
  normalizeFormBackgroundUrl,
} from '@/lib/form-background-url';

describe('form background storage keys', () => {
  it('gives each upload its own key and URL so a replaced image is not served from cache', () => {
    const first = StorageKeys.formBackground('tenant-1', 'form-1', '.png', 'mg4a1b2c');
    const second = StorageKeys.formBackground('tenant-1', 'form-1', '.png', 'mg4a1b9z');

    expect(first).not.toBe(second);
    expect(getFormBackgroundPublicUrl(first)).not.toBe(getFormBackgroundPublicUrl(second));
    expect(isFormBackgroundStorageKey(first)).toBe(true);
    expect(isFormBackgroundStorageKey(second)).toBe(true);
  });

  it('still accepts backgrounds saved under the old unversioned key', () => {
    const legacy = StorageKeys.formBackground('tenant-1', 'form-1', '.jpg');

    expect(legacy).toBe('tenant-1/forms/form-1/branding/background.jpg');
    expect(isFormBackgroundStorageKey(legacy)).toBe(true);
    expect(normalizeFormBackgroundUrl(legacy)).toBe(getFormBackgroundPublicUrl(legacy));
  });

  it('keeps the versioned key when normalizing a stored URL', () => {
    const key = StorageKeys.formBackground('tenant-1', 'form-1', '.webp', 'mg4a1b2c');
    expect(normalizeFormBackgroundUrl(getFormBackgroundPublicUrl(key))).toBe(getFormBackgroundPublicUrl(key));
  });

  it('rejects keys outside the form branding folder', () => {
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background-../x.png')).toBe(false);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/uploads/background-abc.png')).toBe(false);
  });
});

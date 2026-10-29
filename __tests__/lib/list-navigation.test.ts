import { describe, expect, it } from 'vitest';
import { buildDetailHref, getSafeListReturnUrl } from '@/lib/list-navigation';

describe('list navigation', () => {
  it('encodes the complete list state in a detail URL', () => {
    expect(buildDetailHref('/contacts/contact-1', '/contacts?page=3&q=Jane Doe&sortOrder=desc'))
      .toBe('/contacts/contact-1?returnTo=%2Fcontacts%3Fpage%3D3%26q%3DJane+Doe%26sortOrder%3Ddesc');
  });

  it.each([
    ['/contacts?page=3&limit=50', '/contacts', '/contacts?page=3&limit=50'],
    ['/companies?page=4&status=LIVE', '/companies', '/companies?page=4&status=LIVE'],
    [null, '/contacts', '/contacts'],
    ['https://evil.example/contacts?page=3', '/contacts', '/contacts'],
    ['//evil.example/contacts?page=3', '/contacts', '/contacts'],
    ['/companies?page=3', '/contacts', '/contacts'],
    ['/contacts/contact-1', '/contacts', '/contacts'],
    ['/contacts?page=3#fragment', '/contacts', '/contacts'],
  ] as const)('validates %s for %s', (value, expectedPath, expected) => {
    expect(getSafeListReturnUrl(value, expectedPath)).toBe(expected);
  });
});

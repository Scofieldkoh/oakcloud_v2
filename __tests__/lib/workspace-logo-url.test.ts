import { describe, expect, it } from 'vitest';
import { normalizeWorkspaceLogoUrl } from '@/lib/workspace-logo-url';

describe('normalizeWorkspaceLogoUrl', () => {
  it('keeps external image URLs unchanged', () => {
    expect(normalizeWorkspaceLogoUrl('https://example.com/logo.png')).toBe('https://example.com/logo.png');
  });

  it('converts storage keys to app-served URLs', () => {
    expect(normalizeWorkspaceLogoUrl('workspace-1/branding/logo.png')).toBe('/api/storage/workspace-1%2Fbranding%2Flogo.png');
  });

  it('converts MinIO public URLs to app-served URLs', () => {
    expect(
      normalizeWorkspaceLogoUrl('http://host.docker.internal:9000/oakcloud/workspace-1/branding/logo.png')
    ).toBe('/api/storage/workspace-1%2Fbranding%2Flogo.png');
  });
});

import { describe, expect, it } from 'vitest';
import { parseSharePointFolderRef, sharePointFolderRefSchema } from '@/lib/sharepoint/folder-reference';

describe('SharePoint folder references', () => {
  const valid = { driveId: 'drive-1', itemId: 'item-1', name: 'Client Documents', webUrl: 'https://tenant.sharepoint.com/sites/example/Shared%20Documents' };

  it('accepts a canonical reference', () => expect(parseSharePointFolderRef(valid)).toEqual(valid));
  it('rejects empty identities and non-http URLs', () => {
    expect(sharePointFolderRefSchema.safeParse({ ...valid, driveId: '' }).success).toBe(false);
    expect(sharePointFolderRefSchema.safeParse({ ...valid, webUrl: 'ftp://example.test/folder' }).success).toBe(false);
  });
});

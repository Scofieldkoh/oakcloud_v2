import { z } from 'zod';

/**
 * Stable SharePoint folder identity. The item id is authoritative; name and
 * URL are cached presentation values returned by Microsoft Graph.
 */
export const sharePointFolderRefSchema = z.object({
  driveId: z.string().trim().min(1, 'SharePoint drive ID is required'),
  itemId: z.string().trim().min(1, 'SharePoint item ID is required'),
  name: z.string().trim().min(1, 'SharePoint folder name is required'),
  webUrl: z.string().url('SharePoint folder URL must be a valid URL').refine(
    (value) => /^https?:\/\//i.test(value),
    'SharePoint folder URL must use HTTP or HTTPS',
  ),
});

export type SharePointFolderRef = z.infer<typeof sharePointFolderRefSchema>;

export function parseSharePointFolderRef(value: unknown): SharePointFolderRef {
  return sharePointFolderRefSchema.parse(value);
}


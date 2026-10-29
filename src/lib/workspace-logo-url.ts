import { getStorageConfig } from '@/lib/storage/config';

const WORKSPACE_LOGO_KEY_PATTERN = /^[^/]+\/branding\/logo\.(png|jpg|jpeg|webp|gif)$/i;

export function isWorkspaceLogoStorageKey(value: string): boolean {
  return WORKSPACE_LOGO_KEY_PATTERN.test(value);
}

export function getWorkspaceLogoPublicUrl(storageKey: string): string {
  return `/api/storage/${encodeURIComponent(storageKey)}`;
}

function storageKeyFromAppStorageUrl(pathname: string): string | null {
  if (!pathname.startsWith('/api/storage/')) return null;

  try {
    const key = decodeURIComponent(pathname.slice('/api/storage/'.length));
    return isWorkspaceLogoStorageKey(key) ? key : null;
  } catch {
    return null;
  }
}

function storageKeyFromS3Url(pathname: string): string | null {
  const bucket = getStorageConfig().s3Bucket;
  if (!bucket) return null;

  const bucketPrefix = `/${bucket}/`;
  if (!pathname.startsWith(bucketPrefix)) return null;

  try {
    const key = decodeURIComponent(pathname.slice(bucketPrefix.length));
    return isWorkspaceLogoStorageKey(key) ? key : null;
  } catch {
    return null;
  }
}

export function normalizeWorkspaceLogoUrl(logoUrl: string | null | undefined): string | null {
  const trimmed = logoUrl?.trim();
  if (!trimmed) return null;

  if (isWorkspaceLogoStorageKey(trimmed)) {
    return getWorkspaceLogoPublicUrl(trimmed);
  }

  try {
    const parsed = new URL(trimmed, 'http://app.local');
    const storageKey = storageKeyFromAppStorageUrl(parsed.pathname) ?? storageKeyFromS3Url(parsed.pathname);
    return storageKey ? getWorkspaceLogoPublicUrl(storageKey) : trimmed;
  } catch {
    return trimmed;
  }
}

import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import {
  getFormBackgroundFolder,
  getFormBackgroundStorageKey,
  isFormBackgroundStorageKey,
} from '@/lib/form-background-url';

const log = createLogger('form-background-service');

// An image uploaded in the builder is stored before the form is saved, so a
// save from elsewhere in that window must not delete it.
export const UNSAVED_BACKGROUND_GRACE_MS = 15 * 60 * 1000;

function backgroundUrlOf(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>).backgroundImageUrl;
  return typeof value === 'string' ? value : null;
}

/**
 * Deletes background images in a form's branding folder that no form uses.
 * Duplicated forms keep pointing at the source form's image, and archived forms
 * can be restored, so every form in the workspace counts as a reference.
 */
export async function deleteUnusedFormBackgrounds(
  tenantId: string,
  formId: string,
  options: { graceMs?: number; now?: Date } = {}
): Promise<string[]> {
  const graceMs = options.graceMs ?? UNSAVED_BACKGROUND_GRACE_MS;
  const now = options.now ?? new Date();
  const folder = getFormBackgroundFolder(tenantId, formId);

  const files = (await storage.list(`${folder}/`)).filter((file) => isFormBackgroundStorageKey(file.key));
  if (files.length === 0) return [];

  const referencingForms = await prisma.form.findMany({
    where: {
      tenantId,
      OR: [folder, encodeURIComponent(folder)].map((needle) => ({
        settings: { path: ['backgroundImageUrl'], string_contains: needle },
      })),
    },
    select: { settings: true },
  });
  const inUse = new Set(
    referencingForms
      .map((form) => getFormBackgroundStorageKey(backgroundUrlOf(form.settings)))
      .filter((key): key is string => key !== null)
  );

  const unused = files.filter(
    (file) => !inUse.has(file.key) && now.getTime() - file.lastModified.getTime() >= graceMs
  );
  const results = await Promise.allSettled(unused.map((file) => storage.delete(file.key)));

  const deleted: string[] = [];
  results.forEach((result, index) => {
    const key = unused[index].key;
    if (result.status === 'fulfilled') {
      deleted.push(key);
      return;
    }
    log.error('Failed to delete unused form background', {
      formId,
      storageKey: key,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
  return deleted;
}

export async function deleteUnusedFormBackgroundsSafely(
  tenantId: string,
  formId: string,
  options?: { graceMs?: number }
): Promise<void> {
  try {
    await deleteUnusedFormBackgrounds(tenantId, formId, options);
  } catch (error) {
    log.error('Failed to clean up form backgrounds', {
      formId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

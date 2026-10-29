/**
 * The backup password and full-backup schedule (one row, id "default").
 *
 * The password is kept locked with ENCRYPTION_KEY so scheduled backups can run
 * unattended; it is also what a person types to restore on another install.
 */

import { prisma } from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { getNextCronOccurrence } from '@/lib/cron-utils';
import { MIN_BACKUP_PASSWORD_LENGTH } from './archive';

const SETTINGS_ID = 'default';

export interface BackupSettingsView {
  hasPassword: boolean;
  passwordUpdatedAt: Date | null;
  scheduleEnabled: boolean;
  cronPattern: string;
  timezone: string;
  maxBackups: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
}

export async function getBackupSettings(): Promise<BackupSettingsView> {
  const settings = await prisma.backupSettings.findUnique({ where: { id: SETTINGS_ID } });
  return {
    hasPassword: Boolean(settings?.passwordCiphertext),
    passwordUpdatedAt: settings?.passwordUpdatedAt ?? null,
    scheduleEnabled: settings?.scheduleEnabled ?? false,
    cronPattern: settings?.cronPattern ?? '0 2 * * *',
    timezone: settings?.timezone ?? 'Asia/Singapore',
    maxBackups: settings?.maxBackups ?? 14,
    nextRunAt: settings?.nextRunAt ?? null,
    lastRunAt: settings?.lastRunAt ?? null,
    lastError: settings?.lastError ?? null,
  };
}

export function assertBackupPasswordStrength(password: string): void {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error(`The backup password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters`);
  }
}

export async function setBackupPassword(password: string, userId: string): Promise<void> {
  assertBackupPasswordStrength(password);
  const now = new Date();
  const data = { passwordCiphertext: encrypt(password), passwordUpdatedAt: now, updatedById: userId };
  await prisma.backupSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
}

/** The saved password, or null when none is set or this install's key cannot unlock it. */
export async function getBackupPassword(): Promise<string | null> {
  const settings = await prisma.backupSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { passwordCiphertext: true },
  });
  if (!settings?.passwordCiphertext) return null;
  try {
    return decrypt(settings.passwordCiphertext);
  } catch {
    return null;
  }
}

export async function updateBackupSchedule(
  input: { scheduleEnabled: boolean; cronPattern: string; timezone: string; maxBackups: number },
  userId: string,
): Promise<BackupSettingsView> {
  const nextRunAt = input.scheduleEnabled ? getNextCronOccurrence(input.cronPattern, input.timezone) : null;
  const data = { ...input, nextRunAt, updatedById: userId, lastError: null, consecutiveFailures: 0 };
  await prisma.backupSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
  return getBackupSettings();
}

/**
 * Claims the schedule's current run, advancing nextRunAt so no other worker
 * runs it too. Returns false when nothing is due or another worker claimed it.
 */
export async function claimDueScheduledRun(now = new Date()): Promise<boolean> {
  const settings = await prisma.backupSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!settings?.scheduleEnabled || !settings.nextRunAt || settings.nextRunAt > now) return false;
  const claimed = await prisma.backupSettings.updateMany({
    where: { id: SETTINGS_ID, scheduleEnabled: true, nextRunAt: settings.nextRunAt },
    data: { nextRunAt: getNextCronOccurrence(settings.cronPattern, settings.timezone, now), lastRunAt: now },
  });
  return claimed.count === 1;
}

export async function recordScheduledRun(result: { backupId?: string; error?: string }): Promise<void> {
  await prisma.backupSettings.update({
    where: { id: SETTINGS_ID },
    data: result.error
      ? { lastError: result.error, consecutiveFailures: { increment: 1 } }
      : { lastBackupId: result.backupId, lastError: null, consecutiveFailures: 0 },
  });
}

export async function getScheduledMaxBackups(): Promise<number> {
  return (await getBackupSettings()).maxBackups;
}

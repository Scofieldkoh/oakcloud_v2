/**
 * Shared types for full (whole-install) backups.
 */

export const FULL_BACKUP_FORMAT = 'oakcloud-full-backup';
export const FULL_BACKUP_FORMAT_VERSION = 1;
export const FULL_BACKUP_FILE_EXTENSION = '.oakbackup';

export interface FullBackupTable {
  name: string;
  columns: string[];
  rows: number;
}

export interface FullBackupFile {
  key: string;
  size: number;
  contentType: string;
  sha256: string;
}

export interface FullBackupManifest {
  format: typeof FULL_BACKUP_FORMAT;
  formatVersion: number;
  backupId: string;
  name: string;
  createdAt: string;
  /** Migrations applied on the install that made the backup. */
  migrations: string[];
  workspaces: Array<{ id: string; name: string }>;
  tables: FullBackupTable[];
  files: FullBackupFile[];
  /** Stored files that could not be read when the backup was made. */
  skippedFiles: Array<{ key: string; reason: string }>;
  /** Connector secrets this install's key could not unlock; they will not work after a restore elsewhere. */
  lockedSecrets: number;
  totals: { rows: number; files: number; fileBytes: number };
}

/** What a restore would do, shown before the person confirms. */
export interface FullBackupPreview {
  backupId: string;
  name: string;
  createdAt: string;
  workspaces: Array<{ id: string; name: string }>;
  totals: FullBackupManifest['totals'];
  counts: {
    users: number;
    companies: number;
    contacts: number;
    documents: number;
    templates: number;
    connectors: number;
  };
  skippedFiles: number;
  lockedSecrets: number;
  /** Blocking problems; restore is refused while any are present. */
  blockers: string[];
  /** Non-blocking notes the person should read. */
  warnings: string[];
  /** What each module holds in the backup and here, for choosing a module restore. */
  modules: FullBackupModuleSummary[];
}

export interface FullBackupModuleSummary {
  key: string;
  label: string;
  description: string;
  backupRows: number;
  liveRows: number;
}

export interface ModuleTableChange {
  table: string;
  added: number;
  replaced: number;
  removed: number;
  unchanged: number;
}

export interface ModuleChange {
  module: string;
  label: string;
  added: number;
  replaced: number;
  removed: number;
  unchanged: number;
  tables: ModuleTableChange[];
}

export interface ModuleLinkProblem {
  /** The module whose rows hold the link. */
  fromModule: string;
  /** The module the link points into. */
  toModule: string;
  /** Module that, added to the selection, resolves this problem. */
  addModule: string;
  rows: number;
  message: string;
}

/** What restoring the chosen modules would do. */
export interface ModuleRestorePreview {
  backupId: string;
  modules: string[];
  changes: ModuleChange[];
  links: ModuleLinkProblem[];
  /** Modules to add so no link breaks. */
  suggestedModules: string[];
  /** Stored files in the backup that this machine does not have. */
  missingFiles: number;
  blockers: string[];
  warnings: string[];
}

export const FULL_RESTORE_CONFIRMATION = 'RESTORE';

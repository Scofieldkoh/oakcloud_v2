-- Full (whole-install) backups and the backup password/schedule settings.

-- CreateEnum
CREATE TYPE "SystemBackupSource" AS ENUM ('MANUAL', 'SCHEDULED', 'UPLOADED');

-- CreateTable
CREATE TABLE "system_backups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "SystemBackupSource" NOT NULL DEFAULT 'MANUAL',
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "archive_key" TEXT,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "rows_count" INTEGER NOT NULL DEFAULT 0,
    "files_count" INTEGER NOT NULL DEFAULT 0,
    "manifest_json" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "current_step" TEXT,
    "error_message" TEXT,
    "created_by_id" TEXT,
    "restored_at" TIMESTAMP(3),
    "restored_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "system_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "password_ciphertext" TEXT,
    "password_updated_at" TIMESTAMP(3),
    "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
    "cron_pattern" TEXT NOT NULL DEFAULT '0 2 * * *',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Singapore',
    "max_backups" INTEGER NOT NULL DEFAULT 14,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_backup_id" TEXT,
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_backups_status_idx" ON "system_backups"("status");

-- CreateIndex
CREATE INDEX "system_backups_created_at_idx" ON "system_backups"("created_at");

-- SharePoint cloud copy of full backups.

-- AlterTable
ALTER TABLE "backup_settings"
    ADD COLUMN "sharepoint_connector_id" TEXT,
    ADD COLUMN "sharepoint_drive_id" TEXT,
    ADD COLUMN "sharepoint_folder_id" TEXT,
    ADD COLUMN "sharepoint_folder_name" TEXT,
    ADD COLUMN "sharepoint_folder_url" TEXT,
    ADD COLUMN "sharepoint_max_backups" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "system_backups"
    ADD COLUMN "sharepoint_status" TEXT,
    ADD COLUMN "sharepoint_item_id" TEXT,
    ADD COLUMN "sharepoint_web_url" TEXT,
    ADD COLUMN "sharepoint_error" TEXT,
    ADD COLUMN "sharepoint_uploaded_at" TIMESTAMP(3);

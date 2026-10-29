# Oakcloud Backup Script for Migration
# Run this on your DEV machine to export all data

$ErrorActionPreference = "Stop"
$BackupDir = ".\migration-backup"

Write-Host "=== Oakcloud Migration Backup ===" -ForegroundColor Cyan
Write-Host ""

# Create backup directory
if (Test-Path $BackupDir) {
    Remove-Item -Recurse -Force $BackupDir
}
New-Item -ItemType Directory -Path $BackupDir | Out-Null
Write-Host "[1/4] Created backup directory: $BackupDir" -ForegroundColor Green

# Check if containers are running
$postgresRunning = docker ps --filter "name=oakcloud-postgres" --format "{{.Names}}" 2>$null
if (-not $postgresRunning) {
    Write-Host "Error: oakcloud-postgres container is not running!" -ForegroundColor Red
    Write-Host "Start it with: npm run docker:db:up" -ForegroundColor Yellow
    exit 1
}

# Export PostgreSQL database
Write-Host "[2/4] Exporting PostgreSQL database..." -ForegroundColor Yellow
docker exec oakcloud-postgres pg_dump -U oakcloud oakcloud > "$BackupDir\database.sql"
Write-Host "      Database exported to $BackupDir\database.sql" -ForegroundColor Green

# Export MinIO data (from bind-mounted local directory)
Write-Host "[3/4] Exporting MinIO data (documents/files)..." -ForegroundColor Yellow
if (Test-Path ".\docker-data\minio") {
    tar cvf "$BackupDir\minio_data.tar" -C ".\docker-data\minio" . 2>$null
    Write-Host "      MinIO data exported to $BackupDir\minio_data.tar" -ForegroundColor Green
} else {
    Write-Host "      Warning: docker-data\minio not found, skipping MinIO backup" -ForegroundColor Yellow
}

# Export Redis data (optional but included)
Write-Host "[4/4] Exporting Redis data..." -ForegroundColor Yellow
docker run --rm `
    -v oakcloud_redis_data:/data `
    -v "${PWD}\${BackupDir}:/backup" `
    alpine tar cvf /backup/redis_data.tar -C /data . 2>$null
Write-Host "      Redis data exported to $BackupDir\redis_data.tar" -ForegroundColor Green

# Create .env template reminder
@"
# REMINDER: Copy your .env file to the production machine
# Update these values for production:
#
# NODE_ENV="production"
# NEXT_PUBLIC_APP_URL="https://your-domain.com"
# JWT_SECRET="generate-new-secret"
# ENCRYPTION_KEY="generate-new-key"
"@ | Out-File -FilePath "$BackupDir\ENV_REMINDER.txt"

Write-Host ""
Write-Host "=== Backup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Files created in $BackupDir/:" -ForegroundColor White
Get-ChildItem $BackupDir | ForEach-Object { Write-Host "  - $($_.Name)" }
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Copy the '$BackupDir' folder to your production machine"
Write-Host "  2. Copy your '.env' file (update values for production)"
Write-Host "  3. Run the restore script on the production machine"
Write-Host ""

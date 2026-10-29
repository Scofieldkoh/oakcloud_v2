-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "public"."AccountingProvider" AS ENUM ('XERO', 'QUICKBOOKS', 'MYOB', 'SAGE');

-- CreateEnum
CREATE TYPE "public"."AddressType" AS ENUM ('REGISTERED_OFFICE', 'MAILING', 'RESIDENTIAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "public"."AttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');

-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'UPLOAD', 'DOWNLOAD', 'EXTRACT', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGE_REQUIRED', 'PASSWORD_CHANGE_CLEARED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'ROLE_CHANGED', 'TENANT_CREATED', 'TENANT_UPDATED', 'TENANT_SUSPENDED', 'TENANT_ACTIVATED', 'USER_INVITED', 'USER_REMOVED', 'USER_COMPANY_ASSIGNED', 'USER_COMPANY_UPDATED', 'USER_COMPANY_REMOVED', 'EXPORT', 'IMPORT', 'BULK_UPDATE', 'CONNECTOR_CREATED', 'CONNECTOR_UPDATED', 'CONNECTOR_DELETED', 'CONNECTOR_TESTED', 'CONNECTOR_ENABLED', 'CONNECTOR_DISABLED', 'DOCUMENT_TEMPLATE_CREATED', 'DOCUMENT_TEMPLATE_UPDATED', 'DOCUMENT_TEMPLATE_DELETED', 'DOCUMENT_TEMPLATE_DUPLICATED', 'DOCUMENT_GENERATED', 'DOCUMENT_FINALIZED', 'DOCUMENT_UNFINALIZED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_CLONED', 'SHARE_LINK_CREATED', 'SHARE_LINK_REVOKED', 'LETTERHEAD_UPDATED', 'COMMENT_CREATED', 'COMMENT_RESOLVED', 'COMMENT_HIDDEN', 'BACKUP_CREATED', 'BACKUP_COMPLETED', 'BACKUP_FAILED', 'BACKUP_DELETED', 'BACKUP_RESTORE_STARTED', 'BACKUP_RESTORE_COMPLETED', 'BACKUP_RESTORE_FAILED', 'BACKUP_SCHEDULE_UPDATED', 'EXCHANGE_RATE_SYNCED', 'EXCHANGE_RATE_CREATED', 'EXCHANGE_RATE_UPDATED', 'EXCHANGE_RATE_DELETED', 'CHART_OF_ACCOUNTS_CREATED', 'CHART_OF_ACCOUNTS_UPDATED', 'CHART_OF_ACCOUNTS_DELETED', 'CHART_OF_ACCOUNTS_MAPPING_CREATED', 'CHART_OF_ACCOUNTS_MAPPING_UPDATED', 'CHART_OF_ACCOUNTS_MAPPING_DELETED');

-- CreateEnum
CREATE TYPE "public"."BackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RESTORING', 'RESTORED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."BackupType" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "public"."BankTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'TRANSFER', 'FEE', 'INTEREST', 'OTHER_BANK_TXN');

-- CreateEnum
CREATE TYPE "public"."BillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "public"."ChangeSource" AS ENUM ('MANUAL', 'BIZFILE_UPLOAD', 'API', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."CheckpointStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ClientRequestStatus" AS ENUM ('REQUEST_PENDING', 'REQUEST_IN_PROGRESS', 'REQUEST_WAITING_CLIENT', 'REQUEST_RESOLVED', 'REQUEST_CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CommunicationChannel" AS ENUM ('EMAIL_CHANNEL', 'PORTAL_MESSAGE_CHANNEL', 'SMS_CHANNEL');

-- CreateEnum
CREATE TYPE "public"."CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."CompanyStatus" AS ENUM ('LIVE', 'STRUCK_OFF', 'WINDING_UP', 'DISSOLVED', 'IN_LIQUIDATION', 'IN_RECEIVERSHIP', 'AMALGAMATED', 'CONVERTED', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ConnectorProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'ONEDRIVE', 'SHAREPOINT');

-- CreateEnum
CREATE TYPE "public"."ConnectorType" AS ENUM ('AI_PROVIDER', 'STORAGE');

-- CreateEnum
CREATE TYPE "public"."ContactDetailType" AS ENUM ('EMAIL', 'PHONE', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ContactType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "public"."ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "public"."ContractType" AS ENUM ('ENGAGEMENT_LETTER', 'SERVICE_AGREEMENT', 'RETAINER_CONTRACT', 'NDA', 'VENDOR_AGREEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."DeadlineAnchorType" AS ENUM ('FYE', 'SERVICE_START', 'FIXED_CALENDAR', 'QUARTER_END', 'MONTH_END', 'INCORPORATION', 'IPC_EXPIRY');

-- CreateEnum
CREATE TYPE "public"."DeadlineBillingStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'INVOICED', 'PAID');

-- CreateEnum
CREATE TYPE "public"."DeadlineCategory" AS ENUM ('CORPORATE_SECRETARY', 'TAX', 'ACCOUNTING', 'AUDIT', 'COMPLIANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."DeadlineFrequency" AS ENUM ('ANNUALLY', 'QUARTERLY', 'MONTHLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "public"."DeadlineGenerationType" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."DeadlineRuleType" AS ENUM ('RULE_BASED', 'FIXED_DATE');

-- CreateEnum
CREATE TYPE "public"."DeadlineStatus" AS ENUM ('UPCOMING', 'DUE_SOON', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'WAIVED');

-- CreateEnum
CREATE TYPE "public"."DerivedFileKind" AS ENUM ('CHILD_PDF', 'THUMBNAIL', 'REDACTED_PDF');

-- CreateEnum
CREATE TYPE "public"."DocumentCategory" AS ENUM ('ACCOUNTS_PAYABLE', 'ACCOUNTS_RECEIVABLE', 'TREASURY', 'TAX_COMPLIANCE', 'PAYROLL', 'CORPORATE_SECRETARIAL', 'CONTRACTS', 'FINANCIAL_REPORTS', 'INSURANCE', 'CORRESPONDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."DocumentCommentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."DocumentLinkType" AS ENUM ('PO_TO_DN', 'PO_TO_INVOICE', 'DN_TO_INVOICE', 'INVOICE_TO_CN', 'INVOICE_TO_DN_ADJ', 'QUOTE_TO_PO', 'CONTRACT_TO_PO', 'RELATED');

-- CreateEnum
CREATE TYPE "public"."DocumentSubCategory" AS ENUM ('VENDOR_INVOICE', 'VENDOR_CREDIT_NOTE', 'PURCHASE_ORDER', 'DELIVERY_NOTE', 'VENDOR_STATEMENT', 'VENDOR_QUOTATION', 'SALES_INVOICE', 'SALES_CREDIT_NOTE', 'SALES_ORDER', 'DELIVERY_ORDER', 'CUSTOMER_STATEMENT', 'BANK_STATEMENT', 'BANK_ADVICE', 'PAYMENT_VOUCHER', 'RECEIPT_VOUCHER', 'LOAN_DOCUMENT', 'GST_RETURN', 'INCOME_TAX', 'WITHHOLDING_TAX', 'TAX_INVOICE', 'PAYSLIP', 'CPF_SUBMISSION', 'IR8A', 'EXPENSE_CLAIM', 'BIZFILE', 'RESOLUTION', 'REGISTER', 'INCORPORATION', 'ANNUAL_RETURN', 'MEETING_MINUTES', 'VENDOR_CONTRACT', 'CUSTOMER_CONTRACT', 'EMPLOYMENT_CONTRACT', 'LEASE_AGREEMENT', 'FINANCIAL_STATEMENT', 'MANAGEMENT_REPORT', 'AUDIT_REPORT', 'INSURANCE_POLICY', 'INSURANCE_CLAIM', 'LETTER', 'EMAIL', 'MISCELLANEOUS', 'SUPPORTING_DOCUMENT');

-- CreateEnum
CREATE TYPE "public"."DocumentTemplateCategory" AS ENUM ('RESOLUTION', 'CONTRACT', 'LETTER', 'MINUTES', 'NOTICE', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."DuplicateAction" AS ENUM ('CONFIRM_DUPLICATE', 'REJECT_DUPLICATE', 'MARK_AS_NEW_VERSION');

-- CreateEnum
CREATE TYPE "public"."DuplicateStatus" AS ENUM ('NONE', 'SUSPECTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."EntityType" AS ENUM ('PRIVATE_LIMITED', 'EXEMPTED_PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'PUBLIC_COMPANY_LIMITED_BY_GUARANTEE', 'SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_PARTNERSHIP', 'LIMITED_LIABILITY_PARTNERSHIP', 'FOREIGN_COMPANY', 'VARIABLE_CAPITAL_COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ExchangeRateSource" AS ENUM ('MAS_DAILY', 'IRAS_MONTHLY_AVG', 'MANUAL', 'PROVIDER_DEFAULT', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "public"."ExchangeRateType" AS ENUM ('MAS_DAILY_RATE', 'MAS_MONTHLY_RATE', 'MANUAL_RATE');

-- CreateEnum
CREATE TYPE "public"."ExtractionType" AS ENUM ('SPLIT', 'FIELDS');

-- CreateEnum
CREATE TYPE "public"."GeneratedDocumentStatus" AS ENUM ('DRAFT', 'FINALIZED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."GstFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "public"."GstTreatment" AS ENUM ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE');

-- CreateEnum
CREATE TYPE "public"."IdentificationType" AS ENUM ('NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."MatchGroupStatus" AS ENUM ('MATCH_SUGGESTED', 'MATCH_CONFIRMED', 'MATCH_REJECTED');

-- CreateEnum
CREATE TYPE "public"."MatchMethod" AS ENUM ('AUTO_MATCH', 'MANUAL_MATCH', 'RULE_BASED_MATCH');

-- CreateEnum
CREATE TYPE "public"."MatchType" AS ENUM ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY');

-- CreateEnum
CREATE TYPE "public"."OfficerRole" AS ENUM ('DIRECTOR', 'MANAGING_DIRECTOR', 'ALTERNATE_DIRECTOR', 'SECRETARY', 'CEO', 'CFO', 'AUDITOR', 'LIQUIDATOR', 'RECEIVER', 'JUDICIAL_MANAGER');

-- CreateEnum
CREATE TYPE "public"."PeriodStatus" AS ENUM ('PERIOD_OPEN', 'PERIOD_LOCKED', 'PERIOD_CLOSED');

-- CreateEnum
CREATE TYPE "public"."PipelineStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'SPLIT_PENDING', 'SPLIT_DONE', 'EXTRACTION_DONE', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "public"."PostingStatus" AS ENUM ('POSTING_PENDING', 'POSTING_PROCESSING', 'POSTING_POSTED', 'POSTING_FAILED', 'POSTING_SKIPPED');

-- CreateEnum
CREATE TYPE "public"."ProcessingPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."ProcessingStep" AS ENUM ('FILE_VALIDATION', 'RENDER', 'TEXT_ACQUISITION', 'SPLIT_DETECTION', 'FIELD_EXTRACTION', 'VALIDATION', 'REVISION_CREATION', 'DUPLICATE_CHECK');

-- CreateEnum
CREATE TYPE "public"."ReconciliationStatus" AS ENUM ('UNMATCHED', 'MATCH_SUGGESTED', 'MATCHED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "public"."RequestPriority" AS ENUM ('PRIORITY_LOW', 'PRIORITY_NORMAL', 'PRIORITY_HIGH', 'PRIORITY_URGENT');

-- CreateEnum
CREATE TYPE "public"."RevisionPostingStatus" AS ENUM ('NOT_POSTED', 'POSTING', 'POSTED', 'POST_FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."RevisionReconciliationStatus" AS ENUM ('NOT_RECONCILED', 'SUGGESTED', 'RECONCILED', 'UNRECONCILED');

-- CreateEnum
CREATE TYPE "public"."RevisionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "public"."RevisionType" AS ENUM ('EXTRACTION', 'USER_EDIT', 'REPROCESS', 'SYSTEM_MERGE');

-- CreateEnum
CREATE TYPE "public"."RoundingMode" AS ENUM ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP');

-- CreateEnum
CREATE TYPE "public"."ServiceStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'PENDING');

-- CreateEnum
CREATE TYPE "public"."ServiceType" AS ENUM ('RECURRING', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "public"."SplitMethod" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."TagColor" AS ENUM ('GRAY', 'RED', 'ORANGE', 'AMBER', 'GREEN', 'TEAL', 'BLUE', 'INDIGO', 'PURPLE', 'PINK');

-- CreateEnum
CREATE TYPE "public"."TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_SETUP', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "public"."UploadSource" AS ENUM ('WEB', 'EMAIL', 'API', 'CLIENT_PORTAL');

-- CreateEnum
CREATE TYPE "public"."ValidationStatus" AS ENUM ('PENDING', 'VALID', 'WARNINGS', 'INVALID');

-- CreateTable
CREATE TABLE "public"."accounting_integrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "provider" "public"."AccountingProvider" NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contextType" VARCHAR(20) NOT NULL,
    "context_id" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "companyId" TEXT,
    "action" "public"."AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changeSource" "public"."ChangeSource" NOT NULL DEFAULT 'MANUAL',
    "changes" JSONB,
    "reason" TEXT,
    "summary" TEXT,
    "entityName" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."backup_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cron_pattern" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "max_backups" INTEGER NOT NULL DEFAULT 10,
    "last_run_at" TIMESTAMP(3),
    "last_backup_id" TEXT,
    "next_run_at" TIMESTAMP(3),
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bank_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "bank_provider" TEXT,
    "external_id" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bank_transactions" (
    "id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "value_date" DATE,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "running_balance" DECIMAL(18,4),
    "transaction_type" "public"."BankTransactionType" NOT NULL,
    "import_batch_id" TEXT,
    "external_id" TEXT,
    "reconciliation_status" "public"."ReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chart_of_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "company_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "account_type" "public"."AccountType" NOT NULL,
    "status" "public"."AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "parent_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_tax_applicable" BOOLEAN NOT NULL DEFAULT true,
    "is_header" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chart_of_accounts_mappings" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "provider" "public"."AccountingProvider" NOT NULL,
    "external_code" TEXT,
    "external_id" TEXT,
    "external_name" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "sync_status" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."client_portal_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."client_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "status" "public"."ClientRequestStatus" NOT NULL DEFAULT 'REQUEST_PENDING',
    "priority" "public"."RequestPriority" NOT NULL DEFAULT 'PRIORITY_NORMAL',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "client_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."communications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_request_id" TEXT,
    "direction" "public"."CommunicationDirection" NOT NULL,
    "channel" "public"."CommunicationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "from_user_id" TEXT,
    "from_client_user_id" TEXT,
    "to_emails" TEXT[],
    "external_message_id" TEXT,
    "thread_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."companies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uen" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formerName" TEXT,
    "dateOfNameChange" TIMESTAMP(3),
    "entityType" "public"."EntityType" NOT NULL DEFAULT 'PRIVATE_LIMITED',
    "status" "public"."CompanyStatus" NOT NULL DEFAULT 'LIVE',
    "statusDate" TIMESTAMP(3),
    "incorporationDate" TIMESTAMP(3),
    "registrationDate" TIMESTAMP(3),
    "dateOfAddress" TIMESTAMP(3),
    "primarySsicCode" TEXT,
    "primarySsicDescription" TEXT,
    "secondarySsicCode" TEXT,
    "secondarySsicDescription" TEXT,
    "financialYearEndDay" INTEGER,
    "financialYearEndMonth" INTEGER,
    "fyeAsAtLastAr" TIMESTAMP(3),
    "homeCurrency" TEXT DEFAULT 'SGD',
    "lastAgmDate" TIMESTAMP(3),
    "lastArFiledDate" TIMESTAMP(3),
    "nextAgmDueDate" TIMESTAMP(3),
    "nextArDueDate" TIMESTAMP(3),
    "accountsDueDate" TIMESTAMP(3),
    "paidUpCapitalCurrency" TEXT DEFAULT 'SGD',
    "paidUpCapitalAmount" DECIMAL(18,2),
    "issuedCapitalCurrency" TEXT DEFAULT 'SGD',
    "issuedCapitalAmount" DECIMAL(18,2),
    "hasCharges" BOOLEAN NOT NULL DEFAULT false,
    "isGstRegistered" BOOLEAN NOT NULL DEFAULT false,
    "gstRegistrationNumber" TEXT,
    "gstRegistrationDate" TIMESTAMP(3),
    "agmDispensed" BOOLEAN NOT NULL DEFAULT false,
    "isDormant" BOOLEAN NOT NULL DEFAULT false,
    "dormantTaxExemptionApproved" BOOLEAN NOT NULL DEFAULT false,
    "gstFilingFrequency" "public"."GstFilingFrequency",
    "isRegisteredCharity" BOOLEAN NOT NULL DEFAULT false,
    "charityRegistrationDate" TIMESTAMP(3),
    "charityUEN" TEXT,
    "isIPC" BOOLEAN NOT NULL DEFAULT false,
    "ipcEffectiveDate" TIMESTAMP(3),
    "ipcExpiryDate" TIMESTAMP(3),
    "annualReceiptsOrExpenditure" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_addresses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addressType" "public"."AddressType" NOT NULL,
    "block" TEXT,
    "streetName" TEXT NOT NULL,
    "level" TEXT,
    "unit" TEXT,
    "buildingName" TEXT,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'SINGAPORE',
    "fullAddress" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_charges" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chargeHolderId" TEXT,
    "chargeNumber" TEXT,
    "chargeType" TEXT,
    "description" TEXT,
    "chargeHolderName" TEXT NOT NULL,
    "amountSecured" DECIMAL(18,2),
    "amountSecuredText" TEXT,
    "currency" TEXT DEFAULT 'SGD',
    "registrationDate" TIMESTAMP(3),
    "dischargeDate" TIMESTAMP(3),
    "isFullyDischarged" BOOLEAN NOT NULL DEFAULT false,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isPoc" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "company_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_former_names" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "formerName" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_former_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_officers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "role" "public"."OfficerRole" NOT NULL,
    "name" TEXT NOT NULL,
    "identificationType" "public"."IdentificationType",
    "identificationNumber" TEXT,
    "nationality" TEXT,
    "address" TEXT,
    "appointmentDate" TIMESTAMP(3),
    "cessationDate" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_officers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_shareholders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "shareholderType" "public"."ContactType" NOT NULL DEFAULT 'INDIVIDUAL',
    "identificationType" "public"."IdentificationType",
    "identificationNumber" TEXT,
    "nationality" TEXT,
    "placeOfOrigin" TEXT,
    "address" TEXT,
    "shareClass" TEXT NOT NULL DEFAULT 'ORDINARY',
    "numberOfShares" INTEGER NOT NULL,
    "percentageHeld" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "allotmentDate" TIMESTAMP(3),
    "transferDate" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_shareholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connector_usage_logs" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "operation" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connectors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "type" "public"."ConnectorType" NOT NULL,
    "provider" "public"."ConnectorProvider" NOT NULL,
    "credentials" TEXT NOT NULL,
    "settings" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contact_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "detailType" "public"."ContactDetailType" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "purposes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isPoc" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contact_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactType" "public"."ContactType" NOT NULL DEFAULT 'INDIVIDUAL',
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT NOT NULL,
    "alias" TEXT,
    "identificationType" "public"."IdentificationType",
    "identificationNumber" TEXT,
    "nationality" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "corporateName" TEXT,
    "corporateUen" TEXT,
    "fullAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contract_services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" "public"."ServiceType" NOT NULL DEFAULT 'RECURRING',
    "status" "public"."ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "rate" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "frequency" "public"."BillingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "scope" TEXT,
    "autoRenewal" BOOLEAN NOT NULL DEFAULT false,
    "renewalPeriodMonths" INTEGER,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "serviceTemplateCode" TEXT,
    "gstFilingFrequency" "public"."GstFilingFrequency",
    "overrideBillable" BOOLEAN,
    "customRate" DECIMAL(18,2),
    "hasCustomDeadlines" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "fyeYearOverride" INTEGER,

    CONSTRAINT "contract_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contractType" "public"."ContractType" NOT NULL DEFAULT 'OTHER',
    "status" "public"."ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "signedDate" TIMESTAMP(3),
    "documentId" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_aliases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT,
    "raw_name" TEXT NOT NULL,
    "normalized_contact_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customer_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deadline_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractServiceId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "description" TEXT,
    "category" "public"."DeadlineCategory" NOT NULL,
    "ruleType" "public"."DeadlineRuleType" NOT NULL DEFAULT 'RULE_BASED',
    "anchorType" "public"."DeadlineAnchorType",
    "offsetMonths" INTEGER DEFAULT 0,
    "offsetDays" INTEGER DEFAULT 0,
    "offsetBusinessDays" BOOLEAN DEFAULT false,
    "fixedMonth" INTEGER,
    "fixedDay" INTEGER,
    "specificDate" TIMESTAMP(3),
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "public"."DeadlineFrequency",
    "generateUntilDate" TIMESTAMP(3),
    "generateOccurrences" INTEGER,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceTemplateCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deadline_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deadline_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "public"."DeadlineCategory" NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'SG',
    "description" TEXT,
    "entityTypes" JSONB,
    "excludeEntityTypes" JSONB,
    "requiresGstRegistered" BOOLEAN,
    "requiresAudit" BOOLEAN,
    "isTaxFiling" BOOLEAN NOT NULL DEFAULT false,
    "requiresCharityStatus" BOOLEAN,
    "requiresIPCStatus" BOOLEAN,
    "anchorType" "public"."DeadlineAnchorType" NOT NULL,
    "offsetMonths" INTEGER NOT NULL DEFAULT 0,
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "offsetBusinessDays" BOOLEAN NOT NULL DEFAULT false,
    "fixedMonth" INTEGER,
    "fixedDay" INTEGER,
    "frequency" "public"."DeadlineFrequency" NOT NULL,
    "generateMonthsAhead" INTEGER NOT NULL DEFAULT 18,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "optionalNote" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "defaultAmount" DECIMAL(18,2),
    "reminderDaysBefore" JSONB NOT NULL DEFAULT '[60, 30, 14, 7]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isUserCreated" BOOLEAN NOT NULL DEFAULT false,
    "basedOnTemplateCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadline_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deadlines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractServiceId" TEXT,
    "deadlineTemplateId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "public"."DeadlineCategory" NOT NULL,
    "referenceCode" TEXT,
    "periodLabel" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "statutoryDueDate" TIMESTAMP(3) NOT NULL,
    "extendedDueDate" TIMESTAMP(3),
    "internalDueDate" TIMESTAMP(3),
    "eotReference" TEXT,
    "eotNote" TEXT,
    "eotGrantedAt" TIMESTAMP(3),
    "isInScope" BOOLEAN NOT NULL DEFAULT true,
    "scopeNote" TEXT,
    "isBacklog" BOOLEAN NOT NULL DEFAULT false,
    "backlogNote" TEXT,
    "status" "public"."DeadlineStatus" NOT NULL DEFAULT 'UPCOMING',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completionNote" TEXT,
    "filingDate" TIMESTAMP(3),
    "filingReference" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "overrideBillable" BOOLEAN,
    "billingStatus" "public"."DeadlineBillingStatus",
    "amount" DECIMAL(18,2),
    "overrideAmount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "invoiceReference" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "generationType" "public"."DeadlineGenerationType" NOT NULL DEFAULT 'MANUAL',
    "remindersSent" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_comments" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "share_id" TEXT,
    "user_id" TEXT,
    "guest_name" VARCHAR(100),
    "guest_email" VARCHAR(255),
    "content" VARCHAR(1000) NOT NULL,
    "selection_start" INTEGER,
    "selection_end" INTEGER,
    "selected_text" TEXT,
    "parent_id" TEXT,
    "status" "public"."DocumentCommentStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "hidden_by_id" TEXT,
    "hidden_reason" VARCHAR(255),
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_derived_files" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" "public"."DerivedFileKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_derived_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_drafts" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_json" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_extractions" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "extraction_type" "public"."ExtractionType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "extraction_schema_version" TEXT NOT NULL,
    "input_fingerprint" TEXT,
    "selector_version" TEXT,
    "raw_json" JSONB NOT NULL,
    "raw_text" TEXT,
    "confidence_json" JSONB NOT NULL,
    "evidence_json" JSONB,
    "overall_confidence" DOUBLE PRECISION,
    "has_embedded_text" BOOLEAN NOT NULL DEFAULT false,
    "text_acquisition_json" JSONB,
    "ocr_provider" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "tokens_used" INTEGER,
    "latency_ms" INTEGER,
    "provider_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_links" (
    "id" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "target_document_id" TEXT NOT NULL,
    "link_type" "public"."DocumentLinkType" NOT NULL,
    "notes" TEXT,
    "linked_by_id" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_pages" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "render_dpi" INTEGER NOT NULL DEFAULT 200,
    "storage_key" TEXT NOT NULL,
    "image_fingerprint" TEXT,
    "width_px" INTEGER NOT NULL,
    "height_px" INTEGER NOT NULL,
    "rotation_deg" INTEGER NOT NULL DEFAULT 0,
    "ocr_provider" TEXT,
    "ocr_json" JSONB,
    "text_acquisition_decision" TEXT,
    "text_acquisition_signals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_revision_line_items" (
    "id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4),
    "unit_price" DECIMAL(18,4),
    "amount" DECIMAL(18,4) NOT NULL,
    "gst_amount" DECIMAL(18,4),
    "tax_code" TEXT,
    "account_code" TEXT,
    "evidence_json" JSONB,
    "home_amount" DECIMAL(18,4),
    "home_gst_amount" DECIMAL(18,4),
    "is_home_amount_override" BOOLEAN NOT NULL DEFAULT false,
    "is_home_gst_override" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "document_revision_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_revisions" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "based_on_revision_id" TEXT,
    "extraction_id" TEXT,
    "revision_number" INTEGER NOT NULL,
    "revision_type" "public"."RevisionType" NOT NULL,
    "status" "public"."RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "document_category" "public"."DocumentCategory" NOT NULL,
    "document_sub_category" "public"."DocumentSubCategory",
    "vendor_name" TEXT,
    "vendor_id" TEXT,
    "customer_name" TEXT,
    "customer_id" TEXT,
    "document_number" TEXT,
    "document_date" DATE,
    "due_date" DATE,
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(18,4),
    "tax_amount" DECIMAL(18,4),
    "total_amount" DECIMAL(18,4) NOT NULL,
    "rounding_mode" "public"."RoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "gst_treatment" "public"."GstTreatment",
    "supplier_gst_no" TEXT,
    "home_currency" TEXT,
    "home_exchange_rate_source" "public"."ExchangeRateSource",
    "home_exchange_rate" DECIMAL(18,8),
    "exchange_rate_date" DATE,
    "home_equivalent" DECIMAL(18,4),
    "home_subtotal" DECIMAL(18,4),
    "home_tax_amount" DECIMAL(18,4),
    "is_home_exchange_rate_override" BOOLEAN NOT NULL DEFAULT false,
    "validation_status" "public"."ValidationStatus" NOT NULL DEFAULT 'PENDING',
    "validation_issues" JSONB,
    "document_key" TEXT,
    "document_key_version" TEXT,
    "document_key_confidence" DOUBLE PRECISION,
    "header_evidence_json" JSONB,
    "posting_status" "public"."RevisionPostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "posted_at" TIMESTAMP(3),
    "posting_lock" BOOLEAN NOT NULL DEFAULT false,
    "reconciliation_status" "public"."RevisionReconciliationStatus" NOT NULL DEFAULT 'NOT_RECONCILED',
    "search_text" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_sections" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "anchor" VARCHAR(100) NOT NULL,
    "order" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "page_break_before" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_shares" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "share_token" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "password_hash" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "allowed_actions" TEXT[] DEFAULT ARRAY['view']::TEXT[],
    "allow_comments" BOOLEAN NOT NULL DEFAULT false,
    "comment_rate_limit" INTEGER NOT NULL DEFAULT 20,
    "notify_on_comment" BOOLEAN NOT NULL DEFAULT false,
    "notify_on_view" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "document_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_state_events" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "actor_user_id" TEXT,
    "actor_service_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_state_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT,
    "name" TEXT NOT NULL,
    "color" "public"."TagColor" NOT NULL DEFAULT 'GRAY',
    "description" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" "public"."DocumentTemplateCategory" NOT NULL DEFAULT 'OTHER',
    "content" TEXT NOT NULL,
    "content_json" JSONB,
    "placeholders" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_share_expiry_hours" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extractedAt" TIMESTAMP(3),
    "extractionStatus" TEXT DEFAULT 'PENDING',
    "extractionError" TEXT,
    "extractedData" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "previousVersionId" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_reason" TEXT,
    "deleted_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."duplicate_decisions" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "suspected_of_id" TEXT NOT NULL,
    "decision" "public"."DuplicateAction" NOT NULL,
    "reason" TEXT,
    "decided_by_id" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."exchange_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "source_currency" TEXT NOT NULL,
    "target_currency" TEXT NOT NULL DEFAULT 'SGD',
    "rate" DECIMAL(18,8) NOT NULL,
    "inverse_rate" DECIMAL(18,8),
    "rate_date" DATE NOT NULL,
    "rate_type" "public"."ExchangeRateType" NOT NULL,
    "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "manual_reason" TEXT,
    "created_by_id" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_ref" TEXT,
    "source_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."external_postings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_revision_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "external_id" TEXT,
    "external_type" TEXT,
    "external_url" TEXT,
    "status" "public"."PostingStatus" NOT NULL DEFAULT 'POSTING_PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),

    CONSTRAINT "external_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."field_mappings" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "source_field" TEXT NOT NULL,
    "target_field" TEXT NOT NULL,
    "transform_rule" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."generated_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "template_id" TEXT,
    "template_version" INTEGER,
    "company_id" TEXT,
    "title" VARCHAR(300) NOT NULL,
    "content" TEXT NOT NULL,
    "content_json" JSONB,
    "status" "public"."GeneratedDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "finalized_at" TIMESTAMP(3),
    "finalized_by_id" TEXT,
    "unfinalized_at" TIMESTAMP(3),
    "use_letterhead" BOOLEAN NOT NULL DEFAULT true,
    "share_expiry_hours" INTEGER,
    "placeholder_data" JSONB,
    "metadata" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."idempotency_records" (
    "key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "status_code" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."match_group_items" (
    "id" TEXT NOT NULL,
    "match_group_id" TEXT NOT NULL,
    "bank_transaction_id" TEXT,
    "document_revision_id" TEXT,
    "allocated_amount" DECIMAL(18,4),
    "allocation_currency" TEXT,

    CONSTRAINT "match_group_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."match_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "match_type" "public"."MatchType" NOT NULL,
    "match_method" "public"."MatchMethod" NOT NULL,
    "match_algorithm_version" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "match_reasons" JSONB NOT NULL,
    "status" "public"."MatchGroupStatus" NOT NULL DEFAULT 'MATCH_SUGGESTED',
    "fx_conversion_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,

    CONSTRAINT "match_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."note_tabs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'General',
    "content" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processing_attempts" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "step" "public"."ProcessingStep" NOT NULL,
    "status" "public"."AttemptStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "error_details" JSONB,
    "provider_latency_ms" INTEGER,
    "provider_request_id" TEXT,

    CONSTRAINT "processing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processing_checkpoints" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "step" "public"."ProcessingStep" NOT NULL,
    "status" "public"."CheckpointStatus" NOT NULL,
    "state_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processing_document_tags" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by_id" TEXT NOT NULL,

    CONSTRAINT "processing_document_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processing_documents" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "is_container" BOOLEAN NOT NULL DEFAULT false,
    "parent_processing_doc_id" TEXT,
    "page_from" INTEGER,
    "page_to" INTEGER,
    "page_count" INTEGER,
    "file_hash" TEXT,
    "perceptual_hash" TEXT,
    "is_encrypted_pdf" BOOLEAN NOT NULL DEFAULT false,
    "is_password_protected" BOOLEAN NOT NULL DEFAULT false,
    "content_type_detected" TEXT,
    "pipeline_status" "public"."PipelineStatus" NOT NULL DEFAULT 'UPLOADED',
    "processing_priority" "public"."ProcessingPriority" NOT NULL DEFAULT 'NORMAL',
    "sla_deadline" TIMESTAMP(3),
    "last_error" JSONB,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "first_error_at" TIMESTAMP(3),
    "can_retry" BOOLEAN NOT NULL DEFAULT true,
    "next_retry_at" TIMESTAMP(3),
    "dead_letter_at" TIMESTAMP(3),
    "duplicate_status" "public"."DuplicateStatus" NOT NULL DEFAULT 'NONE',
    "duplicate_of_id" TEXT,
    "duplicate_score" DOUBLE PRECISION,
    "duplicate_reason" TEXT,
    "root_document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "deleted_reason" TEXT,
    "current_revision_id" TEXT,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "locked_by_id" TEXT,
    "locked_at" TIMESTAMP(3),
    "lock_expires_at" TIMESTAMP(3),
    "upload_source" "public"."UploadSource" NOT NULL DEFAULT 'WEB',
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "retention_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reconciliation_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bank_account_id" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "public"."PeriodStatus" NOT NULL DEFAULT 'PERIOD_OPEN',
    "locked_by_id" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemRoleType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."share_capital" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shareClass" TEXT NOT NULL DEFAULT 'ORDINARY',
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "numberOfShares" INTEGER NOT NULL,
    "parValue" DECIMAL(18,4),
    "totalValue" DECIMAL(18,2) NOT NULL,
    "isPaidUp" BOOLEAN NOT NULL DEFAULT true,
    "isTreasury" BOOLEAN NOT NULL DEFAULT false,
    "effectiveDate" TIMESTAMP(3),
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_capital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."split_plans" (
    "id" TEXT NOT NULL,
    "processing_document_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "method" "public"."SplitMethod" NOT NULL,
    "schema_version" TEXT NOT NULL,
    "ranges_json" JSONB NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "split_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."template_partials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(200),
    "description" TEXT,
    "content" TEXT NOT NULL,
    "placeholders" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "template_partials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_backups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT,
    "backup_type" "public"."BackupType" NOT NULL DEFAULT 'MANUAL',
    "status" "public"."BackupStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT NOT NULL,
    "manifest_json" JSONB,
    "database_size_bytes" BIGINT NOT NULL DEFAULT 0,
    "files_size_bytes" BIGINT NOT NULL DEFAULT 0,
    "total_size_bytes" BIGINT NOT NULL DEFAULT 0,
    "files_count" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "current_step" TEXT,
    "error_message" TEXT,
    "error_details" JSONB,
    "restored_at" TIMESTAMP(3),
    "restored_by_id" TEXT,
    "retention_days" INTEGER,
    "expires_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_connector_access" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_connector_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_letterheads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "header_html" TEXT,
    "footer_html" TEXT,
    "header_image_url" VARCHAR(500),
    "footer_image_url" VARCHAR(500),
    "logo_url" VARCHAR(500),
    "page_margins" JSONB NOT NULL DEFAULT '{"top": 25, "left": 20, "right": 20, "bottom": 25}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_letterheads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "public"."TenantStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "settings" JSONB,
    "maxUsers" INTEGER NOT NULL DEFAULT 50,
    "maxCompanies" INTEGER NOT NULL DEFAULT 100,
    "maxStorageMb" INTEGER NOT NULL DEFAULT 10240,
    "logoUrl" TEXT,
    "primaryColor" TEXT DEFAULT '#294d44',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_company_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_company_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_role_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "tenantId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."vendor_aliases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT,
    "raw_name" TEXT NOT NULL,
    "normalized_contact_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vendor_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_delivery_at" TIMESTAMP(3),
    "last_delivery_status" TEXT,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_integrations_company_id_provider_key" ON "public"."accounting_integrations"("company_id" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "accounting_integrations_tenant_id_company_id_idx" ON "public"."accounting_integrations"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "ai_conversations_contextType_context_id_idx" ON "public"."ai_conversations"("contextType" ASC, "context_id" ASC);

-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_user_id_idx" ON "public"."ai_conversations"("tenant_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "public"."audit_logs"("action" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_companyId_idx" ON "public"."audit_logs"("companyId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "public"."audit_logs"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "public"."audit_logs"("entityType" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_requestId_idx" ON "public"."audit_logs"("requestId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "public"."audit_logs"("tenantId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_idx" ON "public"."audit_logs"("tenantId" ASC, "entityType" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "public"."audit_logs"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "public"."audit_logs"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "backup_schedules_tenant_id_key" ON "public"."backup_schedules"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "bank_accounts_company_id_idx" ON "public"."bank_accounts"("company_id" ASC);

-- CreateIndex
CREATE INDEX "bank_accounts_tenant_id_company_id_idx" ON "public"."bank_accounts"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_reconciliation_status_idx" ON "public"."bank_transactions"("bank_account_id" ASC, "reconciliation_status" ASC);

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_transaction_date_idx" ON "public"."bank_transactions"("bank_account_id" ASC, "transaction_date" ASC);

-- CreateIndex
CREATE INDEX "bank_transactions_external_id_idx" ON "public"."bank_transactions"("external_id" ASC);

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_bank_account_id_idx" ON "public"."bank_transactions"("tenant_id" ASC, "bank_account_id" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_account_type_idx" ON "public"."chart_of_accounts"("account_type" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_company_id_idx" ON "public"."chart_of_accounts"("company_id" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_deleted_at_idx" ON "public"."chart_of_accounts"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_parent_id_idx" ON "public"."chart_of_accounts"("parent_id" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_status_idx" ON "public"."chart_of_accounts"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_tenant_id_company_id_code_key" ON "public"."chart_of_accounts"("tenant_id" ASC, "company_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_tenant_id_company_id_status_deleted_at_idx" ON "public"."chart_of_accounts"("tenant_id" ASC, "company_id" ASC, "status" ASC, "deleted_at" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_tenant_id_idx" ON "public"."chart_of_accounts"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_mappings_account_id_company_id_provider_key" ON "public"."chart_of_accounts_mappings"("account_id" ASC, "company_id" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_mappings_account_id_idx" ON "public"."chart_of_accounts_mappings"("account_id" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_mappings_company_id_idx" ON "public"."chart_of_accounts_mappings"("company_id" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_mappings_company_id_provider_idx" ON "public"."chart_of_accounts_mappings"("company_id" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "chart_of_accounts_mappings_provider_idx" ON "public"."chart_of_accounts_mappings"("provider" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_users_company_id_email_key" ON "public"."client_portal_users"("company_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "client_portal_users_tenant_id_company_id_idx" ON "public"."client_portal_users"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "client_requests_company_id_status_idx" ON "public"."client_requests"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "client_requests_tenant_id_company_id_idx" ON "public"."client_requests"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "communications_client_request_id_idx" ON "public"."communications"("client_request_id" ASC);

-- CreateIndex
CREATE INDEX "communications_tenant_id_company_id_idx" ON "public"."communications"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "communications_thread_id_idx" ON "public"."communications"("thread_id" ASC);

-- CreateIndex
CREATE INDEX "companies_createdAt_idx" ON "public"."companies"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "companies_deletedAt_idx" ON "public"."companies"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "companies_entityType_idx" ON "public"."companies"("entityType" ASC);

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "public"."companies"("name" ASC);

-- CreateIndex
CREATE INDEX "companies_nextArDueDate_idx" ON "public"."companies"("nextArDueDate" ASC);

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "public"."companies"("status" ASC);

-- CreateIndex
CREATE INDEX "companies_status_nextArDueDate_idx" ON "public"."companies"("status" ASC, "nextArDueDate" ASC);

-- CreateIndex
CREATE INDEX "companies_tenantId_deletedAt_idx" ON "public"."companies"("tenantId" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE INDEX "companies_tenantId_idx" ON "public"."companies"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "companies_tenantId_status_idx" ON "public"."companies"("tenantId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenantId_uen_key" ON "public"."companies"("tenantId" ASC, "uen" ASC);

-- CreateIndex
CREATE INDEX "companies_uen_idx" ON "public"."companies"("uen" ASC);

-- CreateIndex
CREATE INDEX "company_addresses_addressType_idx" ON "public"."company_addresses"("addressType" ASC);

-- CreateIndex
CREATE INDEX "company_addresses_companyId_idx" ON "public"."company_addresses"("companyId" ASC);

-- CreateIndex
CREATE INDEX "company_addresses_companyId_isCurrent_addressType_idx" ON "public"."company_addresses"("companyId" ASC, "isCurrent" ASC, "addressType" ASC);

-- CreateIndex
CREATE INDEX "company_addresses_companyId_isCurrent_idx" ON "public"."company_addresses"("companyId" ASC, "isCurrent" ASC);

-- CreateIndex
CREATE INDEX "company_addresses_isCurrent_idx" ON "public"."company_addresses"("isCurrent" ASC);

-- CreateIndex
CREATE INDEX "company_charges_chargeHolderId_idx" ON "public"."company_charges"("chargeHolderId" ASC);

-- CreateIndex
CREATE INDEX "company_charges_companyId_idx" ON "public"."company_charges"("companyId" ASC);

-- CreateIndex
CREATE INDEX "company_charges_companyId_isFullyDischarged_registrationDat_idx" ON "public"."company_charges"("companyId" ASC, "isFullyDischarged" ASC, "registrationDate" ASC);

-- CreateIndex
CREATE INDEX "company_charges_isFullyDischarged_idx" ON "public"."company_charges"("isFullyDischarged" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_contacts_companyId_contactId_relationship_key" ON "public"."company_contacts"("companyId" ASC, "contactId" ASC, "relationship" ASC);

-- CreateIndex
CREATE INDEX "company_contacts_companyId_idx" ON "public"."company_contacts"("companyId" ASC);

-- CreateIndex
CREATE INDEX "company_contacts_contactId_idx" ON "public"."company_contacts"("contactId" ASC);

-- CreateIndex
CREATE INDEX "company_contacts_deletedAt_idx" ON "public"."company_contacts"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "company_former_names_companyId_idx" ON "public"."company_former_names"("companyId" ASC);

-- CreateIndex
CREATE INDEX "company_officers_companyId_idx" ON "public"."company_officers"("companyId" ASC);

-- CreateIndex
CREATE INDEX "company_officers_companyId_isCurrent_appointmentDate_idx" ON "public"."company_officers"("companyId" ASC, "isCurrent" ASC, "appointmentDate" ASC);

-- CreateIndex
CREATE INDEX "company_officers_companyId_isCurrent_idx" ON "public"."company_officers"("companyId" ASC, "isCurrent" ASC);

-- CreateIndex
CREATE INDEX "company_officers_contactId_companyId_idx" ON "public"."company_officers"("contactId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "company_officers_contactId_idx" ON "public"."company_officers"("contactId" ASC);

-- CreateIndex
CREATE INDEX "company_officers_isCurrent_idx" ON "public"."company_officers"("isCurrent" ASC);

-- CreateIndex
CREATE INDEX "company_officers_name_isCurrent_idx" ON "public"."company_officers"("name" ASC, "isCurrent" ASC);

-- CreateIndex
CREATE INDEX "company_officers_role_idx" ON "public"."company_officers"("role" ASC);

-- CreateIndex
CREATE INDEX "company_shareholders_companyId_idx" ON "public"."company_shareholders"("companyId" ASC);

-- CreateIndex
CREATE INDEX "company_shareholders_companyId_isCurrent_idx" ON "public"."company_shareholders"("companyId" ASC, "isCurrent" ASC);

-- CreateIndex
CREATE INDEX "company_shareholders_companyId_isCurrent_numberOfShares_idx" ON "public"."company_shareholders"("companyId" ASC, "isCurrent" ASC, "numberOfShares" ASC);

-- CreateIndex
CREATE INDEX "company_shareholders_contactId_companyId_idx" ON "public"."company_shareholders"("contactId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "company_shareholders_contactId_idx" ON "public"."company_shareholders"("contactId" ASC);

-- CreateIndex
CREATE INDEX "company_shareholders_isCurrent_idx" ON "public"."company_shareholders"("isCurrent" ASC);

-- CreateIndex
CREATE INDEX "company_shareholders_name_isCurrent_idx" ON "public"."company_shareholders"("name" ASC, "isCurrent" ASC);

-- CreateIndex
CREATE INDEX "connector_usage_logs_connectorId_createdAt_idx" ON "public"."connector_usage_logs"("connectorId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "connector_usage_logs_connectorId_idx" ON "public"."connector_usage_logs"("connectorId" ASC);

-- CreateIndex
CREATE INDEX "connector_usage_logs_createdAt_idx" ON "public"."connector_usage_logs"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "connector_usage_logs_tenantId_createdAt_idx" ON "public"."connector_usage_logs"("tenantId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "connector_usage_logs_tenantId_idx" ON "public"."connector_usage_logs"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "connector_usage_logs_userId_idx" ON "public"."connector_usage_logs"("userId" ASC);

-- CreateIndex
CREATE INDEX "connectors_deletedAt_idx" ON "public"."connectors"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "connectors_isEnabled_idx" ON "public"."connectors"("isEnabled" ASC);

-- CreateIndex
CREATE INDEX "connectors_provider_idx" ON "public"."connectors"("provider" ASC);

-- CreateIndex
CREATE INDEX "connectors_tenantId_idx" ON "public"."connectors"("tenantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "connectors_tenantId_provider_deletedAt_key" ON "public"."connectors"("tenantId" ASC, "provider" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE INDEX "connectors_type_idx" ON "public"."connectors"("type" ASC);

-- CreateIndex
CREATE INDEX "contact_details_companyId_idx" ON "public"."contact_details"("companyId" ASC);

-- CreateIndex
CREATE INDEX "contact_details_contactId_idx" ON "public"."contact_details"("contactId" ASC);

-- CreateIndex
CREATE INDEX "contact_details_detailType_idx" ON "public"."contact_details"("detailType" ASC);

-- CreateIndex
CREATE INDEX "contact_details_tenantId_companyId_idx" ON "public"."contact_details"("tenantId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "contact_details_tenantId_contactId_idx" ON "public"."contact_details"("tenantId" ASC, "contactId" ASC);

-- CreateIndex
CREATE INDEX "contact_details_tenantId_deletedAt_idx" ON "public"."contact_details"("tenantId" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE INDEX "contact_details_tenantId_idx" ON "public"."contact_details"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "contacts_corporateUen_idx" ON "public"."contacts"("corporateUen" ASC);

-- CreateIndex
CREATE INDEX "contacts_fullName_idx" ON "public"."contacts"("fullName" ASC);

-- CreateIndex
CREATE INDEX "contacts_identificationNumber_idx" ON "public"."contacts"("identificationNumber" ASC);

-- CreateIndex
CREATE INDEX "contacts_tenantId_deletedAt_idx" ON "public"."contacts"("tenantId" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenantId_identificationType_identificationNumber_key" ON "public"."contacts"("tenantId" ASC, "identificationType" ASC, "identificationNumber" ASC);

-- CreateIndex
CREATE INDEX "contacts_tenantId_idx" ON "public"."contacts"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "contract_services_contractId_idx" ON "public"."contract_services"("contractId" ASC);

-- CreateIndex
CREATE INDEX "contract_services_endDate_idx" ON "public"."contract_services"("endDate" ASC);

-- CreateIndex
CREATE INDEX "contract_services_status_idx" ON "public"."contract_services"("status" ASC);

-- CreateIndex
CREATE INDEX "contract_services_tenantId_contractId_idx" ON "public"."contract_services"("tenantId" ASC, "contractId" ASC);

-- CreateIndex
CREATE INDEX "contract_services_tenantId_deletedAt_idx" ON "public"."contract_services"("tenantId" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE INDEX "contract_services_tenantId_idx" ON "public"."contract_services"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "contracts_companyId_idx" ON "public"."contracts"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_documentId_key" ON "public"."contracts"("documentId" ASC);

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "public"."contracts"("status" ASC);

-- CreateIndex
CREATE INDEX "contracts_tenantId_companyId_idx" ON "public"."contracts"("tenantId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "contracts_tenantId_deletedAt_idx" ON "public"."contracts"("tenantId" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE INDEX "contracts_tenantId_idx" ON "public"."contracts"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "customer_aliases_company_id_raw_name_idx" ON "public"."customer_aliases"("company_id" ASC, "raw_name" ASC);

-- CreateIndex
CREATE INDEX "customer_aliases_tenant_id_company_id_idx" ON "public"."customer_aliases"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "customer_aliases_tenant_id_raw_name_idx" ON "public"."customer_aliases"("tenant_id" ASC, "raw_name" ASC);

-- CreateIndex
CREATE INDEX "deadline_rules_contractServiceId_idx" ON "public"."deadline_rules"("contractServiceId" ASC);

-- CreateIndex
CREATE INDEX "deadline_rules_tenantId_contractServiceId_idx" ON "public"."deadline_rules"("tenantId" ASC, "contractServiceId" ASC);

-- CreateIndex
CREATE INDEX "deadline_rules_tenantId_idx" ON "public"."deadline_rules"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "deadline_templates_category_idx" ON "public"."deadline_templates"("category" ASC);

-- CreateIndex
CREATE INDEX "deadline_templates_code_idx" ON "public"."deadline_templates"("code" ASC);

-- CreateIndex
CREATE INDEX "deadline_templates_isActive_idx" ON "public"."deadline_templates"("isActive" ASC);

-- CreateIndex
CREATE INDEX "deadline_templates_jurisdiction_idx" ON "public"."deadline_templates"("jurisdiction" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "deadline_templates_tenantId_code_jurisdiction_key" ON "public"."deadline_templates"("tenantId" ASC, "code" ASC, "jurisdiction" ASC);

-- CreateIndex
CREATE INDEX "deadline_templates_tenantId_idx" ON "public"."deadline_templates"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "deadlines_assigneeId_idx" ON "public"."deadlines"("assigneeId" ASC);

-- CreateIndex
CREATE INDEX "deadlines_billingStatus_idx" ON "public"."deadlines"("billingStatus" ASC);

-- CreateIndex
CREATE INDEX "deadlines_category_idx" ON "public"."deadlines"("category" ASC);

-- CreateIndex
CREATE INDEX "deadlines_companyId_idx" ON "public"."deadlines"("companyId" ASC);

-- CreateIndex
CREATE INDEX "deadlines_companyId_status_idx" ON "public"."deadlines"("companyId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "deadlines_contractServiceId_idx" ON "public"."deadlines"("contractServiceId" ASC);

-- CreateIndex
CREATE INDEX "deadlines_deadlineTemplateId_idx" ON "public"."deadlines"("deadlineTemplateId" ASC);

-- CreateIndex
CREATE INDEX "deadlines_extendedDueDate_idx" ON "public"."deadlines"("extendedDueDate" ASC);

-- CreateIndex
CREATE INDEX "deadlines_isBacklog_idx" ON "public"."deadlines"("isBacklog" ASC);

-- CreateIndex
CREATE INDEX "deadlines_isInScope_idx" ON "public"."deadlines"("isInScope" ASC);

-- CreateIndex
CREATE INDEX "deadlines_status_idx" ON "public"."deadlines"("status" ASC);

-- CreateIndex
CREATE INDEX "deadlines_statutoryDueDate_idx" ON "public"."deadlines"("statutoryDueDate" ASC);

-- CreateIndex
CREATE INDEX "deadlines_tenantId_assigneeId_idx" ON "public"."deadlines"("tenantId" ASC, "assigneeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "deadlines_tenantId_companyId_deadlineTemplateId_periodLabel_key" ON "public"."deadlines"("tenantId" ASC, "companyId" ASC, "deadlineTemplateId" ASC, "periodLabel" ASC);

-- CreateIndex
CREATE INDEX "deadlines_tenantId_companyId_idx" ON "public"."deadlines"("tenantId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "deadlines_tenantId_deletedAt_idx" ON "public"."deadlines"("tenantId" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE INDEX "deadlines_tenantId_idx" ON "public"."deadlines"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "deadlines_tenantId_status_idx" ON "public"."deadlines"("tenantId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "document_comments_document_id_idx" ON "public"."document_comments"("document_id" ASC);

-- CreateIndex
CREATE INDEX "document_comments_ip_address_created_at_idx" ON "public"."document_comments"("ip_address" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "document_comments_parent_id_idx" ON "public"."document_comments"("parent_id" ASC);

-- CreateIndex
CREATE INDEX "document_comments_share_id_idx" ON "public"."document_comments"("share_id" ASC);

-- CreateIndex
CREATE INDEX "document_comments_status_idx" ON "public"."document_comments"("status" ASC);

-- CreateIndex
CREATE INDEX "document_comments_user_id_idx" ON "public"."document_comments"("user_id" ASC);

-- CreateIndex
CREATE INDEX "document_derived_files_processing_document_id_kind_idx" ON "public"."document_derived_files"("processing_document_id" ASC, "kind" ASC);

-- CreateIndex
CREATE INDEX "document_derived_files_tenant_id_company_id_created_at_idx" ON "public"."document_derived_files"("tenant_id" ASC, "company_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "document_drafts_document_id_idx" ON "public"."document_drafts"("document_id" ASC);

-- CreateIndex
CREATE INDEX "document_drafts_user_id_created_at_idx" ON "public"."document_drafts"("user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "document_extractions_processing_document_id_extraction_type_idx" ON "public"."document_extractions"("processing_document_id" ASC, "extraction_type" ASC);

-- CreateIndex
CREATE INDEX "document_extractions_provider_request_id_idx" ON "public"."document_extractions"("provider_request_id" ASC);

-- CreateIndex
CREATE INDEX "document_links_source_document_id_idx" ON "public"."document_links"("source_document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_links_source_document_id_target_document_id_link_t_key" ON "public"."document_links"("source_document_id" ASC, "target_document_id" ASC, "link_type" ASC);

-- CreateIndex
CREATE INDEX "document_links_target_document_id_idx" ON "public"."document_links"("target_document_id" ASC);

-- CreateIndex
CREATE INDEX "document_pages_processing_document_id_idx" ON "public"."document_pages"("processing_document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_processing_document_id_page_number_key" ON "public"."document_pages"("processing_document_id" ASC, "page_number" ASC);

-- CreateIndex
CREATE INDEX "document_revision_line_items_revision_id_idx" ON "public"."document_revision_line_items"("revision_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_revision_line_items_revision_id_line_no_key" ON "public"."document_revision_line_items"("revision_id" ASC, "line_no" ASC);

-- CreateIndex
CREATE INDEX "document_revisions_customer_id_idx" ON "public"."document_revisions"("customer_id" ASC);

-- CreateIndex
CREATE INDEX "document_revisions_document_date_idx" ON "public"."document_revisions"("document_date" ASC);

-- CreateIndex
CREATE INDEX "document_revisions_document_key_idx" ON "public"."document_revisions"("document_key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_revisions_processing_document_id_revision_number_key" ON "public"."document_revisions"("processing_document_id" ASC, "revision_number" ASC);

-- CreateIndex
CREATE INDEX "document_revisions_processing_document_id_status_idx" ON "public"."document_revisions"("processing_document_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "document_revisions_vendor_id_idx" ON "public"."document_revisions"("vendor_id" ASC);

-- CreateIndex
CREATE INDEX "document_sections_document_id_idx" ON "public"."document_sections"("document_id" ASC);

-- CreateIndex
CREATE INDEX "document_sections_document_id_order_idx" ON "public"."document_sections"("document_id" ASC, "order" ASC);

-- CreateIndex
CREATE INDEX "document_shares_document_id_idx" ON "public"."document_shares"("document_id" ASC);

-- CreateIndex
CREATE INDEX "document_shares_expires_at_idx" ON "public"."document_shares"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "document_shares_share_token_idx" ON "public"."document_shares"("share_token" ASC);

-- CreateIndex
CREATE INDEX "document_shares_share_token_is_active_idx" ON "public"."document_shares"("share_token" ASC, "is_active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_shares_share_token_key" ON "public"."document_shares"("share_token" ASC);

-- CreateIndex
CREATE INDEX "document_state_events_processing_document_id_created_at_idx" ON "public"."document_state_events"("processing_document_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "document_state_events_tenant_id_company_id_created_at_idx" ON "public"."document_state_events"("tenant_id" ASC, "company_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "document_tags_company_id_last_used_at_idx" ON "public"."document_tags"("company_id" ASC, "last_used_at" ASC);

-- CreateIndex
CREATE INDEX "document_tags_tenant_id_company_id_idx" ON "public"."document_tags"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_tags_tenant_id_company_id_name_deleted_at_key" ON "public"."document_tags"("tenant_id" ASC, "company_id" ASC, "name" ASC, "deleted_at" ASC);

-- CreateIndex
CREATE INDEX "document_tags_tenant_id_deleted_at_idx" ON "public"."document_tags"("tenant_id" ASC, "deleted_at" ASC);

-- CreateIndex
CREATE INDEX "document_templates_category_idx" ON "public"."document_templates"("category" ASC);

-- CreateIndex
CREATE INDEX "document_templates_is_active_idx" ON "public"."document_templates"("is_active" ASC);

-- CreateIndex
CREATE INDEX "document_templates_tenant_id_deleted_at_idx" ON "public"."document_templates"("tenant_id" ASC, "deleted_at" ASC);

-- CreateIndex
CREATE INDEX "document_templates_tenant_id_idx" ON "public"."document_templates"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "documents_companyId_idx" ON "public"."documents"("companyId" ASC);

-- CreateIndex
CREATE INDEX "documents_companyId_isLatest_createdAt_idx" ON "public"."documents"("companyId" ASC, "isLatest" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "documents_documentType_idx" ON "public"."documents"("documentType" ASC);

-- CreateIndex
CREATE INDEX "documents_tenantId_companyId_idx" ON "public"."documents"("tenantId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "documents_tenantId_deleted_at_idx" ON "public"."documents"("tenantId" ASC, "deleted_at" ASC);

-- CreateIndex
CREATE INDEX "documents_tenantId_idx" ON "public"."documents"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "documents_uploadedById_idx" ON "public"."documents"("uploadedById" ASC);

-- CreateIndex
CREATE INDEX "duplicate_decisions_processing_document_id_idx" ON "public"."duplicate_decisions"("processing_document_id" ASC);

-- CreateIndex
CREATE INDEX "duplicate_decisions_suspected_of_id_idx" ON "public"."duplicate_decisions"("suspected_of_id" ASC);

-- CreateIndex
CREATE INDEX "exchange_rates_rate_date_idx" ON "public"."exchange_rates"("rate_date" ASC);

-- CreateIndex
CREATE INDEX "exchange_rates_source_currency_rate_date_idx" ON "public"."exchange_rates"("source_currency" ASC, "rate_date" ASC);

-- CreateIndex
CREATE INDEX "exchange_rates_source_currency_target_currency_rate_date_idx" ON "public"."exchange_rates"("source_currency" ASC, "target_currency" ASC, "rate_date" ASC);

-- CreateIndex
CREATE INDEX "exchange_rates_tenant_id_idx" ON "public"."exchange_rates"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_tenant_id_source_currency_target_currency_ra_key" ON "public"."exchange_rates"("tenant_id" ASC, "source_currency" ASC, "target_currency" ASC, "rate_date" ASC, "rate_type" ASC);

-- CreateIndex
CREATE INDEX "external_postings_document_revision_id_idx" ON "public"."external_postings"("document_revision_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "external_postings_idempotency_key_key" ON "public"."external_postings"("idempotency_key" ASC);

-- CreateIndex
CREATE INDEX "external_postings_integration_id_status_idx" ON "public"."external_postings"("integration_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "external_postings_tenant_id_status_idx" ON "public"."external_postings"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "field_mappings_integration_id_idx" ON "public"."field_mappings"("integration_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "field_mappings_integration_id_source_field_target_field_key" ON "public"."field_mappings"("integration_id" ASC, "source_field" ASC, "target_field" ASC);

-- CreateIndex
CREATE INDEX "generated_documents_company_id_idx" ON "public"."generated_documents"("company_id" ASC);

-- CreateIndex
CREATE INDEX "generated_documents_created_by_id_idx" ON "public"."generated_documents"("created_by_id" ASC);

-- CreateIndex
CREATE INDEX "generated_documents_status_idx" ON "public"."generated_documents"("status" ASC);

-- CreateIndex
CREATE INDEX "generated_documents_template_id_idx" ON "public"."generated_documents"("template_id" ASC);

-- CreateIndex
CREATE INDEX "generated_documents_tenant_id_deleted_at_idx" ON "public"."generated_documents"("tenant_id" ASC, "deleted_at" ASC);

-- CreateIndex
CREATE INDEX "generated_documents_tenant_id_idx" ON "public"."generated_documents"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "public"."idempotency_records"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idempotency_records_tenant_id_idx" ON "public"."idempotency_records"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "match_group_items_bank_transaction_id_idx" ON "public"."match_group_items"("bank_transaction_id" ASC);

-- CreateIndex
CREATE INDEX "match_group_items_document_revision_id_idx" ON "public"."match_group_items"("document_revision_id" ASC);

-- CreateIndex
CREATE INDEX "match_group_items_match_group_id_idx" ON "public"."match_group_items"("match_group_id" ASC);

-- CreateIndex
CREATE INDEX "match_groups_company_id_status_idx" ON "public"."match_groups"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "match_groups_tenant_id_company_id_idx" ON "public"."match_groups"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "note_tabs_companyId_idx" ON "public"."note_tabs"("companyId" ASC);

-- CreateIndex
CREATE INDEX "note_tabs_contactId_idx" ON "public"."note_tabs"("contactId" ASC);

-- CreateIndex
CREATE INDEX "note_tabs_order_idx" ON "public"."note_tabs"("order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resource_action_key" ON "public"."permissions"("resource" ASC, "action" ASC);

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "public"."permissions"("resource" ASC);

-- CreateIndex
CREATE INDEX "processing_attempts_processing_document_id_attempt_number_idx" ON "public"."processing_attempts"("processing_document_id" ASC, "attempt_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "processing_attempts_processing_document_id_attempt_number_s_key" ON "public"."processing_attempts"("processing_document_id" ASC, "attempt_number" ASC, "step" ASC);

-- CreateIndex
CREATE INDEX "processing_attempts_status_completed_at_idx" ON "public"."processing_attempts"("status" ASC, "completed_at" ASC);

-- CreateIndex
CREATE INDEX "processing_checkpoints_processing_document_id_idx" ON "public"."processing_checkpoints"("processing_document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "processing_checkpoints_processing_document_id_step_key" ON "public"."processing_checkpoints"("processing_document_id" ASC, "step" ASC);

-- CreateIndex
CREATE INDEX "processing_document_tags_processing_document_id_idx" ON "public"."processing_document_tags"("processing_document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "processing_document_tags_processing_document_id_tag_id_key" ON "public"."processing_document_tags"("processing_document_id" ASC, "tag_id" ASC);

-- CreateIndex
CREATE INDEX "processing_document_tags_tag_id_idx" ON "public"."processing_document_tags"("tag_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "processing_documents_current_revision_id_key" ON "public"."processing_documents"("current_revision_id" ASC);

-- CreateIndex
CREATE INDEX "processing_documents_document_id_idx" ON "public"."processing_documents"("document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "processing_documents_document_id_key" ON "public"."processing_documents"("document_id" ASC);

-- CreateIndex
CREATE INDEX "processing_documents_duplicate_of_id_idx" ON "public"."processing_documents"("duplicate_of_id" ASC);

-- CreateIndex
CREATE INDEX "processing_documents_file_hash_idx" ON "public"."processing_documents"("file_hash" ASC);

-- CreateIndex
CREATE INDEX "processing_documents_parent_processing_doc_id_idx" ON "public"."processing_documents"("parent_processing_doc_id" ASC);

-- CreateIndex
CREATE INDEX "processing_documents_pipeline_status_idx" ON "public"."processing_documents"("pipeline_status" ASC);

-- CreateIndex
CREATE INDEX "processing_documents_pipeline_status_next_retry_at_idx" ON "public"."processing_documents"("pipeline_status" ASC, "next_retry_at" ASC);

-- CreateIndex
CREATE INDEX "processing_documents_root_document_id_idx" ON "public"."processing_documents"("root_document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_periods_company_id_bank_account_id_period_st_key" ON "public"."reconciliation_periods"("company_id" ASC, "bank_account_id" ASC, "period_start" ASC, "period_end" ASC);

-- CreateIndex
CREATE INDEX "reconciliation_periods_company_id_status_idx" ON "public"."reconciliation_periods"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "reconciliation_periods_tenant_id_company_id_idx" ON "public"."reconciliation_periods"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "public"."role_permissions"("permissionId" ASC);

-- CreateIndex
CREATE INDEX "role_permissions_roleId_idx" ON "public"."role_permissions"("roleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "public"."role_permissions"("roleId" ASC, "permissionId" ASC);

-- CreateIndex
CREATE INDEX "roles_systemRoleType_idx" ON "public"."roles"("systemRoleType" ASC);

-- CreateIndex
CREATE INDEX "roles_tenantId_idx" ON "public"."roles"("tenantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_name_key" ON "public"."roles"("tenantId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "share_capital_companyId_idx" ON "public"."share_capital"("companyId" ASC);

-- CreateIndex
CREATE INDEX "split_plans_processing_document_id_created_at_idx" ON "public"."split_plans"("processing_document_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "template_partials_tenant_id_idx" ON "public"."template_partials"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "template_partials_tenant_id_name_key" ON "public"."template_partials"("tenant_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "tenant_backups_created_at_idx" ON "public"."tenant_backups"("created_at" ASC);

-- CreateIndex
CREATE INDEX "tenant_backups_expires_at_idx" ON "public"."tenant_backups"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "tenant_backups_status_idx" ON "public"."tenant_backups"("status" ASC);

-- CreateIndex
CREATE INDEX "tenant_backups_tenant_id_created_at_idx" ON "public"."tenant_backups"("tenant_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "tenant_backups_tenant_id_idx" ON "public"."tenant_backups"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "tenant_connector_access_connectorId_idx" ON "public"."tenant_connector_access"("connectorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_connector_access_tenantId_connectorId_key" ON "public"."tenant_connector_access"("tenantId" ASC, "connectorId" ASC);

-- CreateIndex
CREATE INDEX "tenant_connector_access_tenantId_idx" ON "public"."tenant_connector_access"("tenantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_letterheads_tenant_id_key" ON "public"."tenant_letterheads"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "tenants_deletedAt_idx" ON "public"."tenants"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "tenants_slug_idx" ON "public"."tenants"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "public"."tenants"("slug" ASC);

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "public"."tenants"("status" ASC);

-- CreateIndex
CREATE INDEX "user_company_assignments_companyId_idx" ON "public"."user_company_assignments"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_company_assignments_userId_companyId_key" ON "public"."user_company_assignments"("userId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "user_company_assignments_userId_idx" ON "public"."user_company_assignments"("userId" ASC);

-- CreateIndex
CREATE INDEX "user_preferences_user_id_idx" ON "public"."user_preferences"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key_key" ON "public"."user_preferences"("user_id" ASC, "key" ASC);

-- CreateIndex
CREATE INDEX "user_role_assignments_companyId_idx" ON "public"."user_role_assignments"("companyId" ASC);

-- CreateIndex
CREATE INDEX "user_role_assignments_roleId_idx" ON "public"."user_role_assignments"("roleId" ASC);

-- CreateIndex
CREATE INDEX "user_role_assignments_userId_idx" ON "public"."user_role_assignments"("userId" ASC);

-- CreateIndex
CREATE INDEX "user_role_assignments_userId_roleId_companyId_idx" ON "public"."user_role_assignments"("userId" ASC, "roleId" ASC, "companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_role_assignments_userId_roleId_companyId_key" ON "public"."user_role_assignments"("userId" ASC, "roleId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "users_deletedAt_isActive_idx" ON "public"."users"("deletedAt" ASC, "isActive" ASC);

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "users_passwordResetToken_idx" ON "public"."users"("passwordResetToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_passwordResetToken_key" ON "public"."users"("passwordResetToken" ASC);

-- CreateIndex
CREATE INDEX "users_tenantId_deletedAt_isActive_idx" ON "public"."users"("tenantId" ASC, "deletedAt" ASC, "isActive" ASC);

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "public"."users"("tenantId" ASC);

-- CreateIndex
CREATE INDEX "vendor_aliases_company_id_raw_name_idx" ON "public"."vendor_aliases"("company_id" ASC, "raw_name" ASC);

-- CreateIndex
CREATE INDEX "vendor_aliases_tenant_id_company_id_idx" ON "public"."vendor_aliases"("tenant_id" ASC, "company_id" ASC);

-- CreateIndex
CREATE INDEX "vendor_aliases_tenant_id_raw_name_idx" ON "public"."vendor_aliases"("tenant_id" ASC, "raw_name" ASC);

-- CreateIndex
CREATE INDEX "webhook_subscriptions_is_active_idx" ON "public"."webhook_subscriptions"("is_active" ASC);

-- CreateIndex
CREATE INDEX "webhook_subscriptions_tenant_id_idx" ON "public"."webhook_subscriptions"("tenant_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."backup_schedules" ADD CONSTRAINT "backup_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chart_of_accounts_mappings" ADD CONSTRAINT "chart_of_accounts_mappings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chart_of_accounts_mappings" ADD CONSTRAINT "chart_of_accounts_mappings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."communications" ADD CONSTRAINT "communications_client_request_id_fkey" FOREIGN KEY ("client_request_id") REFERENCES "public"."client_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."communications" ADD CONSTRAINT "communications_from_client_user_id_fkey" FOREIGN KEY ("from_client_user_id") REFERENCES "public"."client_portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_addresses" ADD CONSTRAINT "company_addresses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_addresses" ADD CONSTRAINT "company_addresses_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_charges" ADD CONSTRAINT "company_charges_chargeHolderId_fkey" FOREIGN KEY ("chargeHolderId") REFERENCES "public"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_charges" ADD CONSTRAINT "company_charges_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_charges" ADD CONSTRAINT "company_charges_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_contacts" ADD CONSTRAINT "company_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_contacts" ADD CONSTRAINT "company_contacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_former_names" ADD CONSTRAINT "company_former_names_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_former_names" ADD CONSTRAINT "company_former_names_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_officers" ADD CONSTRAINT "company_officers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_officers" ADD CONSTRAINT "company_officers_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_officers" ADD CONSTRAINT "company_officers_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_shareholders" ADD CONSTRAINT "company_shareholders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_shareholders" ADD CONSTRAINT "company_shareholders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_shareholders" ADD CONSTRAINT "company_shareholders_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_usage_logs" ADD CONSTRAINT "connector_usage_logs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "public"."connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_usage_logs" ADD CONSTRAINT "connector_usage_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_usage_logs" ADD CONSTRAINT "connector_usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connectors" ADD CONSTRAINT "connectors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_details" ADD CONSTRAINT "contact_details_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_details" ADD CONSTRAINT "contact_details_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_details" ADD CONSTRAINT "contact_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contract_services" ADD CONSTRAINT "contract_services_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contract_services" ADD CONSTRAINT "contract_services_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contracts" ADD CONSTRAINT "contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contracts" ADD CONSTRAINT "contracts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contracts" ADD CONSTRAINT "contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadline_rules" ADD CONSTRAINT "deadline_rules_contractServiceId_fkey" FOREIGN KEY ("contractServiceId") REFERENCES "public"."contract_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadline_rules" ADD CONSTRAINT "deadline_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadline_templates" ADD CONSTRAINT "deadline_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadlines" ADD CONSTRAINT "deadlines_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadlines" ADD CONSTRAINT "deadlines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadlines" ADD CONSTRAINT "deadlines_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadlines" ADD CONSTRAINT "deadlines_contractServiceId_fkey" FOREIGN KEY ("contractServiceId") REFERENCES "public"."contract_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadlines" ADD CONSTRAINT "deadlines_deadlineTemplateId_fkey" FOREIGN KEY ("deadlineTemplateId") REFERENCES "public"."deadline_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadlines" ADD CONSTRAINT "deadlines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_comments" ADD CONSTRAINT "document_comments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_comments" ADD CONSTRAINT "document_comments_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_comments" ADD CONSTRAINT "document_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."document_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_comments" ADD CONSTRAINT "document_comments_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_comments" ADD CONSTRAINT "document_comments_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "public"."document_shares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_comments" ADD CONSTRAINT "document_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_derived_files" ADD CONSTRAINT "document_derived_files_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_drafts" ADD CONSTRAINT "document_drafts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_drafts" ADD CONSTRAINT "document_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_extractions" ADD CONSTRAINT "document_extractions_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_links" ADD CONSTRAINT "document_links_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_links" ADD CONSTRAINT "document_links_target_document_id_fkey" FOREIGN KEY ("target_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_pages" ADD CONSTRAINT "document_pages_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_revision_line_items" ADD CONSTRAINT "document_revision_line_items_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_revisions" ADD CONSTRAINT "document_revisions_based_on_revision_id_fkey" FOREIGN KEY ("based_on_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_revisions" ADD CONSTRAINT "document_revisions_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "public"."document_extractions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_revisions" ADD CONSTRAINT "document_revisions_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_sections" ADD CONSTRAINT "document_sections_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_shares" ADD CONSTRAINT "document_shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_shares" ADD CONSTRAINT "document_shares_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_state_events" ADD CONSTRAINT "document_state_events_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_tags" ADD CONSTRAINT "document_tags_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_templates" ADD CONSTRAINT "document_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_templates" ADD CONSTRAINT "document_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."duplicate_decisions" ADD CONSTRAINT "duplicate_decisions_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."external_postings" ADD CONSTRAINT "external_postings_document_revision_id_fkey" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."external_postings" ADD CONSTRAINT "external_postings_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."accounting_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."field_mappings" ADD CONSTRAINT "field_mappings_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."accounting_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."generated_documents" ADD CONSTRAINT "generated_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."generated_documents" ADD CONSTRAINT "generated_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."generated_documents" ADD CONSTRAINT "generated_documents_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."generated_documents" ADD CONSTRAINT "generated_documents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."generated_documents" ADD CONSTRAINT "generated_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."match_group_items" ADD CONSTRAINT "match_group_items_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."match_group_items" ADD CONSTRAINT "match_group_items_document_revision_id_fkey" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."match_group_items" ADD CONSTRAINT "match_group_items_match_group_id_fkey" FOREIGN KEY ("match_group_id") REFERENCES "public"."match_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."note_tabs" ADD CONSTRAINT "note_tabs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."note_tabs" ADD CONSTRAINT "note_tabs_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_attempts" ADD CONSTRAINT "processing_attempts_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_checkpoints" ADD CONSTRAINT "processing_checkpoints_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_document_tags" ADD CONSTRAINT "processing_document_tags_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_document_tags" ADD CONSTRAINT "processing_document_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."document_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_documents" ADD CONSTRAINT "processing_documents_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_documents" ADD CONSTRAINT "processing_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_documents" ADD CONSTRAINT "processing_documents_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."processing_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_documents" ADD CONSTRAINT "processing_documents_parent_processing_doc_id_fkey" FOREIGN KEY ("parent_processing_doc_id") REFERENCES "public"."processing_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."processing_documents" ADD CONSTRAINT "processing_documents_root_document_id_fkey" FOREIGN KEY ("root_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reconciliation_periods" ADD CONSTRAINT "reconciliation_periods_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."share_capital" ADD CONSTRAINT "share_capital_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."share_capital" ADD CONSTRAINT "share_capital_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."split_plans" ADD CONSTRAINT "split_plans_processing_document_id_fkey" FOREIGN KEY ("processing_document_id") REFERENCES "public"."processing_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."template_partials" ADD CONSTRAINT "template_partials_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."template_partials" ADD CONSTRAINT "template_partials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_backups" ADD CONSTRAINT "tenant_backups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_connector_access" ADD CONSTRAINT "tenant_connector_access_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "public"."connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_connector_access" ADD CONSTRAINT "tenant_connector_access_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_letterheads" ADD CONSTRAINT "tenant_letterheads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_company_assignments" ADD CONSTRAINT "user_company_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_company_assignments" ADD CONSTRAINT "user_company_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_role_assignments" ADD CONSTRAINT "user_role_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_role_assignments" ADD CONSTRAINT "user_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_role_assignments" ADD CONSTRAINT "user_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Company-owned compliance monitoring: coverage, financial periods, delivery scopes,
-- company-owned deadline cycles and occurrences, and review issues. Additive only.


-- CreateEnum
CREATE TYPE "DeadlineOwnershipScope" AS ENUM ('SERVICE', 'COMPANY');

-- CreateEnum
CREATE TYPE "MonitoringProfile" AS ENUM ('CORPORATE_TAX', 'NOMINEE_DIRECTOR');

-- CreateEnum
CREATE TYPE "MonitoringCoverageSource" AS ENUM ('AGREEMENT', 'NOMINEE_APPOINTMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "MonitoringCoverageStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "FinancialPeriodProvenance" AS ENUM ('CONFIRMED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "ObligationScopeConfirmation" AS ENUM ('CONFIRMED', 'UNCONFIRMED');

-- CreateEnum
CREATE TYPE "FilingResponsibility" AS ENUM ('OAKCLOUD', 'CLIENT', 'EXTERNAL_PROVIDER', 'UNCONFIRMED');

-- CreateEnum
CREATE TYPE "ResponsibilitySource" AS ENUM ('PROJECTED', 'STAFF');

-- CreateEnum
CREATE TYPE "CoverageLinkReason" AS ENUM ('MONITORING_INTERVAL', 'CONTRACTED_DELIVERY', 'TAKEOVER_REVIEW');

-- CreateEnum
CREATE TYPE "CompanyComplianceIssueType" AS ENUM ('MISSING_FINANCIAL_YEAR_END', 'PERIOD_REVIEW', 'RULE_NOT_PUBLISHED', 'RULE_INPUT_MISSING', 'FAMILY_NOT_AUTOMATED', 'RESPONSIBILITY_CONFLICT', 'DELIVERY_ENDED', 'DELIVERY_SCOPE_UNMATCHED', 'MONITORING_START_REVIEW', 'HANDOVER_REVIEW');

-- AlterTable
ALTER TABLE "deadline_occurrences" ADD COLUMN     "coverage_timing" VARCHAR(20),
ADD COLUMN     "delivery_client_service_id" TEXT,
ADD COLUMN     "filing_provider_name" VARCHAR(200),
ADD COLUMN     "filing_responsibility" "FilingResponsibility",
ADD COLUMN     "filing_status_unconfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "financial_period_end" DATE,
ADD COLUMN     "financial_period_start" DATE,
ADD COLUMN     "monitoring_owner_id" TEXT,
ADD COLUMN     "obligation_code" VARCHAR(100),
ADD COLUMN     "obligation_period_key" VARCHAR(40),
ADD COLUMN     "ownership_scope" "DeadlineOwnershipScope" NOT NULL DEFAULT 'SERVICE',
ADD COLUMN     "period_provisional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "responsibility_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "responsibility_confirmed_by_id" TEXT,
ADD COLUMN     "responsibility_source" "ResponsibilitySource",
ADD COLUMN     "year_of_assessment" INTEGER,
ALTER COLUMN "client_service_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "service_cycles" ADD COLUMN     "obligation_code" VARCHAR(100),
ADD COLUMN     "obligation_period_key" VARCHAR(40),
ADD COLUMN     "ownership_scope" "DeadlineOwnershipScope" NOT NULL DEFAULT 'SERVICE',
ALTER COLUMN "client_service_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "service_variants" ADD COLUMN     "monitoring_profiles" "MonitoringProfile"[] DEFAULT ARRAY[]::"MonitoringProfile"[];

-- CreateTable
CREATE TABLE "company_financial_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "years_of_assessment" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "provenance" "FinancialPeriodProvenance" NOT NULL DEFAULT 'CONFIRMED',
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_monitoring_coverages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "profile" "MonitoringProfile" NOT NULL,
    "source" "MonitoringCoverageSource" NOT NULL,
    "agreement_id" TEXT,
    "client_service_id" TEXT,
    "monitoring_start" DATE NOT NULL,
    "monitoring_end" DATE,
    "start_source" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(1000),
    "status" "MonitoringCoverageStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_user_id" TEXT,
    "ended_at" TIMESTAMP(3),
    "ended_by_id" TEXT,
    "ended_reason" VARCHAR(1000),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_monitoring_coverages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_service_obligation_scopes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_service_id" TEXT NOT NULL,
    "obligation_code" VARCHAR(100) NOT NULL,
    "period_key" VARCHAR(40) NOT NULL,
    "confirmation" "ObligationScopeConfirmation" NOT NULL DEFAULT 'UNCONFIRMED',
    "source" VARCHAR(40) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_service_obligation_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline_occurrence_coverage_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "link_key" VARCHAR(120) NOT NULL,
    "reason" "CoverageLinkReason" NOT NULL,
    "coverage_id" TEXT,
    "delivery_scope_id" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "deadline_occurrence_coverage_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline_responsibility_changes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "previous_responsibility" "FilingResponsibility",
    "new_responsibility" "FilingResponsibility" NOT NULL,
    "previous_delivery_client_service_id" TEXT,
    "new_delivery_client_service_id" TEXT,
    "provider_name" VARCHAR(200),
    "source" "ResponsibilitySource" NOT NULL,
    "actor_id" TEXT,
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_responsibility_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_compliance_issues" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "coverage_id" TEXT,
    "type" "CompanyComplianceIssueType" NOT NULL,
    "dedupe_key" VARCHAR(400) NOT NULL,
    "obligation_code" VARCHAR(100),
    "period_key" VARCHAR(40),
    "message" VARCHAR(1000) NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "resolution_note" VARCHAR(1000),

    CONSTRAINT "company_compliance_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_financial_periods_tenant_id_company_id_period_start_idx" ON "company_financial_periods"("tenant_id", "company_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "company_financial_periods_tenant_id_company_id_period_end_key" ON "company_financial_periods"("tenant_id", "company_id", "period_end");

-- CreateIndex
CREATE INDEX "company_monitoring_coverages_tenant_id_company_id_status_idx" ON "company_monitoring_coverages"("tenant_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "company_monitoring_coverages_tenant_id_profile_status_idx" ON "company_monitoring_coverages"("tenant_id", "profile", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_monitoring_coverages_tenant_id_client_service_id_pr_key" ON "company_monitoring_coverages"("tenant_id", "client_service_id", "profile");

-- CreateIndex
CREATE INDEX "client_service_obligation_scopes_tenant_id_company_id_oblig_idx" ON "client_service_obligation_scopes"("tenant_id", "company_id", "obligation_code", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "client_service_obligation_scopes_tenant_id_client_service_i_key" ON "client_service_obligation_scopes"("tenant_id", "client_service_id", "obligation_code", "period_key");

-- CreateIndex
CREATE INDEX "deadline_occurrence_coverage_links_tenant_id_coverage_id_idx" ON "deadline_occurrence_coverage_links"("tenant_id", "coverage_id");
-- CreateIndex
CREATE UNIQUE INDEX "deadline_occurrence_coverage_links_occurrence_id_link_key_key" ON "deadline_occurrence_coverage_links"("occurrence_id", "link_key");
-- CreateIndex
CREATE INDEX "deadline_responsibility_changes_tenant_id_occurrence_id_cre_idx" ON "deadline_responsibility_changes"("tenant_id", "occurrence_id", "created_at");
-- CreateIndex
CREATE INDEX "company_compliance_issues_tenant_id_resolved_at_type_idx" ON "company_compliance_issues"("tenant_id", "resolved_at", "type");
-- CreateIndex
CREATE UNIQUE INDEX "company_compliance_issues_tenant_id_company_id_dedupe_key_key" ON "company_compliance_issues"("tenant_id", "company_id", "dedupe_key");
-- CreateIndex
CREATE INDEX "deadline_occurrences_tenant_id_ownership_scope_filing_respo_idx" ON "deadline_occurrences"("tenant_id", "ownership_scope", "filing_responsibility");
-- AddForeignKey
ALTER TABLE "deadline_occurrences" ADD CONSTRAINT "deadline_occurrences_delivery_client_service_id_fkey" FOREIGN KEY ("delivery_client_service_id") REFERENCES "client_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_financial_periods" ADD CONSTRAINT "company_financial_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_financial_periods" ADD CONSTRAINT "company_financial_periods_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_monitoring_coverages" ADD CONSTRAINT "company_monitoring_coverages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_monitoring_coverages" ADD CONSTRAINT "company_monitoring_coverages_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_monitoring_coverages" ADD CONSTRAINT "company_monitoring_coverages_tenant_id_client_service_id_c_fkey" FOREIGN KEY ("tenant_id", "client_service_id", "company_id") REFERENCES "client_services"("tenant_id", "id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "client_service_obligation_scopes" ADD CONSTRAINT "client_service_obligation_scopes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "client_service_obligation_scopes" ADD CONSTRAINT "client_service_obligation_scopes_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "client_service_obligation_scopes" ADD CONSTRAINT "client_service_obligation_scopes_tenant_id_client_service__fkey" FOREIGN KEY ("tenant_id", "client_service_id", "company_id") REFERENCES "client_services"("tenant_id", "id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deadline_occurrence_coverage_links" ADD CONSTRAINT "deadline_occurrence_coverage_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deadline_occurrence_coverage_links" ADD CONSTRAINT "deadline_occurrence_coverage_links_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "deadline_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deadline_occurrence_coverage_links" ADD CONSTRAINT "deadline_occurrence_coverage_links_coverage_id_fkey" FOREIGN KEY ("coverage_id") REFERENCES "company_monitoring_coverages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deadline_occurrence_coverage_links" ADD CONSTRAINT "deadline_occurrence_coverage_links_delivery_scope_id_fkey" FOREIGN KEY ("delivery_scope_id") REFERENCES "client_service_obligation_scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deadline_responsibility_changes" ADD CONSTRAINT "deadline_responsibility_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deadline_responsibility_changes" ADD CONSTRAINT "deadline_responsibility_changes_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "deadline_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_compliance_issues" ADD CONSTRAINT "company_compliance_issues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_compliance_issues" ADD CONSTRAINT "company_compliance_issues_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "company_compliance_issues" ADD CONSTRAINT "company_compliance_issues_coverage_id_fkey" FOREIGN KEY ("coverage_id") REFERENCES "company_monitoring_coverages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ownership invariants: a service-owned row belongs to a client service, and a
-- company-owned row is identified by its obligation and period.
ALTER TABLE "service_cycles" ADD CONSTRAINT "service_cycles_ownership_scope_check" CHECK (
  ("ownership_scope" = 'SERVICE' AND "client_service_id" IS NOT NULL)
  OR ("ownership_scope" = 'COMPANY' AND "obligation_code" IS NOT NULL AND "obligation_period_key" IS NOT NULL)
);

ALTER TABLE "deadline_occurrences" ADD CONSTRAINT "deadline_occurrences_ownership_scope_check" CHECK (
  ("ownership_scope" = 'SERVICE' AND "client_service_id" IS NOT NULL)
  OR ("ownership_scope" = 'COMPANY' AND "obligation_code" IS NOT NULL AND "obligation_period_key" IS NOT NULL)
);

-- One company-owned rule cycle per company obligation period, however many
-- services cover it. Occurrences stay unique per cycle through the existing
-- (tenant_id, cycle_id, milestone_key, schedule_entry_key) key.
CREATE UNIQUE INDEX "service_cycles_company_obligation_period_key"
  ON "service_cycles"("tenant_id", "company_id", "obligation_code", "obligation_period_key")
  WHERE "ownership_scope" = 'COMPANY' AND "origin" = 'RULE';

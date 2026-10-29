-- AlterEnum: corporate secretarial services monitor the company's ACRA AGM and annual return.
ALTER TYPE "MonitoringProfile" ADD VALUE 'CORPORATE_SECRETARIAL' BEFORE 'NOMINEE_DIRECTOR';

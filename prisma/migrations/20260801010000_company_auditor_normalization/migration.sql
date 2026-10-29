CREATE TABLE "company_auditors" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "appointmentDate" TIMESTAMP(3),
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_auditors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_auditors_companyId_key" ON "company_auditors"("companyId");
CREATE INDEX "company_auditors_sourceDocumentId_idx" ON "company_auditors"("sourceDocumentId");

ALTER TABLE "company_auditors"
ADD CONSTRAINT "company_auditors_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_auditors"
ADD CONSTRAINT "company_auditors_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "connector_model_configs" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connector_model_configs_connectorId_idx" ON "connector_model_configs"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_model_configs_connectorId_modelId_key" ON "connector_model_configs"("connectorId", "modelId");

-- AddForeignKey
ALTER TABLE "connector_model_configs" ADD CONSTRAINT "connector_model_configs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

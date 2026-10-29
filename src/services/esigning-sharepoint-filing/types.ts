import type { EsigningSharePointFiling, EsigningSharePointFilingStatus, EsigningSharePointDestinationKind, EsigningSharePointRoutingReason } from '@/generated/prisma';

export type FilingStatus = EsigningSharePointFilingStatus;
export type FilingDestinationKind = EsigningSharePointDestinationKind;
export type FilingRoutingReason = EsigningSharePointRoutingReason;

export interface ClaimedSharePointFiling {
  id: string;
  tenantId: string;
  envelopeId: string;
  envelopeDocumentId: string;
  connectorId: string;
  claimToken: string;
  attempts: number;
}

export type SharePointFilingRecord = EsigningSharePointFiling;

export interface FilingRouteSnapshot {
  destinationKind: FilingDestinationKind;
  routingReason: FilingRoutingReason;
  connectorId: string;
  configVersion: number;
  companyId: string | null;
  companyNameSnapshot: string | null;
  templateId: string | null;
  templateVersion: number | null;
  intendedCompanyDriveId: string | null;
  intendedCompanyFolderId: string | null;
  intendedRelativePath: string | null;
  orphanDriveId: string;
  orphanFolderItemId: string;
}

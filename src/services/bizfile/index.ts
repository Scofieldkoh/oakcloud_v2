/**
 * BizFile Service Module
 *
 * This module handles ACRA BizFile document extraction and processing.
 *
 * Module Structure:
 * - types.ts: Type definitions and entity mapping functions
 * - extractor.ts: AI-based extraction (extractBizFileWithVision)
 * - normalizer.ts: Data normalization (normalizeExtractedData, buildFullAddress)
 * - diff.ts: Change detection (generateBizFileDiff)
 * - processor.ts: Database updates (processBizFileExtraction, processBizFileExtractionSelective)
 */

// Re-export all types
export type {
  ExtractedBizFileData,
  BizFileVisionInput,
  BizFileExtractionOptions,
  BizFileExtractionResult,
  BizFileDiffEntry,
  ExtractedOfficerData,
  ExtractedShareholderData,
  OfficerDiffEntry,
  ShareholderDiffEntry,
  OfficerAction,
  ExtendedBizFileDiffResult,
  SelectiveProcessingResult,
  ProcessingResult,
} from './types';

export type {
  BizFileChangeOperation,
  BizFileCommandMode,
  BizFileContactDecisionBinding,
  BizFileChange,
  BizFileBaselineSnapshot,
  BizFileChangePlan,
  BuildBizFileChangePlanInput,
} from './change-plan';

export {
  BizFileChangePlanError,
  hashBizFileValue,
  stableBizFileChangeId,
  computeBizFileAggregateRevision,
  buildBizFileChangePlan,
  assertBizFileChangePlan,
  selectedBizFileChanges,
  assertSafeBizFileNumbers,
} from './change-plan';

// Re-export mapping functions
export {
  mapEntityType,
  mapCompanyStatus,
  mapOfficerRole,
  mapContactType,
  mapIdentificationType,
} from './types';

// Re-export extraction functions
export {
  extractBizFileWithVision,
} from './extractor';

// Re-export normalization functions
export {
  normalizeExtractedData,
  buildFullAddress,
} from './normalizer';

// Re-export ACRA compliance enrichment
export {
  enrichBizFileComplianceFromAcra,
} from './acra-enrichment';
export type {
  BizFileAcraEnrichmentResult,
  AcraEnrichedComplianceField,
} from './acra-enrichment';

// Re-export diff function
export {
  generateBizFileDiff,
} from './diff';

// Re-export processing functions
export {
  processBizFileExtraction,
  processBizFileExtractionSelective,
} from './processor';

export {
  syncCompanyFromBizfileInTransaction,
} from './company-sync';
export {
  applyBizFileChangePlanInTransaction,
} from './canonical-sync';

export { assistantCapabilities } from './assistant-capabilities';
export { prepareBizFileImportCommand, baselineFromCompany } from './application/prepare-import';
export type {
  PrepareBizFileImportArgs,
  BizFilePreparedSource,
  BizFileContactCandidate,
  PreparedBizFileImport,
} from './application/prepare-import';
export {
  assertFreshBizFileSourceRevision,
  BizFileSourceRevisionError,
} from './application/source-revision';
export type {
  BizFileSourceRevisionCheck,
} from './application/source-revision';
export {
  createBizFileOperationRepository,
} from './application/operation-repository';
export type {
  BizFileOperationReceiptInput,
  BizFileOperationReceipt,
  BizFileOperationCommitInput,
  BizFileOperationEvidenceInput,
  BizFileOperationEffectInput,
  BizFileOperationRepository,
} from './application/operation-repository';
export {
  acquireBizFileOperationLock,
  bizFileOperationAdvisoryKey,
  reconcileBizFileOperation,
} from './application/operation-reconciliation';
export type {
  BizFileOperationClaimFence,
  BizFileOperationReceiptSnapshot,
  BizFileOperationReconciliationReason,
  BizFileOperationReconciliationResult,
  ReconcileBizFileOperationInput,
} from './application/operation-reconciliation';
export type {
  SyncCompanyFromBizfileArgs,
  SyncCompanyFromBizfileResult,
} from './company-sync';
export type {
  CanonicalBizFileSyncArgs,
  CanonicalBizFileSyncDependencies,
  CanonicalBizFileSyncResult,
} from './canonical-sync';

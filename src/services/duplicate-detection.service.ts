/**
 * Duplicate Detection Service
 *
 * Handles document duplicate detection, scoring, and decision workflow
 * as defined in Oakcloud_Document_Processing_Spec_v3.3 Appendix B.
 */

import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma';
import type { DuplicateAction } from '@/generated/prisma';
import { normalizeVendorName } from '@/lib/vendor-name';
import { jaroWinkler } from '@/lib/string-similarity';

type Decimal = Prisma.Decimal;

const log = createLogger('duplicate-detection');

// ============================================================================
// Types
// ============================================================================

export interface DuplicateScore {
  totalScore: number;
  signals: {
    vendorSimilarity: number;
    documentNumberMatch: number;
    dateProximity: number;
    amountDocCurrency: number;
    amountHomeCurrency: number;
  };
  confidence: 'HIGH' | 'SUSPECTED' | 'POSSIBLE' | 'NONE';
}

export interface DuplicateCandidate {
  documentId: string;
  processingDocumentId: string;
  score: DuplicateScore;
  vendorName?: string;
  documentNumber?: string;
  documentDate?: Date;
  totalAmount: Decimal;
  currency: string;
}

export interface DuplicateCheckResult {
  hasPotentialDuplicate: boolean;
  candidates: DuplicateCandidate[];
  exactFileHashMatch?: {
    documentId: string;
    processingDocumentId: string;
  };
}

// Scoring weights from Appendix B
const SCORE_WEIGHTS = {
  vendorSimilarity: 0.25,
  documentNumber: 0.30,
  dateProximity: 0.20,
  amountDocCurrency: 0.15,
  amountHomeCurrency: 0.10,
};

// Thresholds from Appendix B
const THRESHOLDS = {
  highConfidence: 0.95,
  suspected: 0.80,
  possible: 0.60,
};

// ============================================================================
// Duplicate Detection
// ============================================================================

/**
 * Check for duplicates of a document
 */
export async function checkForDuplicates(
  processingDocumentId: string,
  tenantId: string,
  companyId: string
): Promise<DuplicateCheckResult> {
  log.info(`Checking for duplicates of document ${processingDocumentId}`);

  const processingDoc = await prisma.processingDocument.findFirst({
    where: {
      id: processingDocumentId,
      document: {
        tenantId,
        companyId,
        deletedAt: null,
      },
    },
    select: {
      fileHash: true,
      currentRevisionId: true,
    },
  });

  if (!processingDoc) {
    throw new Error(`Processing document ${processingDocumentId} not found`);
  }

  const result: DuplicateCheckResult = {
    hasPotentialDuplicate: false,
    candidates: [],
  };

  // 1. Check for exact file hash match
  if (processingDoc.fileHash) {
    const exactMatch = await prisma.processingDocument.findFirst({
      where: {
        fileHash: processingDoc.fileHash,
        id: { not: processingDocumentId },
        deletedAt: null,
        document: {
          tenantId,
          companyId,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        documentId: true,
      },
    });

    if (exactMatch) {
      result.exactFileHashMatch = {
        documentId: exactMatch.documentId,
        processingDocumentId: exactMatch.id,
      };
      result.hasPotentialDuplicate = true;
      log.info(`Found exact file hash match: ${exactMatch.documentId}`);
      return result;
    }
  }

  // 2. Content-based duplicate detection using current or latest revision
  // First try currentRevisionId (approved), then fall back to latest revision (including drafts)
  // This is needed because duplicate check runs after extraction when revision is still DRAFT
  let currentRevision: {
    vendorName: string | null;
    documentNumber: string | null;
    documentDate: Date | null;
    totalAmount: Decimal;
    currency: string;
    homeEquivalent: Decimal | null;
    homeCurrency: string | null;
  } | null = null;

  if (processingDoc.currentRevisionId) {
    currentRevision = await prisma.documentRevision.findUnique({
      where: { id: processingDoc.currentRevisionId },
      select: {
        vendorName: true,
        documentNumber: true,
        documentDate: true,
        totalAmount: true,
        currency: true,
        homeEquivalent: true,
        homeCurrency: true,
      },
    });
  }

  // Fall back to latest revision if no currentRevisionId (e.g., just after extraction)
  if (!currentRevision) {
    currentRevision = await prisma.documentRevision.findFirst({
      where: { processingDocumentId },
      orderBy: { revisionNumber: 'desc' },
      select: {
        vendorName: true,
        documentNumber: true,
        documentDate: true,
        totalAmount: true,
        currency: true,
        homeEquivalent: true,
        homeCurrency: true,
      },
    });
  }

  if (!currentRevision) {
    // No revision yet, can't do content-based matching
    return result;
  }

  // Find candidate documents from same company with approved revisions
  const candidateDocs = await prisma.processingDocument.findMany({
    where: {
      id: { not: processingDocumentId },
      deletedAt: null,
      currentRevisionId: { not: null },
      document: {
        tenantId,
        companyId,
        deletedAt: null,
      },
    },
    select: {
      id: true,
      documentId: true,
      currentRevision: {
        select: {
          vendorName: true,
          documentNumber: true,
          documentDate: true,
          totalAmount: true,
          currency: true,
          homeEquivalent: true,
          homeCurrency: true,
        },
      },
    },
    take: 1000, // Limit for performance
  });

  // Score each candidate
  for (const candidate of candidateDocs) {
    if (!candidate.currentRevision) continue;
    if (!hasMatchingDocumentNumber(currentRevision.documentNumber, candidate.currentRevision.documentNumber)) {
      continue;
    }

    const score = calculateDuplicateScore(currentRevision, candidate.currentRevision);

    if (score.totalScore >= THRESHOLDS.possible) {
      result.candidates.push({
        documentId: candidate.documentId,
        processingDocumentId: candidate.id,
        score,
        vendorName: candidate.currentRevision.vendorName ?? undefined,
        documentNumber: candidate.currentRevision.documentNumber ?? undefined,
        documentDate: candidate.currentRevision.documentDate ?? undefined,
        totalAmount: candidate.currentRevision.totalAmount,
        currency: candidate.currentRevision.currency,
      });
    }
  }

  // Sort by score descending
  result.candidates.sort((a, b) => b.score.totalScore - a.score.totalScore);

  // Limit to top 10 candidates
  result.candidates = result.candidates.slice(0, 10);

  if (result.candidates.length > 0) {
    result.hasPotentialDuplicate = true;
    log.info(
      `Found ${result.candidates.length} duplicate candidates for ${processingDocumentId}, ` +
        `highest score: ${result.candidates[0].score.totalScore.toFixed(2)}`
    );
  }

  return result;
}

/**
 * Calculate duplicate score between two revisions
 */
function calculateDuplicateScore(
  source: {
    vendorName: string | null;
    documentNumber: string | null;
    documentDate: Date | null;
    totalAmount: Decimal;
    currency: string;
    homeEquivalent: Decimal | null;
    homeCurrency: string | null;
  },
  target: {
    vendorName: string | null;
    documentNumber: string | null;
    documentDate: Date | null;
    totalAmount: Decimal;
    currency: string;
    homeEquivalent: Decimal | null;
    homeCurrency: string | null;
  }
): DuplicateScore {
  // 1. Vendor similarity (Jaro-Winkler on normalized names)
  const vendorSimilarity = calculateVendorSimilarity(source.vendorName, target.vendorName);

  // 2. Document number match
  const documentNumberMatch = calculateDocumentNumberScore(source.documentNumber, target.documentNumber);

  // 3. Date proximity
  const dateProximity = calculateDateProximity(source.documentDate, target.documentDate);

  // 4. Amount match (document currency)
  const amountDocCurrency = calculateAmountScore(source.totalAmount, target.totalAmount);

  // 5. Amount match (home currency)
  const amountHomeCurrency =
    source.homeEquivalent && target.homeEquivalent
      ? calculateAmountScore(source.homeEquivalent, target.homeEquivalent)
      : amountDocCurrency;

  // Calculate weighted total
  const totalScore =
    vendorSimilarity * SCORE_WEIGHTS.vendorSimilarity +
    documentNumberMatch * SCORE_WEIGHTS.documentNumber +
    dateProximity * SCORE_WEIGHTS.dateProximity +
    amountDocCurrency * SCORE_WEIGHTS.amountDocCurrency +
    amountHomeCurrency * SCORE_WEIGHTS.amountHomeCurrency;

  // Determine confidence level
  let confidence: 'HIGH' | 'SUSPECTED' | 'POSSIBLE' | 'NONE';
  if (totalScore >= THRESHOLDS.highConfidence) {
    confidence = 'HIGH';
  } else if (totalScore >= THRESHOLDS.suspected) {
    confidence = 'SUSPECTED';
  } else if (totalScore >= THRESHOLDS.possible) {
    confidence = 'POSSIBLE';
  } else {
    confidence = 'NONE';
  }

  return {
    totalScore,
    signals: {
      vendorSimilarity,
      documentNumberMatch,
      dateProximity,
      amountDocCurrency,
      amountHomeCurrency,
    },
    confidence,
  };
}

/**
 * Calculate vendor name similarity using normalized comparison
 */
function calculateVendorSimilarity(name1: string | null, name2: string | null): number {
  if (!name1 || !name2) return 0;

  const norm1 = normalizeVendorName(name1);
  const norm2 = normalizeVendorName(name2);

  if (norm1 === norm2) return 1.0;

  return jaroWinkler(norm1, norm2);
}

/**
 * Calculate document number score
 */
function calculateDocumentNumberScore(num1: string | null, num2: string | null): number {
  return hasMatchingDocumentNumber(num1, num2) ? 1.0 : 0;
}

/**
 * Require document numbers to match after normalizing case and punctuation.
 * This keeps OCR formatting differences from blocking true matches while
 * preventing unrelated documents from being flagged purely on similarity.
 */
function hasMatchingDocumentNumber(num1: string | null, num2: string | null): boolean {
  const norm1 = normalizeDocumentNumber(num1);
  const norm2 = normalizeDocumentNumber(num2);

  if (!norm1 || !norm2) return false;

  return norm1 === norm2;
}

function normalizeDocumentNumber(value: string | null): string {
  if (!value) return '';

  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Calculate date proximity score
 */
function calculateDateProximity(date1: Date | null, date2: Date | null): number {
  if (!date1 || !date2) return 0;

  const daysDiff = Math.abs(
    Math.floor((date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24))
  );

  if (daysDiff === 0) return 1.0;
  if (daysDiff <= 7) return 1.0 - daysDiff * 0.1;
  if (daysDiff <= 30) return 0.3;

  return 0;
}

/**
 * Calculate amount score
 */
function calculateAmountScore(amount1: Decimal, amount2: Decimal): number {
  const val1 = parseFloat(amount1.toString());
  const val2 = parseFloat(amount2.toString());

  if (val1 === val2) return 1.0;

  const diff = Math.abs(val1 - val2);
  const percentDiff = diff / Math.max(val1, val2);

  if (percentDiff <= 0.001) return 0.98; // 0.1% tolerance
  if (percentDiff <= 0.01) return 0.9; // 1% tolerance
  if (percentDiff <= 0.05) return 0.7; // 5% tolerance

  return 0;
}

// ============================================================================
// Duplicate Decision Workflow
// ============================================================================

/**
 * Update document duplicate status based on check results
 */
export async function updateDuplicateStatus(
  processingDocumentId: string,
  checkResult: DuplicateCheckResult
): Promise<void> {
  if (!checkResult.hasPotentialDuplicate) {
    // No duplicates found
    await prisma.processingDocument.update({
      where: { id: processingDocumentId },
      data: {
        duplicateStatus: 'NONE',
        duplicateOfId: null,
        duplicateScore: null,
        duplicateReason: null,
      },
    });
    return;
  }

  if (checkResult.exactFileHashMatch) {
    // Exact file hash match
    await prisma.processingDocument.update({
      where: { id: processingDocumentId },
      data: {
        duplicateStatus: 'SUSPECTED',
        duplicateOfId: checkResult.exactFileHashMatch.processingDocumentId,
        duplicateScore: 1.0,
        duplicateReason: 'Exact file hash match',
      },
    });
    return;
  }

  // Content-based duplicate
  const topCandidate = checkResult.candidates[0];
  if (topCandidate && topCandidate.score.confidence !== 'NONE') {
    await prisma.processingDocument.update({
      where: { id: processingDocumentId },
      data: {
        duplicateStatus: 'SUSPECTED',
        duplicateOfId: topCandidate.processingDocumentId,
        duplicateScore: topCandidate.score.totalScore,
        duplicateReason: `Content similarity: ${(topCandidate.score.totalScore * 100).toFixed(1)}%`,
      },
    });
  }
}

/**
 * Record user decision on duplicate
 */
export async function recordDuplicateDecision(
  processingDocumentId: string,
  suspectedOfId: string,
  decision: DuplicateAction,
  userId: string,
  reason?: string
): Promise<void> {
  log.info(`Recording duplicate decision for ${processingDocumentId}: ${decision}`);

  // Create decision record
  await prisma.duplicateDecision.create({
    data: {
      processingDocumentId,
      suspectedOfId,
      decision,
      reason,
      decidedById: userId,
    },
  });

  // Update document status based on decision
  switch (decision) {
    case 'CONFIRM_DUPLICATE':
      // Soft delete the duplicate document
      await prisma.processingDocument.update({
        where: { id: processingDocumentId },
        data: {
          duplicateStatus: 'CONFIRMED',
          deletedAt: new Date(),
        },
      });
      // Clear duplicate references pointing to this document
      await clearDuplicateReferencesToDocument(processingDocumentId);
      log.info(`Soft deleted confirmed duplicate document ${processingDocumentId}`);
      break;

    case 'REJECT_DUPLICATE':
      await prisma.processingDocument.update({
        where: { id: processingDocumentId },
        data: {
          duplicateStatus: 'REJECTED',
          duplicateOfId: null,
          duplicateScore: null,
          duplicateReason: reason,
        },
      });
      break;

    case 'MARK_AS_NEW_VERSION':
      // This is handled by document-processing.service.markAsNewVersion
      await prisma.processingDocument.update({
        where: { id: processingDocumentId },
        data: {
          duplicateStatus: 'NONE',
        },
      });
      break;
  }

  log.info(`Duplicate decision recorded: ${decision}`);
}

/**
 * Get pending duplicate decisions for a document
 */
export async function getPendingDuplicateDecision(
  processingDocumentId: string
): Promise<{ suspectedOfId: string; score: number; reason?: string } | null> {
  const doc = await prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
    select: {
      duplicateStatus: true,
      duplicateOfId: true,
      duplicateScore: true,
      duplicateReason: true,
    },
  });

  if (!doc || doc.duplicateStatus !== 'SUSPECTED' || !doc.duplicateOfId) {
    return null;
  }

  // Check if decision already exists
  const existingDecision = await prisma.duplicateDecision.findFirst({
    where: {
      processingDocumentId,
      suspectedOfId: doc.duplicateOfId,
    },
  });

  if (existingDecision) {
    return null;
  }

  return {
    suspectedOfId: doc.duplicateOfId,
    score: doc.duplicateScore ?? 0,
    reason: doc.duplicateReason ?? undefined,
  };
}

/**
 * Clear duplicate references pointing to a document that is being deleted
 * This should be called when a document is soft-deleted to prevent orphaned references
 */
export async function clearDuplicateReferencesToDocument(
  processingDocumentId: string
): Promise<number> {
  const result = await prisma.processingDocument.updateMany({
    where: {
      duplicateOfId: processingDocumentId,
      deletedAt: null,
    },
    data: {
      duplicateStatus: 'NONE',
      duplicateOfId: null,
      duplicateScore: null,
      duplicateReason: null,
    },
  });

  if (result.count > 0) {
    log.info(
      `Cleared duplicate references from ${result.count} document(s) pointing to deleted document ${processingDocumentId}`
    );
  }

  return result.count;
}

/**
 * Check if document can be approved (duplicate decision gating)
 */
export async function canApproveDocument(processingDocumentId: string): Promise<{
  canApprove: boolean;
  reason?: string;
}> {
  const doc = await prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
    select: {
      duplicateStatus: true,
      duplicateOfId: true,
    },
  });

  if (!doc) {
    return { canApprove: false, reason: 'Document not found' };
  }

  // If suspected duplicate, check for decision
  if (doc.duplicateStatus === 'SUSPECTED') {
    const hasDecision = await prisma.duplicateDecision.findFirst({
      where: {
        processingDocumentId,
        suspectedOfId: doc.duplicateOfId ?? undefined,
      },
    });

    if (!hasDecision) {
      return {
        canApprove: false,
        reason: 'Duplicate decision required before approval',
      };
    }
  }

  // Confirmed duplicates cannot be approved
  if (doc.duplicateStatus === 'CONFIRMED') {
    return {
      canApprove: false,
      reason: 'Confirmed duplicates cannot be approved',
    };
  }

  return { canApprove: true };
}

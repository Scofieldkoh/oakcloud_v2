/**
 * AI-Powered Split Detection Utility
 *
 * Analyzes multi-page documents to detect document boundaries using AI vision models.
 * Identifies where separate documents start and end in a combined PDF scan.
 */

import { getBestAvailableModelForWorkspace, callAIWithConnector, stripMarkdownCodeBlocks } from '@/lib/ai';
import { storage } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import type { AIModel } from '@/lib/ai/types';
import type { DocumentCategory } from '@/generated/prisma';

const log = createLogger('split-detection');

export interface SplitBoundary {
    pageFrom: number;
    pageTo: number;
    confidence: number;
    predictedCategory?: DocumentCategory;
}

export interface SplitDetectionConfig {
    model?: string;
    maxPagesToAnalyze?: number;
}

export interface SplitDetectionResult {
    documentBoundaries: SplitBoundary[];
    overallConfidence: number;
    reasoning?: string;
}

/**
 * Perform AI-powered split detection
 * Analyzes page images to detect document boundaries (new documents, invoices, etc.)
 */
export async function performAISplitDetection(
    pages: { pageNumber: number; storageKey: string }[],
    tenantId: string,
    userId: string | null,
    config: SplitDetectionConfig = {}
): Promise<SplitDetectionResult> {
    const maxPages = config.maxPagesToAnalyze ?? 10;

    // Get best available AI model
    const modelId = config.model ?? (await getBestAvailableModelForWorkspace(tenantId));

    if (!modelId) {
        log.warn('No AI model available for split detection, using heuristic fallback');
        return heuristicSplitDetection(pages);
    }

    // For single-page documents, no split needed
    if (pages.length === 1) {
        return {
            documentBoundaries: [{
                pageFrom: 1,
                pageTo: 1,
                confidence: 0.99,
                predictedCategory: 'ACCOUNTS_PAYABLE' as DocumentCategory,
            }],
            overallConfidence: 0.99,
        };
    }

    try {
        // Prepare image data for AI analysis
        const pagesToAnalyze = Math.min(pages.length, maxPages);
        const pageImages: { pageNumber: number; base64: string; mimeType: 'image/png' | 'image/jpeg' }[] = [];

        for (let i = 0; i < pagesToAnalyze; i++) {
            const page = pages[i];
            try {
                const imageBuffer = await storage.download(page.storageKey);
                const base64 = imageBuffer.toString('base64');
                const storageKey = page.storageKey.toLowerCase();
                const mimeType: 'image/png' | 'image/jpeg' =
                    storageKey.endsWith('.jpg') || storageKey.endsWith('.jpeg')
                        ? 'image/jpeg'
                        : 'image/png';
                pageImages.push({ pageNumber: page.pageNumber, base64, mimeType });
            } catch (error) {
                log.warn(`Failed to load page ${page.pageNumber} for split detection`, error);
            }
        }

        if (pageImages.length === 0) {
            log.warn('No page images available for AI split detection');
            return heuristicSplitDetection(pages);
        }

        // Build split detection prompt
        const splitPrompt = buildSplitDetectionPrompt(pageImages.length, pages.length);

        // Call AI with images (limit to 5 images for API constraints)
        const imagesToSend = pageImages.slice(0, 5).map(p => ({
            base64: p.base64,
            mimeType: p.mimeType
        }));

        const response = await callAIWithConnector({
            model: modelId as AIModel,
            systemPrompt: 'You are a document analysis AI. Respond with valid JSON only.',
            userPrompt: splitPrompt,
            images: imagesToSend,
            tenantId,
            userId,
            operation: 'split_detection',
        });

        // Parse AI response
        const cleanedResponse = stripMarkdownCodeBlocks(response.content);
        const parsed = JSON.parse(cleanedResponse);

        // Validate response structure
        if (!parsed.documentBoundaries || !Array.isArray(parsed.documentBoundaries)) {
            log.warn('Invalid AI split detection response, falling back to heuristic');
            return heuristicSplitDetection(pages);
        }

        // Map and validate boundaries
        const boundaries: SplitBoundary[] = parsed.documentBoundaries.map((b: {
            pageFrom: number;
            pageTo: number;
            confidence?: number;
            predictedCategory?: string;
        }) => ({
            pageFrom: Math.max(1, b.pageFrom),
            pageTo: Math.min(b.pageTo, pages.length),
            confidence: b.confidence ?? 0.8,
            predictedCategory: (b.predictedCategory || 'ACCOUNTS_PAYABLE') as DocumentCategory,
        }));

        // If AI analysis missed pages beyond analyzed range, extend last boundary
        const maxAnalyzedPage = Math.max(...boundaries.map(b => b.pageTo));
        if (maxAnalyzedPage < pages.length && boundaries.length > 0) {
            boundaries[boundaries.length - 1].pageTo = pages.length;
            boundaries[boundaries.length - 1].confidence *= 0.7; // Lower confidence for extended range
        }

        log.info(`AI split detection found ${boundaries.length} document boundaries`);

        return {
            documentBoundaries: boundaries,
            overallConfidence: parsed.overallConfidence ?? 0.8,
            reasoning: parsed.reasoning,
        };
    } catch (error) {
        log.error('AI split detection failed, using heuristic fallback', error);
        return heuristicSplitDetection(pages);
    }
}

/**
 * Build the AI prompt for split detection
 */
function buildSplitDetectionPrompt(analyzedPages: number, totalPages: number): string {
    return `You are a document boundary detection AI. Analyze these ${analyzedPages} page images from a ${totalPages}-page document upload.

Your task is to identify where different documents start and end. Common scenarios:
- Multiple invoices scanned together
- A cover letter followed by an invoice  
- Multiple receipts in one PDF
- Supporting documents attached to main invoice

## Response Schema (JSON)
{
  "documentBoundaries": [
    {
      "pageFrom": number (1-indexed, start page of this document),
      "pageTo": number (1-indexed, end page of this document),
      "confidence": number (0-1, how confident you are this is a separate document),
      "predictedCategory": "ACCOUNTS_PAYABLE" | "ACCOUNTS_RECEIVABLE" | "TREASURY" | "TAX_COMPLIANCE" | "OTHER"
    }
  ],
  "overallConfidence": number (0-1, overall confidence in the split detection),
  "reasoning": string (brief explanation of why you identified these boundaries)
}

## Key Split Indicators
- New letterhead/company logo appearing
- Change in document type (invoice to receipt, etc.)
- Different invoice numbers or document dates
- Significant visual layout change
- "Page 1 of X" indicators starting over

IMPORTANT: 
- Boundaries must be contiguous and cover all pages 1 to ${totalPages}
- Return ONLY valid JSON, no markdown code blocks
- If you cannot determine boundaries, treat as single document`;
}

/**
 * Heuristic fallback for split detection when AI is unavailable
 */
export function heuristicSplitDetection(
    pages: { pageNumber: number }[]
): SplitDetectionResult {
    // For single page, high confidence
    if (pages.length === 1) {
        return {
            documentBoundaries: [{
                pageFrom: 1,
                pageTo: 1,
                confidence: 0.95,
                predictedCategory: 'ACCOUNTS_PAYABLE' as DocumentCategory,
            }],
            overallConfidence: 0.95,
        };
    }

    // Multi-page document: treat as single document with moderate confidence
    // Could be enhanced with OCR text pattern matching in future
    return {
        documentBoundaries: [{
            pageFrom: 1,
            pageTo: pages.length,
            confidence: 0.7,
            predictedCategory: 'ACCOUNTS_PAYABLE' as DocumentCategory,
        }],
        overallConfidence: 0.7,
    };
}

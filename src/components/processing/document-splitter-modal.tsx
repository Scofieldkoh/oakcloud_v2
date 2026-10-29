'use client';

/**
 * DocumentSplitterModal
 *
 * Modal for splitting a multi-page PDF into separate documents.
 * User can define cut points to split the document at specific pages.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Scissors, Plus, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SplitRange {
    id: string;
    pageFrom: number;
    pageTo: number;
    label: string;
}

interface DocumentSplitterModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (ranges: SplitRange[]) => Promise<void>;
    documentId: string;
    fileName: string;
    totalPages: number;
}

/**
 * Automatically compute split ranges from cut points
 * Cut points are the page numbers where a split occurs (after that page)
 */
function computeRangesFromCutPoints(cutPoints: number[], totalPages: number): SplitRange[] {
    if (cutPoints.length === 0) {
        return [{
            id: 'range-0',
            pageFrom: 1,
            pageTo: totalPages,
            label: 'Document 1',
        }];
    }

    const sorted = [...cutPoints].sort((a, b) => a - b);
    const ranges: SplitRange[] = [];

    let startPage = 1;
    for (let i = 0; i < sorted.length; i++) {
        const cutAfter = sorted[i];
        ranges.push({
            id: `range-${i}`,
            pageFrom: startPage,
            pageTo: cutAfter,
            label: `Document ${i + 1}`,
        });
        startPage = cutAfter + 1;
    }

    // Add final range
    if (startPage <= totalPages) {
        ranges.push({
            id: `range-${sorted.length}`,
            pageFrom: startPage,
            pageTo: totalPages,
            label: `Document ${sorted.length + 1}`,
        });
    }

    return ranges;
}

export function DocumentSplitterModal({
    isOpen,
    onClose,
    onConfirm,
    documentId: _documentId,
    fileName,
    totalPages,
}: DocumentSplitterModalProps) {
    // Cut points: pages where we cut (after that page)
    const [cutPoints, setCutPoints] = useState<number[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Compute ranges from cut points
    const ranges = useMemo(
        () => computeRangesFromCutPoints(cutPoints, totalPages),
        [cutPoints, totalPages]
    );

    // Reset when modal opens
    useEffect(() => {
        if (isOpen) {
            setCutPoints([]);
            setError(null);
        }
    }, [isOpen]);

    const addCutPoint = useCallback((afterPage: number) => {
        if (afterPage < 1 || afterPage >= totalPages) return;
        if (cutPoints.includes(afterPage)) return;
        setCutPoints((prev) => [...prev, afterPage].sort((a, b) => a - b));
    }, [cutPoints, totalPages]);

    const removeCutPoint = useCallback((page: number) => {
        setCutPoints((prev) => prev.filter((p) => p !== page));
    }, []);

    const handleConfirm = async () => {
        if (ranges.length < 2) {
            setError('Please add at least one cut point to split the document');
            return;
        }

        setIsProcessing(true);
        setError(null);

        try {
            await onConfirm(ranges);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to split document');
        } finally {
            setIsProcessing(false);
        }
    };

    // Generate page grid for visual selection
    const pageGrid = useMemo(() => {
        const pages: number[] = [];
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i);
        }
        return pages;
    }, [totalPages]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Split Document"
            size="lg"
        >
            <ModalBody className="space-y-4">
                {/* Info */}
                <div className="flex items-start gap-3 text-sm text-text-secondary">
                    <Scissors className="w-5 h-5 text-oak-primary mt-0.5" />
                    <div>
                        <p className="font-medium text-text-primary">{fileName}</p>
                        <p>{totalPages} pages • Click between pages to add cut points</p>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="flex items-center gap-2 p-3 bg-status-error/10 text-status-error rounded-lg text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                {/* Page Grid */}
                <div className="border border-border-primary rounded-lg p-4 bg-background-secondary">
                    <div className="flex flex-wrap items-center gap-1">
                        {pageGrid.map((pageNum, idx) => (
                            <div key={pageNum} className="flex items-center">
                                {/* Page Box */}
                                <div
                                    className={cn(
                                        'w-10 h-14 rounded border flex items-center justify-center text-sm font-medium',
                                        'bg-background-primary border-border-secondary'
                                    )}
                                >
                                    {pageNum}
                                </div>

                                {/* Cut Point Button (between pages) */}
                                {idx < pageGrid.length - 1 && (
                                    <button
                                        onClick={() =>
                                            cutPoints.includes(pageNum)
                                                ? removeCutPoint(pageNum)
                                                : addCutPoint(pageNum)
                                        }
                                        className={cn(
                                            'w-6 h-14 flex items-center justify-center transition-colors mx-0.5',
                                            cutPoints.includes(pageNum)
                                                ? 'bg-status-warning/20 border-2 border-status-warning border-dashed'
                                                : 'hover:bg-oak-primary/10 border border-dashed border-transparent hover:border-oak-primary/30'
                                        )}
                                        title={
                                            cutPoints.includes(pageNum)
                                                ? `Remove cut after page ${pageNum}`
                                                : `Cut after page ${pageNum}`
                                        }
                                    >
                                        {cutPoints.includes(pageNum) ? (
                                            <Scissors className="w-3 h-3 text-status-warning rotate-90" />
                                        ) : (
                                            <Plus className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100" />
                                        )}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Preview of Splits */}
                <div className="space-y-2">
                    <h4 className="text-sm font-medium text-text-primary">
                        Result: {ranges.length} document{ranges.length > 1 ? 's' : ''}
                    </h4>
                    <div className="space-y-2">
                        {ranges.map((range, idx) => (
                            <div
                                key={range.id}
                                className="flex items-center gap-3 p-2 bg-background-tertiary rounded-lg text-sm"
                            >
                                <span className="w-6 h-6 rounded-full bg-oak-primary/20 text-oak-primary flex items-center justify-center text-xs font-medium">
                                    {idx + 1}
                                </span>
                                <span className="text-text-primary">
                                    Pages {range.pageFrom}
                                    {range.pageFrom !== range.pageTo && (
                                        <>
                                            <ArrowRight className="w-3 h-3 inline mx-1" />
                                            {range.pageTo}
                                        </>
                                    )}
                                </span>
                                <span className="text-text-muted ml-auto">
                                    ({range.pageTo - range.pageFrom + 1} page{range.pageTo - range.pageFrom + 1 > 1 ? 's' : ''})
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Instructions */}
                <p className="text-xs text-text-muted">
                    Each split will create a new document in the processing queue. The original document will be archived.
                </p>
            </ModalBody>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose} disabled={isProcessing}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={handleConfirm}
                    disabled={isProcessing || ranges.length < 2}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Splitting...
                        </>
                    ) : (
                        <>
                            <Scissors className="w-4 h-4 mr-2" />
                            Split into {ranges.length} Documents
                        </>
                    )}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

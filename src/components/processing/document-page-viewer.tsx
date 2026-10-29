'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  RefreshCw,
  FileText,
  ToggleLeft,
  ToggleRight,
  RotateCw,
  RotateCcw,
  PanelLeft,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDocumentPages, useAppendPages, useReorderPages, useDeletePages } from '@/hooks/use-processing-documents';
import { useIsMobile } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// Import pdfjs-dist types
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// =============================================================================
// Types
// =============================================================================

export interface BoundingBox {
  pageNumber: number;
  x: number; // 0-1 normalized (left edge)
  y: number; // 0-1 normalized (top edge)
  width: number; // 0-1 normalized
  height: number; // 0-1 normalized
  label?: string;
  color?: string;
}

export interface TextLayerItem {
  text: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  width: number; // normalized 0-1
  height: number; // normalized 0-1
}

export interface FieldValue {
  label: string;
  value: string;
  color?: string;
}

interface CanvasDimensions {
  width: number;
  height: number;
}

export type DocumentPageViewMode = 'single' | 'continuous';

export interface DocumentPageOverlayContext extends CanvasDimensions {
  pageNumber: number;
}

export interface DocumentPageThumbnailMarker {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

interface DocumentPageViewerProps {
  /** Document ID to fetch PDF from (used with useDocumentPages hook) */
  documentId?: string;
  /** Direct PDF URL (alternative to documentId - skips data fetching) */
  pdfUrl?: string;
  initialPage?: number;
  initialRotation?: number;
  /** Fit the first page to the available viewer width before the initial render. */
  fitFirstPageWidthOnInitialLoad?: boolean;
  zoomLevel?: number;
  onZoomLevelChange?: (zoomLevel: number) => void;
  highlights?: BoundingBox[];
  fieldValues?: FieldValue[];
  onPageChange?: (pageNumber: number) => void;
  onPageCountChange?: (pageCount: number) => void;
  onTextLayerReady?: (textItems: TextLayerItem[], pageNumber: number) => void;
  onRotationChange?: (rotation: number, pageNumber: number) => void;
  showHighlights?: boolean;
  onShowHighlightsChange?: (show: boolean) => void;
  showHighlightsToggle?: boolean;
  className?: string;
  /** Document revision status for append/reorder confirmation */
  documentStatus?: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  /** Callback when pages are modified (append/reorder) */
  onPagesChanged?: () => void;
  /** Called when a highlight rect is clicked. Makes highlight rects interactive (pointer-events-auto). */
  onHighlightClick?: (index: number, highlight: BoundingBox) => void;
  /** Renders custom React content inside each highlight's foreignObject. Receives the highlight, its pixel rect, and index. */
  renderHighlightContent?: (highlight: BoundingBox, pixelRect: { x: number; y: number; width: number; height: number }, index: number) => React.ReactNode;
  /** Label of the highlight to bring into view when the current page is rendered. */
  focusedHighlightLabel?: string;
  /** Optional retry handler when using a direct pdfUrl prop and loading fails. */
  onRetry?: () => void;
  /** Render one page at a time (default) or stack every page in a continuous scroll surface. */
  viewMode?: DocumentPageViewMode;
  /** Whether the embedding surface permits the page-thumbnail panel and its toggle. */
  allowPagePanel?: boolean;
  /** Optional normalized field markers rendered over page thumbnails. */
  thumbnailMarkers?: DocumentPageThumbnailMarker[];
  /** Show full-height previous/next page controls beside the canvas. */
  showPageSideNavigation?: boolean;
  /** Optional page-relative content rendered over each PDF canvas. */
  renderPageOverlay?: (context: DocumentPageOverlayContext) => React.ReactNode;
  /** Disable pointer capture for decorative overlays above interactive highlights. */
  pageOverlayInteractive?: boolean;
  /**
   * Keyboard shortcut ownership policy:
   * - 'global' (default): page/zoom keys apply anywhere outside editable controls.
   * - 'focused': page keys apply only while focus is inside the scroll container.
   * - 'disabled': the viewer never consumes keyboard events.
   */
  keyboardShortcutScope?: 'global' | 'focused' | 'disabled';
}

// =============================================================================
// Constants
// =============================================================================

const ZOOM_LEVELS = Array.from({ length: 30 }, (_, index) => (index + 1) / 10);
const DEFAULT_ZOOM_INDEX = 16; // 170%
const MOBILE_DEFAULT_ZOOM_INDEX = 9; // 100%
const MIN_ZOOM_LEVEL = ZOOM_LEVELS[0];
const MAX_ZOOM_LEVEL = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
const MOBILE_ZOOM_STEP = 0.01;
const MOBILE_ZOOM_RENDER_DELAY_MS = 120;
const VIEWER_HORIZONTAL_PADDING_PX = 32;
const CANVAS_HORIZONTAL_BORDER_PX = 2;
const PINCH_ZOOM_STEP_PX = 40; // Pinch distance (px) required to move one percent
export const DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS = [...ZOOM_LEVELS] as const;

// Fixed padding for bounding boxes (normalized 0-1 coordinates)
const BBOX_HORIZONTAL_PADDING = 0.008;
const BBOX_VERTICAL_PADDING = 0.003;

// Empty arrays to avoid creating new references on each render
const EMPTY_HIGHLIGHTS: BoundingBox[] = [];
const EMPTY_FIELD_VALUES: FieldValue[] = [];

function getTouchDistance(touchA: Touch, touchB: Touch): number {
  const deltaX = touchA.clientX - touchB.clientX;
  const deltaY = touchA.clientY - touchB.clientY;
  return Math.hypot(deltaX, deltaY);
}

function getClosestZoomIndex(zoomLevel: number): number {
  return ZOOM_LEVELS.reduce((closestIndex, candidateZoom, candidateIndex) => {
    const currentDistance = Math.abs(candidateZoom - zoomLevel);
    const closestDistance = Math.abs(ZOOM_LEVELS[closestIndex] - zoomLevel);
    return currentDistance < closestDistance ? candidateIndex : closestIndex;
  }, DEFAULT_ZOOM_INDEX);
}

function clampZoomLevel(zoomLevel: number): number {
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, Math.round(zoomLevel * 100) / 100));
}

function getFitWidthZoomLevel(input: {
  containerWidth: number;
  pageWidthAtScaleOne: number;
  isMobile: boolean;
}): number | null {
  const availableWidth =
    input.containerWidth - VIEWER_HORIZONTAL_PADDING_PX - CANVAS_HORIZONTAL_BORDER_PX;
  if (availableWidth <= 0 || input.pageWidthAtScaleOne <= 0) {
    return null;
  }

  const rawZoom = clampZoomLevel(availableWidth / input.pageWidthAtScaleOne);
  if (input.isMobile) {
    return rawZoom;
  }

  let fittingZoom = MIN_ZOOM_LEVEL;
  for (const candidate of ZOOM_LEVELS) {
    if (candidate > rawZoom) {
      break;
    }
    fittingZoom = candidate;
  }
  return fittingZoom;
}

// =============================================================================
// PDF.js Initialization
// =============================================================================

let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let workerInitialized = false;
const pdfBytesCache = new Map<string, Promise<Uint8Array>>();

async function getPdfJs() {
  if (pdfjsLib && workerInitialized) return pdfjsLib;

  const pdfjs = await import('pdfjs-dist');

  if (!workerInitialized) {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    workerInitialized = true;
  }

  pdfjsLib = pdfjs;
  return pdfjs;
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const cached = pdfBytesCache.get(url);
  if (cached) {
    return (await cached).slice();
  }

  const loadPromise = (async () => {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF (${response.status})`);
    }

    return new Uint8Array(await response.arrayBuffer());
  })();

  pdfBytesCache.set(url, loadPromise);

  try {
    return (await loadPromise).slice();
  } catch (error) {
    pdfBytesCache.delete(url);
    throw error;
  }
}

// =============================================================================
// Text Layer Extraction
// =============================================================================

/**
 * Extract text layer from PDF page and convert to normalized coordinates
 */
async function extractTextLayer(page: PDFPageProxy): Promise<TextLayerItem[]> {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const items: TextLayerItem[] = [];

  for (const item of textContent.items) {
    if (!('str' in item) || !(item as TextItem).str) continue;

    const textItem = item as TextItem;
    const text = textItem.str.trim();
    if (!text) continue;

    const transform = textItem.transform;
    const fontSize = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]);

    const pdfX = transform[4];
    const pdfY = transform[5];
    const textWidth = textItem.width;
    const textHeight = textItem.height || fontSize;

    const x = pdfX / pageWidth;
    const width = textWidth / pageWidth;
    const y = 1 - (pdfY / pageHeight) - (textHeight / pageHeight);
    const height = textHeight / pageHeight;

    items.push({
      text,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: Math.max(0, Math.min(1, width)),
      height: Math.max(0, Math.min(1, height)),
    });
  }

  return items;
}

// =============================================================================
// Text Matching
// =============================================================================

function addBboxPadding(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const paddedX = Math.max(0, x - BBOX_HORIZONTAL_PADDING);
  const paddedY = Math.max(0, y - BBOX_VERTICAL_PADDING);
  const paddedWidth = Math.min(1 - paddedX, width + BBOX_HORIZONTAL_PADDING * 2);
  const paddedHeight = Math.min(1 - paddedY, height + BBOX_VERTICAL_PADDING * 2);

  return { x: paddedX, y: paddedY, width: paddedWidth, height: paddedHeight };
}

function findTextInLayer(
  textItems: TextLayerItem[],
  searchValue: string,
  pageNumber: number,
  color?: string
): BoundingBox | null {
  if (!searchValue || searchValue.trim().length === 0) return null;

  const normalizedSearch = searchValue.trim().toLowerCase();

  const createBbox = (x: number, y: number, w: number, h: number): BoundingBox => {
    const padded = addBboxPadding(x, y, w, h);
    return {
      pageNumber,
      x: padded.x,
      y: padded.y,
      width: padded.width,
      height: padded.height,
      color,
    };
  };

  // Strategy 1: Exact match
  for (const item of textItems) {
    if (item.text.toLowerCase() === normalizedSearch) {
      return createBbox(item.x, item.y, item.width, item.height);
    }
  }

  // Strategy 2: Contains match
  for (const item of textItems) {
    if (item.text.toLowerCase().includes(normalizedSearch)) {
      return createBbox(item.x, item.y, item.width, item.height);
    }
  }

  // Strategy 3: Multi-item spanning match
  const fullText = textItems.map(i => i.text).join(' ').toLowerCase();
  if (fullText.includes(normalizedSearch)) {
    let accumulated = '';
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < textItems.length; i++) {
      accumulated += (accumulated ? ' ' : '') + textItems[i].text.toLowerCase();

      if (startIdx === -1 && accumulated.includes(normalizedSearch.split(' ')[0])) {
        startIdx = i;
      }

      if (startIdx !== -1 && accumulated.includes(normalizedSearch)) {
        endIdx = i;
        break;
      }
    }

    if (startIdx !== -1 && endIdx !== -1) {
      const relevantItems = textItems.slice(startIdx, endIdx + 1);
      const minX = Math.min(...relevantItems.map(i => i.x));
      const minY = Math.min(...relevantItems.map(i => i.y));
      const maxX = Math.max(...relevantItems.map(i => i.x + i.width));
      const maxY = Math.max(...relevantItems.map(i => i.y + i.height));

      return createBbox(minX, minY, maxX - minX, maxY - minY);
    }
  }

  // Strategy 4: Fuzzy match for numbers
  const numericSearch = searchValue.replace(/[,$\s]/g, '');
  if (/^[\d.]+$/.test(numericSearch)) {
    for (const item of textItems) {
      const numericItem = item.text.replace(/[,$\s]/g, '');
      if (numericItem === numericSearch || numericItem.includes(numericSearch)) {
        return createBbox(item.x, item.y, item.width, item.height);
      }
    }
  }

  return null;
}

function DocumentHighlightOverlay({
  highlights,
  dimensions,
  onHighlightClick,
  renderHighlightContent,
}: {
  highlights: BoundingBox[];
  dimensions: CanvasDimensions;
  onHighlightClick?: (index: number, highlight: BoundingBox) => void;
  renderHighlightContent?: (
    highlight: BoundingBox,
    pixelRect: { x: number; y: number; width: number; height: number },
    index: number
  ) => React.ReactNode;
}) {
  if (highlights.length === 0 || dimensions.width <= 0 || dimensions.height <= 0) {
    return null;
  }

  return (
    <svg
      className={cn(
        'absolute left-0 top-0',
        !(onHighlightClick || renderHighlightContent) && 'pointer-events-none'
      )}
      style={{ width: dimensions.width, height: dimensions.height }}
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      preserveAspectRatio="none"
    >
      {highlights.map((highlight, index) => {
        const x = highlight.x * dimensions.width;
        const y = highlight.y * dimensions.height;
        const width = highlight.width * dimensions.width;
        const height = highlight.height * dimensions.height;
        const color = highlight.color || '#93C5FD';

        return (
          <g key={index}>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={`${color}30`}
              stroke={color}
              strokeWidth="1.5"
              rx="4"
              {...(onHighlightClick
                ? {
                    onClick: () => onHighlightClick(index, highlight),
                    style: { cursor: 'pointer' },
                    pointerEvents: 'auto' as const,
                  }
                : {})}
            />
            {renderHighlightContent ? (
              <foreignObject
                x={x}
                y={y}
                width={width}
                height={height}
                style={{ pointerEvents: 'auto' }}
              >
                {renderHighlightContent(
                  highlight,
                  { x, y, width, height },
                  index
                )}
              </foreignObject>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function DocumentPageViewer({
  documentId,
  pdfUrl: pdfUrlProp,
  initialPage = 1,
  initialRotation = 0,
  fitFirstPageWidthOnInitialLoad = false,
  zoomLevel,
  onZoomLevelChange,
  highlights,
  fieldValues,
  onPageChange,
  onPageCountChange,
  onTextLayerReady,
  onRotationChange,
  showHighlights: showHighlightsProp,
  onShowHighlightsChange,
  showHighlightsToggle = true,
  className,
  documentStatus,
  onPagesChanged,
  onHighlightClick,
  renderHighlightContent,
  focusedHighlightLabel,
  onRetry,
  viewMode = 'single',
  allowPagePanel = true,
  thumbnailMarkers = [],
  showPageSideNavigation = true,
  renderPageOverlay,
  pageOverlayInteractive = true,
  keyboardShortcutScope = 'global',
}: DocumentPageViewerProps) {
  // Stable references
  const stableHighlights = highlights ?? EMPTY_HIGHLIGHTS;
  const stableFieldValues = fieldValues ?? EMPTY_FIELD_VALUES;

  // Data fetching (only if documentId is provided, skip if using pdfUrl directly)
  const { data, isLoading: isDataLoading, error: dataError, refetch } = useDocumentPages(documentId || '');

  // Determine which PDF URL to use (prop takes precedence)
  const effectivePdfUrl = pdfUrlProp || data?.pdfUrl;
  const skipDataFetch = !!pdfUrlProp;

  // State
  const isMobile = useIsMobile();
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageCount, setPageCount] = useState(0);
  const [zoomIndexInternal, setZoomIndexInternal] = useState(DEFAULT_ZOOM_INDEX);
  const [zoomLevelInternal, setZoomLevelInternal] = useState(ZOOM_LEVELS[DEFAULT_ZOOM_INDEX]);
  const [rotation, setRotation] = useState(initialRotation); // 0, 90, 180, 270 degrees
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<CanvasDimensions>({ width: 0, height: 0 });
  const [continuousCanvasDimensions, setContinuousCanvasDimensions] = useState<
    Record<number, CanvasDimensions>
  >({});
  const [continuousRenderedPages, setContinuousRenderedPages] = useState<Set<number>>(
    () => new Set()
  );
  const [continuousPageRotations, setContinuousPageRotations] = useState<Record<number, number>>(
    {}
  );
  const [textLayerItems, setTextLayerItems] = useState<TextLayerItem[]>([]);
  const [textLayerHighlights, setTextLayerHighlights] = useState<BoundingBox[]>([]);
  const [showHighlightsInternal, setShowHighlightsInternal] = useState(true);
  const [showThumbnails, setShowThumbnails] = useState(true);

  const isZoomControlled = typeof zoomLevel === 'number';
  const zoomIndex = isZoomControlled ? getClosestZoomIndex(zoomLevel) : zoomIndexInternal;
  const showHighlights = showHighlightsProp ?? showHighlightsInternal;
  const zoom = isMobile
    ? clampZoomLevel(
        isZoomControlled ? zoomLevel ?? ZOOM_LEVELS[MOBILE_DEFAULT_ZOOM_INDEX] : zoomLevelInternal
      )
    : ZOOM_LEVELS[zoomIndex];
  const thumbnailPages = useMemo<PageInfo[]>(() => {
    if (data?.pages?.length) {
      return data.pages;
    }

    if (!skipDataFetch || pageCount === 0) {
      return [];
    }

    return Array.from({ length: pageCount }, (_, index) => ({
      id: `pdf-page-${index + 1}`,
      pageNumber: index + 1,
      imageUrl: '',
    }));
  }, [data?.pages, pageCount, skipDataFetch]);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const continuousCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const continuousRenderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());
  const scrollFrameRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(zoom);
  const panStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const lastFocusedHighlightKeyRef = useRef<string | null>(null);
  const fittedPdfUrlRef = useRef<string | null>(null);

  // ==========================================================================
  // Handlers
  // ==========================================================================

  const setResolvedZoomIndex = useCallback(
    (nextZoomIndexOrUpdater: number | ((current: number) => number)) => {
      const currentZoomIndex = isZoomControlled
        ? getClosestZoomIndex(zoomLevel ?? ZOOM_LEVELS[DEFAULT_ZOOM_INDEX])
        : zoomIndexInternal;
      const nextZoomIndexRaw =
        typeof nextZoomIndexOrUpdater === 'function'
          ? nextZoomIndexOrUpdater(currentZoomIndex)
          : nextZoomIndexOrUpdater;
      const nextZoomIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, nextZoomIndexRaw));

      if (!isZoomControlled) {
        setZoomIndexInternal(nextZoomIndex);
      }

      onZoomLevelChange?.(ZOOM_LEVELS[nextZoomIndex]);
    },
    [isZoomControlled, onZoomLevelChange, zoomIndexInternal, zoomLevel]
  );

  const setResolvedMobileZoom = useCallback(
    (nextZoomOrUpdater: number | ((current: number) => number)) => {
      const currentZoom = zoom;
      const nextZoomRaw =
        typeof nextZoomOrUpdater === 'function'
          ? nextZoomOrUpdater(currentZoom)
          : nextZoomOrUpdater;
      const nextZoom = clampZoomLevel(nextZoomRaw);

      if (!isZoomControlled) {
        setZoomLevelInternal(nextZoom);
      }

      onZoomLevelChange?.(nextZoom);
    },
    [isZoomControlled, onZoomLevelChange, zoom]
  );

  const handleToggleHighlights = useCallback(() => {
    const newValue = !showHighlights;
    if (onShowHighlightsChange) {
      onShowHighlightsChange(newValue);
    } else {
      setShowHighlightsInternal(newValue);
    }
  }, [showHighlights, onShowHighlightsChange]);

  const navigateToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
      const nextPage = Math.min(Math.max(pageNumber, 1), Math.max(pageCount, 1));
      setCurrentPage(nextPage);

      if (viewMode !== 'continuous') {
        return;
      }

      window.requestAnimationFrame(() => {
        const scrollContainer = scrollContainerRef.current;
        const pageElement = scrollContainer?.querySelector<HTMLElement>(
          `[data-document-page-number="${nextPage}"]`
        );
        if (!scrollContainer || !pageElement) {
          return;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const pageRect = pageElement.getBoundingClientRect();
        scrollContainer.scrollTo({
          top: Math.max(0, scrollContainer.scrollTop + pageRect.top - containerRect.top - 16),
          behavior,
        });
      });
    },
    [pageCount, viewMode]
  );

  const handlePrevPage = useCallback(() => {
    navigateToPage(currentPage - 1);
  }, [currentPage, navigateToPage]);

  const handleNextPage = useCallback(() => {
    navigateToPage(currentPage + 1);
  }, [currentPage, navigateToPage]);

  const handleZoomIn = useCallback(() => {
    if (isMobile) {
      setResolvedMobileZoom((prev) => prev + MOBILE_ZOOM_STEP);
      return;
    }

    setResolvedZoomIndex((prev) => prev + 1);
  }, [isMobile, setResolvedMobileZoom, setResolvedZoomIndex]);

  const handleZoomOut = useCallback(() => {
    if (isMobile) {
      setResolvedMobileZoom((prev) => prev - MOBILE_ZOOM_STEP);
      return;
    }

    setResolvedZoomIndex((prev) => prev - 1);
  }, [isMobile, setResolvedMobileZoom, setResolvedZoomIndex]);

  const handleScrollContainerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const interactiveTarget = (event.target as HTMLElement | null)?.closest(
        'button, a, input, textarea, select, [role="button"], [data-no-pan="true"]'
      );
      if (interactiveTarget) {
        return;
      }

      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      panStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScrollLeft: container.scrollLeft,
        startScrollTop: container.scrollTop,
      };
      setIsPanning(true);
      container.setPointerCapture?.(event.pointerId);
    },
    []
  );

  const handleScrollContainerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = panStateRef.current;
      const container = scrollContainerRef.current;
      if (!state || !container || state.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - state.startClientX;
      const deltaY = event.clientY - state.startClientY;
      container.scrollLeft = state.startScrollLeft - deltaX;
      container.scrollTop = state.startScrollTop - deltaY;
    },
    []
  );

  const handleScrollContainerPointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = panStateRef.current;
      const container = scrollContainerRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }

      panStateRef.current = null;
      setIsPanning(false);
      container?.releasePointerCapture?.(event.pointerId);
    },
    []
  );

  const activeRotation =
    viewMode === 'continuous'
      ? (continuousPageRotations[currentPage] ?? initialRotation)
      : rotation;

  const handleRotateCW = useCallback(() => {
    const newRotation = (activeRotation + 90) % 360;
    if (viewMode === 'continuous') {
      setContinuousPageRotations((current) => ({
        ...current,
        [currentPage]: newRotation,
      }));
    } else {
      setRotation(newRotation);
    }
    onRotationChange?.(newRotation, currentPage);
  }, [activeRotation, currentPage, onRotationChange, viewMode]);

  const handleRotateCCW = useCallback(() => {
    const newRotation = (activeRotation - 90 + 360) % 360;
    if (viewMode === 'continuous') {
      setContinuousPageRotations((current) => ({
        ...current,
        [currentPage]: newRotation,
      }));
    } else {
      setRotation(newRotation);
    }
    onRotationChange?.(newRotation, currentPage);
  }, [activeRotation, currentPage, onRotationChange, viewMode]);

  const handlePageInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value >= 1 && value <= pageCount) {
        navigateToPage(value);
      }
    },
    [navigateToPage, pageCount]
  );

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      }
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  // ==========================================================================
  // PDF Rendering
  // ==========================================================================

  const renderPage = useCallback(async (pdf: PDFDocumentProxy, pageNum: number, pageRotation: number = 0) => {
    if (!canvasRef.current) return;

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdf.getPage(pageNum);
      const canvas = canvasRef.current;
      if (!canvas) return;

      // PDF.js viewport supports rotation in degrees
      const viewport = page.getViewport({ scale: zoom, rotation: pageRotation });
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      setCanvasDimensions({
        width: viewport.width,
        height: viewport.height,
      });

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      };

      const renderTask = page.render(renderContext as Parameters<typeof page.render>[0]);
      renderTaskRef.current = renderTask;

      await renderTask.promise;

      if (renderTaskRef.current === renderTask) {
        renderTaskRef.current = null;
      }

      if (!canvasRef.current || canvasRef.current !== canvas) {
        return;
      }

      // Extract text layer for highlighting
      try {
        const textItems = await extractTextLayer(page);
        if (!canvasRef.current || canvasRef.current !== canvas) {
          return;
        }
        setTextLayerItems(textItems);
        onTextLayerReady?.(textItems, pageNum);
      } catch (textErr) {
        console.warn('Failed to extract text layer:', textErr);
        setTextLayerItems([]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'RenderingCancelledException') {
        return;
      }
      console.error('Error rendering page:', err);
    }
  }, [zoom, onTextLayerReady]);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // On mobile, default initial zoom to 100% instead of 150%.
  useEffect(() => {
    if (!isMobile || isZoomControlled) return;
    setZoomLevelInternal((prev) =>
      prev === ZOOM_LEVELS[DEFAULT_ZOOM_INDEX] ? ZOOM_LEVELS[MOBILE_DEFAULT_ZOOM_INDEX] : prev
    );
  }, [isMobile, isZoomControlled]);

  // Load PDF when URL is available
  useEffect(() => {
    if (!effectivePdfUrl) return;

    // Capture URL in const for TypeScript narrowing inside async function
    const pdfUrlToLoad = effectivePdfUrl;
    let cancelled = false;

    async function loadPdf() {
      try {
        setIsPdfLoading(true);
        setPdfError(null);

        const pdfjs = await getPdfJs();

        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const pdfBytes = await fetchPdfBytes(pdfUrlToLoad);
        if (cancelled) {
          return;
        }

        const loadingTask = pdfjs.getDocument({ data: pdfBytes });
        const pdf = await loadingTask.promise;

        if (cancelled) {
          pdf.destroy();
          return;
        }

        pdfDocRef.current = pdf;
        setPageCount(pdf.numPages);
        onPageCountChange?.(pdf.numPages);

        if (
          fitFirstPageWidthOnInitialLoad &&
          fittedPdfUrlRef.current !== pdfUrlToLoad &&
          pdf.numPages > 0
        ) {
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => resolve());
            });
          });

          if (cancelled) {
            return;
          }

          const scrollContainer = scrollContainerRef.current;
          if (scrollContainer) {
            const firstPage = await pdf.getPage(1);
            const firstPageRotation =
              data?.pages?.find((pageInfo) => pageInfo.pageNumber === 1)?.rotation ??
              initialRotation;
            const firstPageViewport = firstPage.getViewport({
              scale: 1,
              rotation: firstPageRotation,
            });
            const fitZoom = getFitWidthZoomLevel({
              containerWidth: scrollContainer.clientWidth,
              pageWidthAtScaleOne: firstPageViewport.width,
              isMobile,
            });

            if (fitZoom !== null) {
              if (!isZoomControlled) {
                if (isMobile) {
                  setZoomLevelInternal(fitZoom);
                } else {
                  setZoomIndexInternal(getClosestZoomIndex(fitZoom));
                }
              }
              onZoomLevelChange?.(fitZoom);
              fittedPdfUrlRef.current = pdfUrlToLoad;
            }
          }
        }

        if (viewMode === 'continuous') {
          setContinuousCanvasDimensions({});
          setContinuousRenderedPages(new Set());
          setContinuousPageRotations(
            Object.fromEntries(
              Array.from({ length: pdf.numPages }, (_, index) => {
                const pageNumber = index + 1;
                const savedRotation =
                  data?.pages?.find((pageInfo) => pageInfo.pageNumber === pageNumber)?.rotation ??
                  initialRotation;
                return [pageNumber, savedRotation];
              })
            )
          );
          return;
        }

        // Get saved rotation from pages data if available
        const pageInfo = data?.pages?.find((p) => p.pageNumber === currentPage);
        const savedRotation = pageInfo?.rotation ?? rotation;

        // Update rotation state if different from saved value
        if (pageInfo?.rotation !== undefined && pageInfo.rotation !== rotation) {
          setRotation(pageInfo.rotation);
        }

        await renderPage(pdf, currentPage, savedRotation);
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading PDF:', err);
          setPdfError(err instanceof Error ? err.message : 'Failed to load PDF');
        }
      } finally {
        if (!cancelled) {
          setIsPdfLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when URL changes, not on every render
  }, [effectivePdfUrl]);

  // Re-render page on page/zoom/rotation change (also when loading completes)
  useEffect(() => {
    if (viewMode === 'single' && pdfDocRef.current && !isPdfLoading) {
      renderPage(pdfDocRef.current, currentPage, rotation);
    }
  }, [currentPage, zoom, rotation, isPdfLoading, renderPage, viewMode]);

  useEffect(() => {
    if (
      viewMode !== 'continuous' ||
      !pdfDocRef.current ||
      isPdfLoading ||
      pageCount === 0
    ) {
      return;
    }

    const pdf = pdfDocRef.current;
    const renderTasks = continuousRenderTasksRef.current;
    let cancelled = false;

    renderTasks.forEach((task) => task.cancel());
    renderTasks.clear();

    async function renderAllPages() {
      try {
        const pages = await Promise.all(
          Array.from({ length: pageCount }, (_, index) => pdf.getPage(index + 1))
        );
        if (cancelled) {
          return;
        }

        const renderEntries = pages.map((page, index) => {
          const pageNumber = index + 1;
          const viewport = page.getViewport({
            scale: zoom,
            rotation: continuousPageRotations[pageNumber] ?? initialRotation,
          });
          return { page, pageNumber, viewport };
        });

        setContinuousCanvasDimensions(
          Object.fromEntries(
            renderEntries.map(({ pageNumber, viewport }) => [
              pageNumber,
              { width: viewport.width, height: viewport.height },
            ])
          )
        );

        for (const { page, pageNumber, viewport } of renderEntries) {
          if (cancelled) {
            return;
          }

          const canvas = continuousCanvasRefs.current.get(pageNumber);
          const context = canvas?.getContext('2d');
          if (!canvas || !context) {
            continue;
          }

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderTask = page.render({ canvas, canvasContext: context, viewport });
          renderTasks.set(pageNumber, renderTask);

          try {
            await renderTask.promise;
          } catch (error) {
            if (!(error instanceof Error && error.name === 'RenderingCancelledException')) {
              throw error;
            }
            return;
          } finally {
            if (renderTasks.get(pageNumber) === renderTask) {
              renderTasks.delete(pageNumber);
            }
          }

          if (cancelled) {
            return;
          }

          setContinuousRenderedPages((current) => {
            const next = new Set(current);
            next.add(pageNumber);
            return next;
          });

          try {
            const textItems = await extractTextLayer(page);
            if (!cancelled) {
              onTextLayerReady?.(textItems, pageNumber);
            }
          } catch (textError) {
            console.warn(`Failed to extract text layer for page ${pageNumber}:`, textError);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error rendering continuous PDF pages:', error);
        }
      }
    }

    const renderDelay = isMobile ? MOBILE_ZOOM_RENDER_DELAY_MS : 0;
    const renderTimer = window.setTimeout(() => {
      void renderAllPages();
    }, renderDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(renderTimer);
      renderTasks.forEach((task) => task.cancel());
      renderTasks.clear();
    };
  }, [
    continuousPageRotations,
    initialRotation,
    isPdfLoading,
    isMobile,
    onTextLayerReady,
    pageCount,
    viewMode,
    zoom,
  ]);

  const handleContinuousScroll = useCallback(() => {
    if (viewMode !== 'continuous' || scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }

      const containerRect = scrollContainer.getBoundingClientRect();
      const viewportCenter = containerRect.top + containerRect.height / 2;
      const pageElements = scrollContainer.querySelectorAll<HTMLElement>(
        '[data-document-page-number]'
      );
      let closestPage = 1;
      let closestDistance = Number.POSITIVE_INFINITY;

      pageElements.forEach((pageElement) => {
        const pageNumber = Number(pageElement.dataset.documentPageNumber);
        const pageRect = pageElement.getBoundingClientRect();
        const pageCenter = pageRect.top + pageRect.height / 2;
        const distance = Math.abs(pageCenter - viewportCenter);
        if (Number.isFinite(pageNumber) && distance < closestDistance) {
          closestPage = pageNumber;
          closestDistance = distance;
        }
      });

      setCurrentPage((current) => (current === closestPage ? current : closestPage));
    });
  }, [viewMode]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    []
  );

  // Keep latest zoom level for gesture handlers without re-binding event listeners.
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Notify parent of page changes
  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  // Reset page when document changes
  useEffect(() => {
    setCurrentPage(initialPage);
  }, [documentId, initialPage]);

  // Load saved rotation from pages data when page changes or data loads
  useEffect(() => {
    if (data?.pages && data.pages.length > 0) {
      const pageInfo = data.pages.find((p) => p.pageNumber === currentPage);
      if (pageInfo && pageInfo.rotation !== undefined) {
        // Only update if different to avoid unnecessary re-renders
        setRotation((prev) => (prev !== pageInfo.rotation ? pageInfo.rotation : prev));
      }
    }
  }, [data?.pages, currentPage]);

  // Generate highlights from fieldValues
  useEffect(() => {
    if (textLayerItems.length === 0 || stableFieldValues.length === 0) {
      setTextLayerHighlights((prev) => (prev.length === 0 ? prev : EMPTY_HIGHLIGHTS));
      return;
    }

    const newHighlights: BoundingBox[] = [];

    for (const field of stableFieldValues) {
      const match = findTextInLayer(textLayerItems, field.value, currentPage, field.color);
      if (match) {
        newHighlights.push(match);
      }
    }

    setTextLayerHighlights(newHighlights);
  }, [textLayerItems, stableFieldValues, currentPage]);

  useEffect(() => {
    if (!focusedHighlightLabel || isPdfLoading) {
      return;
    }

    const targetHighlight = stableHighlights.find(
      (highlight) =>
        highlight.label === focusedHighlightLabel &&
        (viewMode === 'continuous' || highlight.pageNumber === currentPage)
    );
    if (!targetHighlight) {
      return;
    }

    const targetDimensions =
      viewMode === 'continuous'
        ? continuousCanvasDimensions[targetHighlight.pageNumber]
        : canvasDimensions;
    if (!targetDimensions || targetDimensions.width <= 0 || targetDimensions.height <= 0) {
      return;
    }

    const focusKey = [
      focusedHighlightLabel,
      targetHighlight.pageNumber,
      Math.round(targetDimensions.width),
      Math.round(targetDimensions.height),
    ].join(':');
    if (lastFocusedHighlightKeyRef.current === focusKey) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    const canvas =
      viewMode === 'continuous'
        ? continuousCanvasRefs.current.get(targetHighlight.pageNumber)
        : canvasRef.current;
    if (!scrollContainer || !canvas) {
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetCenterX =
      scrollContainer.scrollLeft +
      (canvasRect.left - containerRect.left) +
      (targetHighlight.x + targetHighlight.width / 2) * targetDimensions.width;
    const targetCenterY =
      scrollContainer.scrollTop +
      (canvasRect.top - containerRect.top) +
      (targetHighlight.y + targetHighlight.height / 2) * targetDimensions.height;

    const nextScrollLeft = Math.max(0, targetCenterX - scrollContainer.clientWidth / 2);
    const nextScrollTop = Math.max(0, targetCenterY - scrollContainer.clientHeight / 2);

    scrollContainer.scrollTo({
      left: nextScrollLeft,
      top: nextScrollTop,
      behavior: 'smooth',
    });
    lastFocusedHighlightKeyRef.current = focusKey;
  }, [
    canvasDimensions,
    continuousCanvasDimensions,
    currentPage,
    focusedHighlightLabel,
    isPdfLoading,
    stableHighlights,
    viewMode,
  ]);

  // Keyboard navigation for PDF pages and zoom
  // Left/Right arrows for page navigation, +/- for zoom
  // Up/Down arrows are NOT captured to allow natural scrolling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (keyboardShortcutScope === 'disabled') return;
      if (e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLSelectElement ||
          e.target instanceof HTMLTextAreaElement) return;
      if (
        keyboardShortcutScope === 'focused' &&
        !scrollContainerRef.current?.contains(e.target as Node)
      ) {
        return;
      }

      // Left/Right arrows for page navigation
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevPage();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextPage();
        return;
      }

      // Page Up/Down for page navigation (alternative)
      if (e.key === 'PageUp') {
        e.preventDefault();
        handlePrevPage();
        return;
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        handleNextPage();
        return;
      }

      // Zoom with +/- keys
      if (e.key === '+' || e.key === '=') {
        handleZoomIn();
        return;
      }
      if (e.key === '-') {
        handleZoomOut();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevPage, handleNextPage, handleZoomIn, handleZoomOut, keyboardShortcutScope]);

  // Auto-focus scroll container when PDF loads to enable keyboard scrolling
  useEffect(() => {
    if (!isPdfLoading && scrollContainerRef.current) {
      // Only focus if no other element is focused (e.g., user isn't in an input)
      if (!document.activeElement || document.activeElement === document.body) {
        scrollContainerRef.current.focus();
      }
    }
  }, [isPdfLoading]);

  // Ctrl+scroll wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      if (e.deltaY < 0) {
        handleZoomIn();
      } else if (e.deltaY > 0) {
        handleZoomOut();
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleZoomIn, handleZoomOut]);

  // Mobile pinch-to-zoom inside document preview.
  useEffect(() => {
    if (!isMobile) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinchStartDistanceRef.current = getTouchDistance(e.touches[0], e.touches[1]);
      pinchStartZoomRef.current = zoomRef.current;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDistanceRef.current === null) return;

      // Prevent browser viewport zoom while pinching on the PDF panel.
      e.preventDefault();

      const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
      const pinchDelta = currentDistance - pinchStartDistanceRef.current;
      const zoomDelta = Math.round(pinchDelta / PINCH_ZOOM_STEP_PX) * MOBILE_ZOOM_STEP;
      const nextZoom = clampZoomLevel(pinchStartZoomRef.current + zoomDelta);

      setResolvedMobileZoom((prev) => (prev === nextZoom ? prev : nextZoom));
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDistanceRef.current = getTouchDistance(e.touches[0], e.touches[1]);
        pinchStartZoomRef.current = zoomRef.current;
        return;
      }
      pinchStartDistanceRef.current = null;
    };

    const handleTouchCancel = () => {
      pinchStartDistanceRef.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [isMobile, setResolvedMobileZoom]);

  // ==========================================================================
  // Computed values
  // ==========================================================================

  const currentHighlights = [
    ...textLayerHighlights,
    ...stableHighlights.filter((h) => h.pageNumber === currentPage),
  ];

  // When using pdfUrl directly, skip data loading state
  const isLoading = skipDataFetch ? isPdfLoading : (isDataLoading || isPdfLoading);
  const error = skipDataFetch ? pdfError : (dataError || pdfError);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-96 bg-background-secondary rounded-lg', className)}>
        <FileText className="w-12 h-12 text-text-muted mb-4" />
        <p className="text-text-secondary mb-4">Failed to load document</p>
        <button
          onClick={() => {
            if (skipDataFetch) {
              onRetry?.();
              return;
            }
            void refetch();
          }}
          className="btn-secondary btn-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  // Only show data loading state if fetching via documentId
  if (!skipDataFetch && isDataLoading) {
    return (
      <div className={cn('flex items-center justify-center h-96 bg-background-secondary rounded-lg', className)}>
        <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
        <span className="ml-3 text-text-secondary">Loading document...</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={isFullscreen ? { height: '100dvh' } : undefined}
      className={cn(
        'flex flex-col bg-background-secondary overflow-hidden',
        isFullscreen && 'fixed inset-0 z-50',
        className
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-background-tertiary border-b border-border-primary flex-wrap gap-2">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || isLoading}
            className="btn-ghost btn-xs p-1.5"
            title="Previous page (â†)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 text-sm">
            <input
              type="number"
              value={currentPage}
              onChange={handlePageInput}
              min={1}
              max={pageCount}
              disabled={isLoading}
              className="w-12 px-2 py-1 text-center text-sm bg-background-primary border border-border-primary rounded"
            />
            <span className="text-text-muted">/ {pageCount || '?'}</span>
          </div>

          <button
            onClick={handleNextPage}
            disabled={currentPage >= pageCount || isLoading}
            className="btn-ghost btn-xs p-1.5"
            title="Next page (â†’)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
          <button
            onClick={handleZoomOut}
            disabled={isMobile ? zoom <= MIN_ZOOM_LEVEL : zoomIndex === 0}
            className="btn-ghost btn-xs p-1.5"
            title="Zoom out (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <span className="text-sm text-text-secondary w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={handleZoomIn}
            disabled={isMobile ? zoom >= MAX_ZOOM_LEVEL : zoomIndex === ZOOM_LEVELS.length - 1}
            className="btn-ghost btn-xs p-1.5"
            title="Zoom in (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-border-primary mx-1" />

          {/* Rotation controls */}
          <button
            onClick={handleRotateCCW}
            className="btn-ghost btn-xs p-1.5"
            title="Rotate counter-clockwise"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleRotateCW}
            className="btn-ghost btn-xs p-1.5"
            title="Rotate clockwise"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-border-primary mx-1" />

          {/* Bounding box toggle */}
          {showHighlightsToggle && (
          <button
            onClick={handleToggleHighlights}
            className={cn(
              'btn-ghost btn-xs p-1.5 flex items-center gap-1',
              showHighlights && 'text-oak-primary'
            )}
            title={showHighlights ? 'Hide bounding boxes' : 'Show bounding boxes'}
          >
            {showHighlights ? (
              <ToggleRight className="w-4 h-4" />
            ) : (
              <ToggleLeft className="w-4 h-4" />
            )}
            <span className="text-xs hidden sm:inline">Boxes</span>
          </button>
          )}

          <div className="w-px h-4 bg-border-primary mx-1" />

          <button
            onClick={toggleFullscreen}
            className="btn-ghost btn-xs p-1.5"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          <div className="w-px h-4 bg-border-primary mx-1" />

          {/* Page thumbnails toggle */}
          {allowPagePanel ? (
            <button
              onClick={() => setShowThumbnails(!showThumbnails)}
              className={cn(
                'btn-ghost btn-xs p-1.5 flex items-center gap-1',
                showThumbnails && 'text-oak-primary'
              )}
              title={showThumbnails ? 'Hide page thumbnails' : 'Show page thumbnails'}
            >
              <PanelLeft className="w-4 h-4" />
              <span className="text-xs hidden sm:inline">Pages</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* PDF viewer with optional thumbnail sidebar */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Page thumbnail sidebar */}
        {allowPagePanel && showThumbnails && thumbnailPages.length > 0 && (
          <PageThumbnailSidebar
            pages={thumbnailPages}
            currentPage={currentPage}
            onPageSelect={navigateToPage}
            pdfUrl={effectivePdfUrl ?? undefined}
            documentId={documentId}
            documentStatus={documentStatus}
            isPdf={data?.isPdf ?? true}
            onPagesChanged={onPagesChanged}
            thumbnailMarkers={thumbnailMarkers}
          />
        )}

        {/* Main viewer area with navigation bars */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          {/* Left navigation bar - sticky full height */}
          {showPageSideNavigation && currentPage > 1 && (
            <button
              onClick={handlePrevPage}
              disabled={isLoading}
              className={cn(
                'sticky top-0 left-0 z-20 self-stretch flex-shrink-0',
                'w-12 hidden sm:flex items-center justify-center',
                'bg-black/5 hover:bg-black/20 dark:bg-white/5 dark:hover:bg-white/20',
                'transition-colors duration-200',
                'disabled:opacity-30 disabled:cursor-not-allowed'
              )}
              title="Previous page (←)"
            >
              <ChevronLeft className="w-6 h-6 text-text-primary" />
            </button>
          )}

          {/* Scrollable PDF content area - tabIndex allows keyboard scrolling with arrow keys */}
          <div
            ref={scrollContainerRef}
            data-document-scroll-container="true"
            onPointerDown={handleScrollContainerPointerDown}
            onPointerMove={handleScrollContainerPointerMove}
            onPointerUp={handleScrollContainerPointerEnd}
            onPointerCancel={handleScrollContainerPointerEnd}
            onScroll={handleContinuousScroll}
            className={cn(
              'flex-1 overflow-auto p-4 bg-background-secondary focus:outline-none',
              isPanning ? 'cursor-grabbing' : 'cursor-grab'
            )}
            tabIndex={0}
          >
            {viewMode === 'continuous' ? (
              <div className="flex min-w-full flex-col items-start gap-4 sm:items-center">
                {pageCount === 0 ? (
                  <div className="flex min-h-96 items-center justify-center text-text-secondary">
                    <RefreshCw className="h-6 w-6 animate-spin text-text-muted" />
                    <span className="ml-3">Loading PDF...</span>
                  </div>
                ) : (
                  Array.from({ length: pageCount }, (_, index) => {
                    const pageNumber = index + 1;
                    const dimensions = continuousCanvasDimensions[pageNumber];
                    const pageHighlights = stableHighlights.filter(
                      (highlight) => highlight.pageNumber === pageNumber
                    );
                    const isRendered = continuousRenderedPages.has(pageNumber);

                    return (
                      <div
                        key={pageNumber}
                        data-document-page-number={pageNumber}
                        className="relative flex-shrink-0 bg-background-tertiary"
                        style={
                          dimensions
                            ? { width: dimensions.width, height: dimensions.height }
                            : { width: 600, minHeight: 800 }
                        }
                      >
                        {!isRendered ? (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background-tertiary">
                            <RefreshCw className="h-6 w-6 animate-spin text-text-muted" />
                            <span className="ml-3 text-text-secondary">Loading page {pageNumber}...</span>
                          </div>
                        ) : null}

                        <canvas
                          ref={(canvas) => {
                            if (canvas) {
                              continuousCanvasRefs.current.set(pageNumber, canvas);
                            } else {
                              continuousCanvasRefs.current.delete(pageNumber);
                            }
                          }}
                          data-main-pdf-canvas="true"
                          data-page-number={pageNumber}
                          className={cn(
                            'rounded border border-border-primary shadow-lg',
                            !isRendered && 'opacity-0'
                          )}
                        />

                        {showHighlights && dimensions ? (
                          <DocumentHighlightOverlay
                            highlights={pageHighlights}
                            dimensions={dimensions}
                            onHighlightClick={onHighlightClick}
                            renderHighlightContent={renderHighlightContent}
                          />
                        ) : null}

                        {dimensions && renderPageOverlay ? (
                          <div className="absolute inset-0 z-20" style={{ pointerEvents: pageOverlayInteractive ? 'auto' : 'none' }}>
                            {renderPageOverlay({ pageNumber, ...dimensions })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="inline-flex min-h-full min-w-full items-center justify-center">
                <div className="relative">
                  {isPdfLoading ? (
                    <div className="absolute inset-0 z-10 flex min-h-[360px] min-w-[260px] items-center justify-center rounded bg-background-tertiary sm:min-h-[800px] sm:min-w-[600px]">
                      <RefreshCw className="h-6 w-6 animate-spin text-text-muted" />
                      <span className="ml-3 text-text-secondary">Loading PDF...</span>
                    </div>
                  ) : null}

                  <canvas
                    ref={canvasRef}
                    data-main-pdf-canvas="true"
                    className={cn(
                      'rounded border border-border-primary shadow-lg',
                      isPdfLoading && 'opacity-0'
                    )}
                  />

                  {showHighlights && !isPdfLoading ? (
                    <DocumentHighlightOverlay
                      highlights={currentHighlights}
                      dimensions={canvasDimensions}
                      onHighlightClick={onHighlightClick}
                      renderHighlightContent={renderHighlightContent}
                    />
                  ) : null}

                  {!isPdfLoading && renderPageOverlay ? (
                    <div className="absolute inset-0 z-20" style={{ pointerEvents: pageOverlayInteractive ? 'auto' : 'none' }}>
                      {renderPageOverlay({ pageNumber: currentPage, ...canvasDimensions })}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Right navigation bar - sticky full height */}
          {showPageSideNavigation && currentPage < pageCount && (
            <button
              onClick={handleNextPage}
              disabled={isLoading}
              className={cn(
                'sticky top-0 right-0 z-20 self-stretch flex-shrink-0',
                'w-12 hidden sm:flex items-center justify-center',
                'bg-black/5 hover:bg-black/20 dark:bg-white/5 dark:hover:bg-white/20',
                'transition-colors duration-200',
                'disabled:opacity-30 disabled:cursor-not-allowed'
              )}
              title="Next page (→)"
            >
              <ChevronRight className="w-6 h-6 text-text-primary" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Thumbnail Strip (kept for multi-page navigation)
// =============================================================================

export function PageThumbnailStrip({
  documentId,
  currentPage,
  onPageSelect,
  className,
}: {
  documentId: string;
  currentPage: number;
  onPageSelect: (pageNumber: number) => void;
  className?: string;
}) {
  const { data, isLoading } = useDocumentPages(documentId);

  if (isLoading || !data) {
    return null;
  }

  return (
    <div className={cn('flex gap-2 overflow-x-auto py-2 px-1', className)}>
      {data.pages.map((page) => (
        <button
          key={page.id}
          onClick={() => onPageSelect(page.pageNumber)}
          className={cn(
            'relative flex-shrink-0 w-16 h-20 rounded border-2 overflow-hidden transition-all',
            currentPage === page.pageNumber
              ? 'border-oak-primary ring-2 ring-oak-primary/20'
              : 'border-border-primary hover:border-oak-light'
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic page thumbnails with unknown dimensions */}
          <img
            src={page.imageUrl}
            alt={`Page ${page.pageNumber}`}
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs text-center py-0.5">
            {page.pageNumber}
          </span>
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// Thumbnail Sidebar (vertical, for left side of viewer)
// =============================================================================

interface PageInfo {
  id: string;
  pageNumber: number;
  imageUrl: string;
}

const MIN_SIDEBAR_WIDTH = 80;
const MAX_SIDEBAR_WIDTH = 200;
const DEFAULT_SIDEBAR_WIDTH = 150;
const MOBILE_MIN_SIDEBAR_WIDTH = 40;
const MOBILE_MAX_SIDEBAR_WIDTH = 100;
const MOBILE_DEFAULT_SIDEBAR_WIDTH = 75;
const THUMBNAIL_SCALE = 0.5; // Scale for thumbnail rendering (higher = sharper)

// Component for rendering a single PDF page thumbnail using canvas
function PdfThumbnail({
  pdfUrl,
  pageNumber,
  onLoad,
  onError,
  isLoading,
}: {
  pdfUrl: string;
  pageNumber: number;
  onLoad: () => void;
  onError: () => void;
  isLoading: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const prevPdfUrlRef = useRef(pdfUrl);

  // Use refs to avoid re-running the effect when callbacks change
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);

  // Keep refs updated
  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  });

  // Reset rendered state when pdfUrl changes (cache busting)
  useEffect(() => {
    if (prevPdfUrlRef.current !== pdfUrl) {
      setRendered(false);
      prevPdfUrlRef.current = pdfUrl;
    }
  }, [pdfUrl]);

  useEffect(() => {
    // Skip if already rendered
    if (rendered) return;

    let cancelled = false;

    async function renderThumbnail() {
      try {
        const pdfjs = await getPdfJs();
        const pdfBytes = await fetchPdfBytes(pdfUrl);
        if (cancelled) {
          return;
        }

        const loadingTask = pdfjs.getDocument({ data: pdfBytes });
        const pdf = await loadingTask.promise;

        if (cancelled) {
          pdf.destroy();
          return;
        }

        // Validate page number is within bounds
        if (pageNumber < 1 || pageNumber > pdf.numPages) {
          pdf.destroy();
          onErrorRef.current();
          return;
        }

        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          pdf.destroy();
          return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
          pdf.destroy();
          onErrorRef.current();
          return;
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
          canvas,
        } as Parameters<typeof page.render>[0]).promise;

        if (!cancelled) {
          setRendered(true);
          onLoadRef.current();
        }

        pdf.destroy();
      } catch (err) {
        console.error(`Failed to render thumbnail for page ${pageNumber}:`, err);
        if (!cancelled) {
          onErrorRef.current();
        }
      }
    }

    renderThumbnail();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl, pageNumber, rendered]);

  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background-tertiary">
          <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={cn(
          'w-full h-full object-cover',
          isLoading && 'opacity-0'
        )}
      />
    </>
  );
}

// Sortable thumbnail item wrapper
function SortableThumbnail({
  page,
  displayNumber,
  currentPage,
  onPageSelect,
  onDelete,
  pdfUrl,
  isLoading,
  hasFailed,
  onLoad,
  onError,
  disabled,
  canDelete,
  markers,
}: {
  page: PageInfo;
  displayNumber: number; // Visual position in the list (1-indexed)
  currentPage: number;
  onPageSelect: (pageNumber: number) => void;
  onDelete?: (pageNumber: number) => void;
  pdfUrl?: string;
  isLoading: boolean;
  hasFailed: boolean;
  onLoad: () => void;
  onError: () => void;
  disabled?: boolean;
  canDelete?: boolean;
  markers?: DocumentPageThumbnailMarker[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : undefined,
  };

  const usePdfThumbnails = !!pdfUrl;

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onDelete && canDelete) {
      onDelete(page.pageNumber);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => !isDragging && onPageSelect(displayNumber)}
      role="button"
      tabIndex={0}
      className={cn(
        'group relative w-full aspect-[3/4] rounded border-2 overflow-hidden transition-all',
        'hover:scale-[1.02] cursor-grab active:cursor-grabbing',
        currentPage === displayNumber
          ? 'border-oak-primary ring-2 ring-oak-primary/30 shadow-md'
          : 'border-border-primary hover:border-oak-light',
        isDragging && 'shadow-lg ring-2 ring-oak-primary'
      )}
    >
      {/* Delete button - appears on hover */}
      {canDelete && onDelete && !isDragging && (
        <button
          onClick={handleDeleteClick}
          className={cn(
            'absolute top-1 right-1 z-10 p-1 rounded',
            'bg-red-500/80 hover:bg-red-600 text-white',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-400'
          )}
          title="Delete page"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}

      {/* Show placeholder if image failed to load */}
      {hasFailed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background-tertiary">
          <FileText className="w-8 h-8 text-text-muted" />
        </div>
      ) : usePdfThumbnails ? (
        <PdfThumbnail
          pdfUrl={pdfUrl}
          pageNumber={displayNumber}
          isLoading={isLoading}
          onLoad={onLoad}
          onError={onError}
        />
      ) : (
        <>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background-tertiary">
              <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.imageUrl}
            alt={`Page ${page.pageNumber}`}
            className={cn('w-full h-full object-cover', isLoading && 'opacity-0')}
            onLoad={onLoad}
            onError={onError}
          />
        </>
      )}
      {markers?.map((marker, index) => (
        <span
          key={`field-marker-${displayNumber}-${index}`}
          className="pointer-events-none absolute z-[5] rounded-[2px] border"
          style={{
            left: `${Math.max(0, Math.min(1, marker.x)) * 100}%`,
            top: `${Math.max(0, Math.min(1, marker.y)) * 100}%`,
            width: `${Math.max(0.015, Math.min(1, marker.width)) * 100}%`,
            height: `${Math.max(0.012, Math.min(1, marker.height)) * 100}%`,
            borderColor: marker.color ?? '#294d44',
            backgroundColor: `${marker.color ?? '#294d44'}33`,
          }}
        />
      ))}
      <span className={cn(
        'absolute bottom-0 left-0 right-0 text-white text-xs text-center py-0.5',
        currentPage === displayNumber ? 'bg-oak-primary' : 'bg-black/60'
      )}>
        {displayNumber}
      </span>
    </div>
  );
}

// Accepted file types for appending
const APPEND_ACCEPT = '.pdf,.png,.jpg,.jpeg,.tiff,.tif';
const APPEND_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'];

export function PageThumbnailSidebar({
  pages,
  currentPage,
  onPageSelect,
  pdfUrl,
  className,
  documentId,
  documentStatus,
  isPdf = true,
  onPagesChanged,
  thumbnailMarkers = [],
}: {
  pages: PageInfo[];
  currentPage: number;
  onPageSelect: (pageNumber: number) => void;
  pdfUrl?: string;
  className?: string;
  documentId?: string;
  documentStatus?: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  isPdf?: boolean;
  onPagesChanged?: () => void;
  thumbnailMarkers?: DocumentPageThumbnailMarker[];
}) {
  const isMobile = useIsMobile();
  const minSidebarWidth = isMobile ? MOBILE_MIN_SIDEBAR_WIDTH : MIN_SIDEBAR_WIDTH;
  const maxSidebarWidth = isMobile ? MOBILE_MAX_SIDEBAR_WIDTH : MAX_SIDEBAR_WIDTH;
  const defaultSidebarWidth = isMobile ? MOBILE_DEFAULT_SIDEBAR_WIDTH : DEFAULT_SIDEBAR_WIDTH;

  const [width, setWidth] = useState(() => defaultSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const wasMobileRef = useRef(isMobile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [loadingImages, setLoadingImages] = useState<Set<string>>(() => new Set(pages.map(p => p.id)));

  // Local state for optimistic reordering
  const [localPages, setLocalPages] = useState(pages);
  const [showApprovedConfirm, setShowApprovedConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<'append' | 'reorder' | 'delete' | null>(null);
  const [pendingReorderData, setPendingReorderData] = useState<number[] | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [pendingDeletePageNumber, setPendingDeletePageNumber] = useState<number | null>(null);

  // Mutations
  const appendPages = useAppendPages();
  const reorderPages = useReorderPages();
  const deletePagesMutation = useDeletePages();

  const isOperationPending = appendPages.isPending || reorderPages.isPending || deletePagesMutation.isPending;

  // Sync local pages with props and reset loading state for new pages
  useEffect(() => {
    setLocalPages(pages);
    // Reset loading state - mark all pages as loading, they'll clear as they render
    setLoadingImages(new Set(pages.map(p => p.id)));
    // Clear failed state since we have fresh data
    setFailedImages(new Set());
  }, [pages]);

  // Keep sidebar width within device-specific bounds (mobile vs desktop).
  // When crossing breakpoints, reset to that mode's default width.
  useEffect(() => {
    if (wasMobileRef.current !== isMobile) {
      wasMobileRef.current = isMobile;
      setWidth(defaultSidebarWidth);
      return;
    }

    setWidth((prev) => Math.min(maxSidebarWidth, Math.max(minSidebarWidth, prev)));
  }, [isMobile, defaultSidebarWidth, minSidebarWidth, maxSidebarWidth]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Page IDs for sortable context
  const pageIds = useMemo(() => localPages.map((p) => p.id), [localPages]);

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id || !documentId || !isPdf) return;

      const oldIndex = localPages.findIndex((p) => p.id === active.id);
      const newIndex = localPages.findIndex((p) => p.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      // Calculate new order (1-indexed page numbers in new order)
      const reorderedPages = arrayMove(localPages, oldIndex, newIndex);
      const newOrder = reorderedPages.map((p) => p.pageNumber);

      // Check if approved - show confirmation
      if (documentStatus === 'APPROVED') {
        setPendingAction('reorder');
        setPendingReorderData(newOrder);
        setShowApprovedConfirm(true);
        return;
      }

      // Execute reorder
      executeReorder(reorderedPages, newOrder);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executeReorder is defined after handleDragEnd
    [localPages, documentId, isPdf, documentStatus]
  );

  const executeReorder = useCallback(
    (reorderedPages: PageInfo[], newOrder: number[]) => {
      if (!documentId) return;

      // Optimistic update - just reorder the array, keep original pageNumbers for PDF rendering
      // The visual page number badge will be calculated from array position
      setLocalPages(reorderedPages);

      // Call API
      reorderPages.mutate(
        { documentId, newOrder },
        {
          onSuccess: () => {
            onPagesChanged?.();
          },
          onError: () => {
            // Revert optimistic update
            setLocalPages(pages);
          },
        }
      );
    },
    [documentId, pages, reorderPages, onPagesChanged]
  );

  // Handle files for append (from file input or paste)
  const handleFilesForAppend = useCallback(
    (files: File[]) => {
      if (files.length === 0 || !documentId) return;

      // Check if approved - show confirmation
      if (documentStatus === 'APPROVED') {
        setPendingFiles(files);
        setPendingAction('append');
        setShowApprovedConfirm(true);
        return;
      }

      // Execute append
      executeAppend(files);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executeAppend is defined after handleFilesForAppend
    [documentId, documentStatus]
  );

  // Handle file selection for append
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      handleFilesForAppend(Array.from(files));
    },
    [handleFilesForAppend]
  );

  // Handle paste event for appending files
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!documentId || !isPdf || isOperationPending) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && APPEND_MIME_TYPES.includes(item.type)) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        handleFilesForAppend(files);
      }
    },
    [documentId, isPdf, isOperationPending, handleFilesForAppend]
  );

  // Add paste listener to sidebar
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar || !documentId || !isPdf) return;

    sidebar.addEventListener('paste', handlePaste);
    return () => sidebar.removeEventListener('paste', handlePaste);
  }, [handlePaste, documentId, isPdf]);

  const executeAppend = useCallback(
    (files: File[]) => {
      if (!documentId) return;

      appendPages.mutate(
        { documentId, files },
        {
          onSuccess: () => {
            onPagesChanged?.();
            // Clear file input
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
          },
          onError: () => {
            // Clear file input on error too
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
          },
        }
      );
    },
    [documentId, appendPages, onPagesChanged]
  );

  // Handle delete page request
  const handleDeletePage = useCallback(
    (pageNumber: number) => {
      if (!documentId || localPages.length <= 1) return;

      // Check if approved - show approval confirmation first
      if (documentStatus === 'APPROVED') {
        setPendingDeletePageNumber(pageNumber);
        setPendingAction('delete');
        setShowApprovedConfirm(true);
        return;
      }

      // Show delete confirmation
      setPendingDeletePageNumber(pageNumber);
      setShowDeleteConfirm(true);
    },
    [documentId, localPages.length, documentStatus]
  );

  // Execute delete after confirmation
  const executeDelete = useCallback(
    (pageNumber: number) => {
      if (!documentId) return;

      deletePagesMutation.mutate(
        { documentId, pageNumbers: [pageNumber] },
        {
          onSuccess: () => {
            onPagesChanged?.();
          },
        }
      );
    },
    [documentId, deletePagesMutation, onPagesChanged]
  );

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    if (pendingDeletePageNumber !== null) {
      executeDelete(pendingDeletePageNumber);
    }
    setPendingDeletePageNumber(null);
  }, [pendingDeletePageNumber, executeDelete]);

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false);
    setPendingDeletePageNumber(null);
  }, []);

  // Handle confirmation for approved documents
  const handleApprovedConfirm = useCallback(() => {
    setShowApprovedConfirm(false);

    if (pendingAction === 'reorder' && pendingReorderData) {
      // Reconstruct reordered pages from newOrder
      const reorderedPages = pendingReorderData.map((pageNum) =>
        localPages.find((p) => p.pageNumber === pageNum)!
      );
      executeReorder(reorderedPages, pendingReorderData);
    } else if (pendingAction === 'append' && pendingFiles) {
      executeAppend(pendingFiles);
    } else if (pendingAction === 'delete' && pendingDeletePageNumber !== null) {
      // For delete, show the delete confirmation dialog next
      setShowDeleteConfirm(true);
      // Don't clear pendingDeletePageNumber - we need it for the delete dialog
      setPendingAction(null);
      setPendingReorderData(null);
      setPendingFiles(null);
      return;
    }

    setPendingAction(null);
    setPendingReorderData(null);
    setPendingFiles(null);
    setPendingDeletePageNumber(null);
  }, [pendingAction, pendingReorderData, pendingFiles, pendingDeletePageNumber, localPages, executeReorder, executeAppend]);

  const handleApprovedCancel = useCallback(() => {
    setShowApprovedConfirm(false);
    setPendingAction(null);
    setPendingReorderData(null);
    setPendingFiles(null);
    setPendingDeletePageNumber(null);
    // Clear file input if append was cancelled
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Handle resize drag
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      setWidth(Math.min(maxSidebarWidth, Math.max(minSidebarWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, minSidebarWidth, maxSidebarWidth]);

  if (pages.length === 0 && !documentId) {
    return null;
  }

  const canModify = !!documentId && isPdf;

  return (
    <>
      <div
        ref={sidebarRef}
        tabIndex={canModify ? 0 : undefined}
        className={cn(
          'flex-shrink-0 bg-background-tertiary border-r border-border-primary',
          'flex relative focus:outline-none',
          isResizing && 'select-none',
          className
        )}
        style={{ width }}
      >
        {/* Loading overlay */}
        {isOperationPending && (
          <div className="absolute inset-0 bg-background-tertiary/80 z-50 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-oak-primary" />
          </div>
        )}

        {/* Thumbnails container */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex flex-col gap-1.5 p-1.5 sm:gap-2 sm:p-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={pageIds} strategy={verticalListSortingStrategy}>
                {localPages.map((page, index) => (
                  <SortableThumbnail
                    key={page.id}
                    page={page}
                    displayNumber={index + 1}
                    currentPage={currentPage}
                    onPageSelect={onPageSelect}
                    onDelete={handleDeletePage}
                    pdfUrl={pdfUrl}
                    isLoading={loadingImages.has(page.id)}
                    hasFailed={failedImages.has(page.id)}
                    onLoad={() => {
                      setLoadingImages((prev) => {
                        const next = new Set(prev);
                        next.delete(page.id);
                        return next;
                      });
                    }}
                    onError={() => {
                      setLoadingImages((prev) => {
                        const next = new Set(prev);
                        next.delete(page.id);
                        return next;
                      });
                      setFailedImages((prev) => new Set(prev).add(page.id));
                    }}
                    disabled={!canModify || isOperationPending}
                    canDelete={canModify && localPages.length > 1 && !isOperationPending}
                    markers={thumbnailMarkers.filter((marker) => marker.pageNumber === index + 1)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {/* Append button */}
            {canModify && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={APPEND_ACCEPT}
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isOperationPending}
                  className={cn(
                    'relative w-full aspect-[3/4] rounded border-2 border-dashed overflow-hidden transition-all',
                    'flex items-center justify-center',
                    'border-border-secondary hover:border-oak-light hover:bg-oak-primary/5',
                    'text-text-muted hover:text-oak-primary',
                    isOperationPending && 'opacity-50 cursor-not-allowed'
                  )}
                  title="Add pages (PDF, PNG, JPEG, TIFF) - or Ctrl+V to paste"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className={cn(
            'absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hidden md:block',
            'hover:bg-oak-primary/30 transition-colors',
            isResizing && 'bg-oak-primary/50'
          )}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
        />
      </div>

      {/* Confirmation dialog for approved documents */}
      <ConfirmDialog
        isOpen={showApprovedConfirm}
        onClose={handleApprovedCancel}
        onConfirm={handleApprovedConfirm}
        title="Modify Approved Document"
        description={
          pendingAction === 'append'
            ? 'This document is approved. Adding pages will not change the approved extraction data. You can re-extract if needed after adding pages.'
            : pendingAction === 'delete'
            ? 'This document is approved. Deleting pages will not change the approved extraction data. You can re-extract if needed after deleting.'
            : 'This document is approved. Reordering pages will not change the approved extraction data. You can re-extract if needed after reordering.'
        }
        confirmLabel="Continue"
        cancelLabel="Cancel"
        variant="warning"
      />

      {/* Confirmation dialog for delete */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title="Delete Page"
        description={`Are you sure you want to delete page ${pendingDeletePageNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </>
  );
}

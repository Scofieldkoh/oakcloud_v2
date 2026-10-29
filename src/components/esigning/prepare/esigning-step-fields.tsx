'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, List, Palette, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useIsMobile, useIsTablet } from '@/hooks/use-media-query';
import type { EsigningFieldType } from '@/generated/prisma';
import type { EsigningEnvelopeDetailDto } from '@/types/esigning';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Modal } from '@/components/ui/modal';
import { DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS } from '@/components/processing/document-page-viewer';
import { ESIGNING_FIELD_TYPE_LABELS } from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';
import { EsigningFieldPalette } from './esigning-field-palette';
import {
  EsigningFieldCanvas,
  detectFieldOverlaps,
  type PlacedField,
} from './esigning-field-canvas';

interface EsigningStepFieldsProps {
  envelope: EsigningEnvelopeDetailDto;
  fields: PlacedField[];
  onFieldsChange: (
    fields: PlacedField[],
    options?: { recordHistory?: boolean; historySnapshot?: PlacedField[] }
  ) => void;
  onSaveFields: () => Promise<void>;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNext: () => void;
  onBack: () => void;
  canEdit: boolean;
}

const DEFAULT_LEFT_PANEL_WIDTH = 280;
const DEFAULT_RIGHT_PANEL_WIDTH = 300;
const TABLET_LEFT_PANEL_WIDTH = 220;
const TABLET_RIGHT_PANEL_WIDTH = 240;
const PANEL_COLLAPSED_WIDTH = 44;
const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 420;
const PANEL_MIN_CENTER_WIDTH = 480;

export function EsigningStepFields({
  envelope,
  fields,
  onFieldsChange,
  onSaveFields,
  isSaving,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onNext,
  onBack,
  canEdit,
}: EsigningStepFieldsProps) {
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>(
    () => envelope.recipients.find((recipient) => recipient.type === 'SIGNER')?.id ?? ''
  );
  const [activePlacementType, setActivePlacementType] = useState<EsigningFieldType | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>(
    () => envelope.documents[0]?.id ?? ''
  );
  const [overlapWarningDismissed, setOverlapWarningDismissed] = useState(false);
  const [showCoachmarks, setShowCoachmarks] = useState(false);
  const [preparationZoom, setPreparationZoom] = useState<number>(
    DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS[6] ?? 1.5
  );
  const [leftPanelWidth, setLeftPanelWidth] = useState(DEFAULT_LEFT_PANEL_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(DEFAULT_RIGHT_PANEL_WIDTH);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'palette' | 'details' | null>(null);
  const [activeResizePanel, setActiveResizePanel] = useState<'left' | 'right' | null>(null);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{
    panel: 'left' | 'right';
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (isMobile) {
      setLeftPanelCollapsed(true);
      setRightPanelCollapsed(true);
      setMobilePanel(null);
      return;
    }
    if (isTablet) {
      // Tablet: keep palette accessible but collapse properties panel and tighten widths
      setLeftPanelWidth(TABLET_LEFT_PANEL_WIDTH);
      setRightPanelWidth(TABLET_RIGHT_PANEL_WIDTH);
      setRightPanelCollapsed(true);
    }
  }, [isMobile, isTablet]);

  function handleMobilePlacementTypeSelect(type: EsigningFieldType | null) {
    setActivePlacementType(type);
    if (type) {
      setMobilePanel(null);
    }
  }

  const recipientFieldSummary = useMemo(() => {
    const map = new Map<string, { required: number; optional: number; hasSignature: boolean }>();

    for (const recipient of envelope.recipients.filter((entry) => entry.type === 'SIGNER')) {
      const recipientFields = fields.filter((field) => field.recipientId === recipient.id);
      const activeDocIds = [...new Set(recipientFields.map((f) => f.documentId))];
      const hasSignatureOnAllDocs =
        activeDocIds.length > 0 &&
        activeDocIds.every((docId) =>
          recipientFields.some(
            (f) => f.documentId === docId && (f.type === 'SIGNATURE' || f.type === 'INITIALS')
          )
        );
      map.set(recipient.id, {
        required: recipientFields.filter((field) => field.required).length,
        optional: recipientFields.filter((field) => !field.required).length,
        hasSignature: hasSignatureOnAllDocs,
      });
    }

    return map;
  }, [fields, envelope.recipients]);

  const signerRecipients = envelope.recipients.filter((recipient) => recipient.type === 'SIGNER');
  const overlapMap = useMemo(() => detectFieldOverlaps(fields), [fields]);
  const preparationZoomIndex = useMemo(
    () =>
      DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS.reduce((closestIndex, zoomOption, index) => {
        const currentDistance = Math.abs(zoomOption - preparationZoom);
        const closestDistance = Math.abs(
          DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS[closestIndex] - preparationZoom
        );
        return currentDistance < closestDistance ? index : closestIndex;
      }, 0),
    [preparationZoom]
  );
  const overlappingFields = useMemo(
    () => fields.filter((field) => overlapMap.has(field.localId)),
    [fields, overlapMap]
  );
  const selectedField = selectedFieldId
    ? fields.find((field) => field.localId === selectedFieldId) ?? null
    : null;
  const canProceedToStep3 =
    signerRecipients.length > 0 &&
    signerRecipients.every((recipient) => {
      const summary = recipientFieldSummary.get(recipient.id);
      return Boolean(summary && summary.required > 0 && summary.hasSignature);
    });

  useEffect(() => {
    if (overlappingFields.length === 0) {
      setOverlapWarningDismissed(false);
    }
  }, [overlappingFields.length]);

  useEffect(() => {
    const coachmarkKey = `esigning-field-coachmarks:${envelope.id}`;
    if (window.localStorage.getItem(coachmarkKey)) {
      return;
    }

    setShowCoachmarks(true);
  }, [envelope.id]);

  useEffect(() => {
    if (!canEdit) {
      return;
    }

    function shouldIgnoreShortcut(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      if (target.isContentEditable) {
        return true;
      }

      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreShortcut(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        setActivePlacementType(null);
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;
      if (!isModifierPressed) {
        return;
      }

      const key = event.key.toLowerCase();
      const wantsUndo = key === 'z' && !event.shiftKey;
      const wantsRedo = (key === 'z' && event.shiftKey) || key === 'y';

      if (wantsUndo && canUndo) {
        event.preventDefault();
        onUndo();
      }

      if (wantsRedo && canRedo) {
        event.preventDefault();
        onRedo();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, canRedo, canUndo, onRedo, onUndo]);

  useEffect(() => {
    if (!activeResizePanel) {
      return;
    }

    function clampWidth(nextWidth: number, panel: 'left' | 'right') {
      const layoutWidth = layoutRef.current?.clientWidth ?? 0;
      const oppositeWidth =
        panel === 'left'
          ? (rightPanelCollapsed ? PANEL_COLLAPSED_WIDTH : rightPanelWidth)
          : (leftPanelCollapsed ? PANEL_COLLAPSED_WIDTH : leftPanelWidth);

      const maxWidth = layoutWidth
        ? Math.max(PANEL_MIN_WIDTH, layoutWidth - oppositeWidth - PANEL_MIN_CENTER_WIDTH)
        : PANEL_MAX_WIDTH;

      return Math.min(Math.max(nextWidth, PANEL_MIN_WIDTH), Math.min(PANEL_MAX_WIDTH, maxWidth));
    }

    function handleMouseMove(event: MouseEvent) {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }

      const delta = event.clientX - state.startX;
      if (state.panel === 'left') {
        setLeftPanelWidth(clampWidth(state.startWidth + delta, 'left'));
      } else {
        setRightPanelWidth(clampWidth(state.startWidth - delta, 'right'));
      }
    }

    function handleMouseUp() {
      resizeStateRef.current = null;
      setActiveResizePanel(null);
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeResizePanel, leftPanelCollapsed, leftPanelWidth, rightPanelCollapsed, rightPanelWidth]);

  function beginPanelResize(panel: 'left' | 'right', event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === 'left' ? leftPanelWidth : rightPanelWidth,
    };
    setActiveResizePanel(panel);
  }

  const rightPanelContent = (
    <>
      {showCoachmarks ? (
        <Alert
          variant="info"
          compact
          className="mb-4"
          title="How to place fields"
          onClose={() => {
            window.localStorage.setItem(`esigning-field-coachmarks:${envelope.id}`, 'dismissed');
            setShowCoachmarks(false);
          }}
        >
          <ol className="mt-1 list-decimal list-inside space-y-0.5 text-xs">
            <li>Select a signer in the left panel.</li>
            <li>Click a field type (e.g. Signature) to activate placement mode.</li>
            <li>Click anywhere on the document to drop the field.</li>
            <li>Drag or resize placed fields to reposition them.</li>
          </ol>
          <p className="mt-1.5 text-xs">Tip: Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z to redo.</p>
        </Alert>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="secondary"
          size="xs"
          leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
          onClick={onUndo}
          disabled={!canUndo}
        >
          Undo
        </Button>
        <Button
          variant="secondary"
          size="xs"
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
          onClick={onRedo}
          disabled={!canRedo}
        >
          Redo
        </Button>
      </div>

      <div className="mb-4 rounded-xl border border-border-primary bg-background-primary p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Zoom</h3>
          <span className="text-xs font-medium text-text-secondary">
            {Math.round(preparationZoom * 100)}%
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            leftIcon={<ZoomOut className="h-3.5 w-3.5" />}
            onClick={() =>
              setPreparationZoom(
                DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS[Math.max(0, preparationZoomIndex - 1)]
              )
            }
            disabled={preparationZoomIndex === 0}
          >
            Out
          </Button>
          <Button
            variant="secondary"
            size="xs"
            leftIcon={<ZoomIn className="h-3.5 w-3.5" />}
            onClick={() =>
              setPreparationZoom(
                DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS[
                  Math.min(
                    DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS.length - 1,
                    preparationZoomIndex + 1
                  )
                ]
              )
            }
            disabled={preparationZoomIndex === DOCUMENT_PAGE_VIEWER_ZOOM_LEVELS.length - 1}
          >
            In
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[1, 1.5, 2].map((zoomPreset) => (
            <Button
              key={zoomPreset}
              variant={preparationZoom === zoomPreset ? 'primary' : 'secondary'}
              size="xs"
              onClick={() => setPreparationZoom(zoomPreset)}
            >
              {Math.round(zoomPreset * 100)}%
            </Button>
          ))}
        </div>

        <p className="mt-3 text-xs text-text-secondary">
          Use these controls while placing fields, or use the viewer toolbar and +/- shortcuts.
        </p>
      </div>

      {overlappingFields.length > 0 && !overlapWarningDismissed ? (
        <Alert
          variant="warning"
          compact
          className="mb-4"
          title="Overlapping fields detected"
          onClose={() => setOverlapWarningDismissed(true)}
        >
          {overlappingFields.length} field{overlappingFields.length === 1 ? '' : 's'} overlap on the current layout. Review before sending so signers do not run into competing targets.
        </Alert>
      ) : null}

      {selectedField ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Field Properties</h3>
            <Button
              variant="danger"
              size="xs"
              onClick={() => {
                onFieldsChange(fields.filter((field) => field.localId !== selectedField.localId));
                setSelectedFieldId(null);
              }}
            >
              Delete
            </Button>
          </div>

          <div className="text-xs text-text-secondary">
            Type: {ESIGNING_FIELD_TYPE_LABELS[selectedField.type]}
          </div>

          {overlapMap.has(selectedField.localId) ? (
            <Alert variant="warning" compact>
              This field overlaps another field on the same page.
            </Alert>
          ) : null}

          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Assigned to
            <select
              value={selectedField.recipientId}
              onChange={(event) =>
                onFieldsChange(
                  fields.map((field) =>
                    field.localId === selectedField.localId
                      ? { ...field, recipientId: event.target.value }
                      : field
                  )
                )
              }
              className="h-7 rounded border border-border-primary bg-background-primary px-2 text-xs text-text-primary"
            >
              {signerRecipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Label
            <input
              value={selectedField.label ?? ''}
              onChange={(event) =>
                onFieldsChange(
                  fields.map((field) =>
                    field.localId === selectedField.localId
                      ? { ...field, label: event.target.value || null }
                      : field
                  )
                )
              }
              className="h-7 rounded border border-border-primary bg-background-primary px-2 text-xs text-text-primary"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={selectedField.required}
              onChange={(event) =>
                onFieldsChange(
                  fields.map((field) =>
                    field.localId === selectedField.localId
                      ? { ...field, required: event.target.checked }
                      : field
                  )
                )
              }
            />
            Required
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">Field Coverage</h3>
          {signerRecipients.map((recipient) => {
            const summary = recipientFieldSummary.get(recipient.id);
            const hasIssue = !summary?.hasSignature;

            return (
              <div
                key={recipient.id}
                className="rounded-xl border border-border-primary bg-background-primary p-2"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: recipient.colorTag }}
                  />
                  <span className="truncate text-xs font-medium text-text-primary">
                    {recipient.name}
                  </span>
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {summary?.required ?? 0} required · {summary?.optional ?? 0} optional
                </div>
                {hasIssue && (
                  <div className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-600">
                    <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                    No signature field assigned
                  </div>
                )}
              </div>
            );
          })}

          {fields.length === 0 ? (
            <p className="text-xs text-text-secondary">
              Select a field type in the palette, then click on the document to place it.
            </p>
          ) : null}
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isMobile ? (
        <>
          <div className="relative flex-1 overflow-hidden">
            <EsigningFieldCanvas
              documents={envelope.documents}
              selectedDocumentId={selectedDocumentId}
              onDocumentChange={(documentId) => {
                setSelectedDocumentId(documentId);
                setViewerPage(1);
              }}
              fields={fields}
              onFieldsChange={onFieldsChange}
              selectedFieldId={selectedFieldId}
              onFieldSelect={setSelectedFieldId}
              placementType={activePlacementType}
              placementRecipientId={selectedRecipientId}
              recipients={envelope.recipients}
              viewerPage={viewerPage}
              onPageChange={setViewerPage}
              zoomLevel={preparationZoom}
              onZoomLevelChange={setPreparationZoom}
              canEdit={canEdit}
            />
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 border-t border-border-primary bg-background-secondary px-3 py-2">
            <button
              type="button"
              onClick={() => setMobilePanel('palette')}
              aria-label="Open field palette"
              className="flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-xl border border-border-primary bg-background-primary text-text-primary hover:bg-background-tertiary"
            >
              <Palette className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setMobilePanel('details')}
              aria-label="Open field details"
              className="flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-xl border border-border-primary bg-background-primary text-text-primary hover:bg-background-tertiary"
            >
              <List className="h-5 w-5" />
            </button>
            <div className="ml-auto truncate text-xs text-text-secondary">
              {activePlacementType
                ? `Placing: ${ESIGNING_FIELD_TYPE_LABELS[activePlacementType]}`
                : 'No field selected'}
            </div>
          </div>

          <Modal
            isOpen={mobilePanel === 'palette'}
            onClose={() => setMobilePanel(null)}
            title="Field palette"
            placement="bottom"
            size="full"
          >
            <div className="max-h-[70vh] overflow-y-auto">
              <EsigningFieldPalette
                recipients={envelope.recipients}
                selectedRecipientId={selectedRecipientId}
                onRecipientChange={setSelectedRecipientId}
                activePlacementType={activePlacementType}
                onPlacementTypeSelect={handleMobilePlacementTypeSelect}
                recipientFieldSummary={recipientFieldSummary}
              />
            </div>
          </Modal>

          <Modal
            isOpen={mobilePanel === 'details'}
            onClose={() => setMobilePanel(null)}
            title="Field details"
            placement="bottom"
            size="full"
          >
            <div className="max-h-[70vh] overflow-y-auto p-4">{rightPanelContent}</div>
          </Modal>
        </>
      ) : (
        <div ref={layoutRef} className="flex flex-1 overflow-hidden">
        <div
          className={cn(
            'relative flex-shrink-0 overflow-hidden transition-[width] duration-200',
            activeResizePanel && 'duration-0'
          )}
          style={{ width: leftPanelCollapsed ? PANEL_COLLAPSED_WIDTH : leftPanelWidth }}
        >
          {leftPanelCollapsed ? (
            <div className="flex h-full items-start justify-center border-r border-border-primary bg-background-secondary pt-4">
              <button
                type="button"
                onClick={() => setLeftPanelCollapsed(false)}
                className="rounded-lg border border-border-primary bg-background-primary p-1.5 text-text-muted hover:bg-background-tertiary hover:text-text-primary"
                aria-label="Expand field palette"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative h-full">
              <button
                type="button"
                onClick={() => setLeftPanelCollapsed(true)}
                className="absolute right-3 top-3 z-10 rounded-lg border border-border-primary bg-background-primary/95 p-1.5 text-text-muted shadow-sm hover:bg-background-tertiary hover:text-text-primary"
                aria-label="Collapse field palette"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <EsigningFieldPalette
                recipients={envelope.recipients}
                selectedRecipientId={selectedRecipientId}
                onRecipientChange={setSelectedRecipientId}
                activePlacementType={activePlacementType}
                onPlacementTypeSelect={setActivePlacementType}
                recipientFieldSummary={recipientFieldSummary}
              />
            </div>
          )}
        </div>

        {!leftPanelCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
            onMouseDown={(event) => beginPanelResize('left', event)}
            className="group flex w-3 flex-shrink-0 cursor-col-resize items-center justify-center bg-background-primary"
          >
            <div className="h-16 w-1 rounded-full bg-border-primary transition-colors group-hover:bg-oak-primary" />
          </div>
        ) : null}

        <div className="min-w-0 flex-1 overflow-hidden">
          <EsigningFieldCanvas
            documents={envelope.documents}
            selectedDocumentId={selectedDocumentId}
            onDocumentChange={(documentId) => {
              setSelectedDocumentId(documentId);
              setViewerPage(1);
            }}
            fields={fields}
            onFieldsChange={onFieldsChange}
            selectedFieldId={selectedFieldId}
            onFieldSelect={setSelectedFieldId}
            placementType={activePlacementType}
            placementRecipientId={selectedRecipientId}
            recipients={envelope.recipients}
            viewerPage={viewerPage}
            onPageChange={setViewerPage}
            zoomLevel={preparationZoom}
            onZoomLevelChange={setPreparationZoom}
            canEdit={canEdit}
          />
        </div>

        {!rightPanelCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            onMouseDown={(event) => beginPanelResize('right', event)}
            className="group flex w-3 flex-shrink-0 cursor-col-resize items-center justify-center bg-background-primary"
          >
            <div className="h-16 w-1 rounded-full bg-border-primary transition-colors group-hover:bg-oak-primary" />
          </div>
        ) : null}

        <div
          className={cn(
            'relative flex-shrink-0 overflow-hidden transition-[width] duration-200',
            activeResizePanel && 'duration-0'
          )}
          style={{ width: rightPanelCollapsed ? PANEL_COLLAPSED_WIDTH : rightPanelWidth }}
        >
          {rightPanelCollapsed ? (
            <div className="flex h-full items-start justify-center border-l border-border-primary bg-background-secondary pt-4">
              <button
                type="button"
                onClick={() => setRightPanelCollapsed(false)}
                className="rounded-lg border border-border-primary bg-background-primary p-1.5 text-text-muted hover:bg-background-tertiary hover:text-text-primary"
                aria-label="Expand field details"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative h-full overflow-y-auto border-l border-border-primary bg-background-secondary p-4 pt-12">
              <button
                type="button"
                onClick={() => setRightPanelCollapsed(true)}
                className="absolute left-3 top-3 z-10 rounded-lg border border-border-primary bg-background-primary/95 p-1.5 text-text-muted shadow-sm hover:bg-background-tertiary hover:text-text-primary"
                aria-label="Collapse field details"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {rightPanelContent}
            </div>
          )}
        </div>
        </div>
      )}

      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border-primary bg-background-secondary px-3 py-2 sm:gap-4 sm:px-6 sm:py-3">
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back
        </Button>

        <div className="flex items-center gap-2 sm:gap-3">
          <Button variant="secondary" size="sm" onClick={() => void onSaveFields()} isLoading={isSaving}>
            Save
          </Button>
          <Button size="sm" onClick={onNext} disabled={!canProceedToStep3}>
            <span className="hidden sm:inline">Next: Review & Send</span>
            <span className="sm:hidden">Next</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

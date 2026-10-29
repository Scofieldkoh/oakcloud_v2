'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EsigningFieldType } from '@/generated/prisma';
import type { EsigningEnvelopeDocumentDto, EsigningEnvelopeRecipientDto } from '@/types/esigning';
import type { EsigningFieldDefinitionInput } from '@/lib/validations/esigning';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import {
  DocumentPageViewer,
  type DocumentPageOverlayContext,
} from '@/components/processing/document-page-viewer';
import { buildFieldHighlights, ESIGNING_FIELD_TYPE_LABELS } from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';

export interface PlacedField extends EsigningFieldDefinitionInput {
  localId: string;
}

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

interface CanvasGuides {
  vertical: number[];
  horizontal: number[];
}

interface FieldChangeOptions {
  recordHistory?: boolean;
  historySnapshot?: PlacedField[];
}

type CanvasInteraction =
  | {
      kind: 'drag';
      fieldId: string;
      startClientX: number;
      startClientY: number;
      fieldSnapshot: PlacedField;
      canvasWidth: number;
      canvasHeight: number;
      selectedFieldIds: string[];
      selectionSnapshots: PlacedField[];
      allFieldsSnapshot: PlacedField[];
    }
  | {
      kind: 'resize';
      fieldId: string;
      handle: ResizeHandle;
      startClientX: number;
      startClientY: number;
      fieldSnapshot: PlacedField;
      canvasWidth: number;
      canvasHeight: number;
      allFieldsSnapshot: PlacedField[];
    };

const SNAP_THRESHOLD = 0.01;
export const NUDGE_STEP = 0.005;
export const LARGE_NUDGE_STEP = 0.02;

const DEFAULT_FIELD_SIZES: Record<EsigningFieldType, { w: number; h: number }> = {
  SIGNATURE: { w: 0.24, h: 0.08 },
  INITIALS: { w: 0.12, h: 0.06 },
  DATE_SIGNED: { w: 0.18, h: 0.04 },
  NAME: { w: 0.2, h: 0.04 },
  TEXT: { w: 0.2, h: 0.04 },
  COMPANY: { w: 0.2, h: 0.04 },
  TITLE: { w: 0.2, h: 0.04 },
  CHECKBOX: { w: 0.03, h: 0.03 },
};

interface EsigningFieldCanvasProps {
  documents: EsigningEnvelopeDocumentDto[];
  selectedDocumentId: string;
  onDocumentChange: (documentId: string) => void;
  fields: PlacedField[];
  onFieldsChange: (fields: PlacedField[], options?: FieldChangeOptions) => void;
  selectedFieldId: string | null;
  onFieldSelect: (fieldId: string | null) => void;
  placementType: EsigningFieldType | null;
  placementRecipientId: string;
  recipients: EsigningEnvelopeRecipientDto[];
  viewerPage: number;
  onPageChange: (page: number) => void;
  zoomLevel?: number;
  onZoomLevelChange?: (zoomLevel: number) => void;
  canEdit: boolean;
}

interface PlacedFieldChipProps {
  field: PlacedField;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  hasOverlap: boolean;
  canEdit: boolean;
  recipients: EsigningEnvelopeRecipientDto[];
  onSelect: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDelete: () => void;
  onBeginDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBeginResize: (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeFieldPosition(field: PlacedField): PlacedField {
  const widthPercent = clamp(field.widthPercent, ESIGNING_LIMITS.MIN_FIELD_WIDTH, 1);
  const heightPercent = clamp(field.heightPercent, ESIGNING_LIMITS.MIN_FIELD_HEIGHT, 1);
  const xPercent = clamp(field.xPercent, 0, 1 - widthPercent);
  const yPercent = clamp(field.yPercent, 0, 1 - heightPercent);

  return {
    ...field,
    xPercent,
    yPercent,
    widthPercent,
    heightPercent,
  };
}

function areFieldCollectionsEqual(left: PlacedField[], right: PlacedField[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((field, index) => {
    const other = right[index];
    if (!other) {
      return false;
    }

    return (
      field.localId === other.localId &&
      field.documentId === other.documentId &&
      field.recipientId === other.recipientId &&
      field.type === other.type &&
      field.pageNumber === other.pageNumber &&
      field.xPercent === other.xPercent &&
      field.yPercent === other.yPercent &&
      field.widthPercent === other.widthPercent &&
      field.heightPercent === other.heightPercent &&
      field.required === other.required &&
      field.label === other.label &&
      field.placeholder === other.placeholder &&
      field.sortOrder === other.sortOrder
    );
  });
}

function fieldsOverlap(left: PlacedField, right: PlacedField): boolean {
  if (left.localId === right.localId) {
    return false;
  }
  if (left.documentId !== right.documentId || left.pageNumber !== right.pageNumber) {
    return false;
  }

  const leftRight = left.xPercent + left.widthPercent;
  const rightRight = right.xPercent + right.widthPercent;
  const leftBottom = left.yPercent + left.heightPercent;
  const rightBottom = right.yPercent + right.heightPercent;

  return !(
    leftRight <= right.xPercent ||
    rightRight <= left.xPercent ||
    leftBottom <= right.yPercent ||
    rightBottom <= left.yPercent
  );
}

export function detectFieldOverlaps(fields: PlacedField[]): Map<string, string[]> {
  const overlapMap = new Map<string, Set<string>>();

  for (let i = 0; i < fields.length; i += 1) {
    for (let j = i + 1; j < fields.length; j += 1) {
      const left = fields[i];
      const right = fields[j];
      if (!fieldsOverlap(left, right)) {
        continue;
      }

      const leftSet = overlapMap.get(left.localId) ?? new Set<string>();
      leftSet.add(right.localId);
      overlapMap.set(left.localId, leftSet);

      const rightSet = overlapMap.get(right.localId) ?? new Set<string>();
      rightSet.add(left.localId);
      overlapMap.set(right.localId, rightSet);
    }
  }

  return new Map(
    [...overlapMap.entries()].map(([fieldId, overlaps]) => [fieldId, [...overlaps].sort()])
  );
}

function snapFieldToGuides(input: {
  field: PlacedField;
  otherFields: PlacedField[];
}): { field: PlacedField; guides: CanvasGuides } {
  const candidatesX = [0, 0.5, 1];
  const candidatesY = [0, 0.5, 1];

  input.otherFields.forEach((field) => {
    candidatesX.push(field.xPercent, field.xPercent + field.widthPercent / 2, field.xPercent + field.widthPercent);
    candidatesY.push(field.yPercent, field.yPercent + field.heightPercent / 2, field.yPercent + field.heightPercent);
  });

  const fieldAnchorsX = [
    { anchor: 'left', value: input.field.xPercent },
    { anchor: 'center', value: input.field.xPercent + input.field.widthPercent / 2 },
    { anchor: 'right', value: input.field.xPercent + input.field.widthPercent },
  ] as const;
  const fieldAnchorsY = [
    { anchor: 'top', value: input.field.yPercent },
    { anchor: 'middle', value: input.field.yPercent + input.field.heightPercent / 2 },
    { anchor: 'bottom', value: input.field.yPercent + input.field.heightPercent },
  ] as const;

  const snappedField = { ...input.field };
  const guides: CanvasGuides = { vertical: [], horizontal: [] };

  let bestX: { candidate: number; anchor: (typeof fieldAnchorsX)[number]['anchor']; distance: number } | null = null;
  for (const candidate of candidatesX) {
    for (const anchor of fieldAnchorsX) {
      const distance = Math.abs(anchor.value - candidate);
      if (distance <= SNAP_THRESHOLD && (!bestX || distance < bestX.distance)) {
        bestX = { candidate, anchor: anchor.anchor, distance };
      }
    }
  }

  if (bestX) {
    if (bestX.anchor === 'left') {
      snappedField.xPercent = bestX.candidate;
    } else if (bestX.anchor === 'center') {
      snappedField.xPercent = bestX.candidate - snappedField.widthPercent / 2;
    } else {
      snappedField.xPercent = bestX.candidate - snappedField.widthPercent;
    }
    guides.vertical.push(bestX.candidate);
  }

  let bestY: { candidate: number; anchor: (typeof fieldAnchorsY)[number]['anchor']; distance: number } | null = null;
  for (const candidate of candidatesY) {
    for (const anchor of fieldAnchorsY) {
      const distance = Math.abs(anchor.value - candidate);
      if (distance <= SNAP_THRESHOLD && (!bestY || distance < bestY.distance)) {
        bestY = { candidate, anchor: anchor.anchor, distance };
      }
    }
  }

  if (bestY) {
    if (bestY.anchor === 'top') {
      snappedField.yPercent = bestY.candidate;
    } else if (bestY.anchor === 'middle') {
      snappedField.yPercent = bestY.candidate - snappedField.heightPercent / 2;
    } else {
      snappedField.yPercent = bestY.candidate - snappedField.heightPercent;
    }
    guides.horizontal.push(bestY.candidate);
  }

  return {
    field: normalizeFieldPosition(snappedField),
    guides,
  };
}

function PlacedFieldChip({
  field,
  canvasWidth,
  canvasHeight,
  isSelected,
  hasOverlap,
  canEdit,
  recipients,
  onSelect,
  onDelete,
  onBeginDrag,
  onBeginResize,
}: PlacedFieldChipProps) {
  const recipient = recipients.find((entry) => entry.id === field.recipientId);
  const accentColor = recipient?.colorTag ?? '#1d4ed8';

  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      onPointerDown={(event) => {
        if (!canEdit || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) {
          return;
        }
        onBeginDrag(event);
      }}
      style={{
        position: 'absolute',
        left: field.xPercent * canvasWidth,
        top: field.yPercent * canvasHeight,
        width: field.widthPercent * canvasWidth,
        height: field.heightPercent * canvasHeight,
        borderColor: hasOverlap ? '#d97706' : accentColor,
        backgroundColor: hasOverlap ? 'rgba(217, 119, 6, 0.14)' : `${accentColor}18`,
        zIndex: isSelected ? 30 : 20,
      }}
      className={cn(
        'pointer-events-auto select-none rounded border-2 shadow-sm transition-shadow',
        canEdit ? 'cursor-move' : 'cursor-pointer',
        isSelected && 'ring-2 ring-oak-primary ring-offset-1',
        hasOverlap && 'shadow-[0_0_0_2px_rgba(217,119,6,0.18)]'
      )}
    >
      <div className="flex h-full items-center justify-center px-1">
        <span
          className="truncate text-xs font-medium"
          style={{ color: hasOverlap ? '#92400e' : accentColor }}
        >
          {ESIGNING_FIELD_TYPE_LABELS[field.type]}
        </span>
      </div>

      {hasOverlap ? (
        <span className="absolute left-1 top-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
          Overlap
        </span>
      ) : null}

      {isSelected && canEdit ? (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white shadow"
          >
            x
          </button>

          {(['nw', 'ne', 'se', 'sw'] as ResizeHandle[]).map((handle) => {
            const handleClasses: Record<ResizeHandle, string> = {
              nw: '-left-1.5 -top-1.5 cursor-nwse-resize',
              ne: '-right-1.5 -top-1.5 cursor-nesw-resize',
              se: '-bottom-1.5 -right-1.5 cursor-nwse-resize',
              sw: '-bottom-1.5 -left-1.5 cursor-nesw-resize',
            };

            return (
              <button
                key={handle}
                type="button"
                onPointerDown={(event) => onBeginResize(event, handle)}
                className={cn(
                  'absolute h-3 w-3 rounded-full border border-white bg-oak-primary shadow',
                  handleClasses[handle]
                )}
                aria-label={`Resize ${ESIGNING_FIELD_TYPE_LABELS[field.type]} field`}
              />
            );
          })}
        </>
      ) : null}
    </div>
  );
}

export function EsigningFieldCanvas({
  documents,
  selectedDocumentId,
  onDocumentChange,
  fields,
  onFieldsChange,
  selectedFieldId,
  onFieldSelect,
  placementType,
  placementRecipientId,
  recipients,
  viewerPage,
  onPageChange,
  zoomLevel,
  onZoomLevelChange,
  canEdit,
}: EsigningFieldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<PlacedField[]>([]);
  const interactionPreviewRef = useRef<PlacedField[] | null>(null);
  const placementPointerStateRef = useRef<{
    pointerId: number;
    pageNumber: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  } | null>(null);
  const [interaction, setInteraction] = useState<CanvasInteraction | null>(null);
  const [selectedFieldIdsInternal, setSelectedFieldIdsInternal] = useState<string[]>(
    selectedFieldId ? [selectedFieldId] : []
  );
  const [ghostPosition, setGhostPosition] = useState<{
    pageNumber: number;
    xPercent: number;
    yPercent: number;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<CanvasGuides>({ vertical: [], horizontal: [] });

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;

  const highlights = buildFieldHighlights(
    fields.map((field) => ({
      ...field,
      id: field.localId,
      label: field.label ?? null,
      placeholder: field.placeholder ?? null,
    })),
    recipients,
    selectedDocumentId,
    selectedFieldId
  );
  const recipientColorMap = new Map(
    recipients.map((recipient) => [recipient.id, recipient.colorTag])
  );
  const thumbnailMarkers = fields
    .filter((field) => field.documentId === selectedDocumentId)
    .map((field) => ({
      pageNumber: field.pageNumber,
      x: field.xPercent,
      y: field.yPercent,
      width: field.widthPercent,
      height: field.heightPercent,
      color:
        field.localId === selectedFieldId
          ? '#f97316'
          : recipientColorMap.get(field.recipientId) ?? '#294d44',
    }));

  const fieldsOnPage = useMemo(
    () =>
      fields.filter(
        (field) => field.documentId === selectedDocumentId && field.pageNumber === viewerPage
      ),
    [fields, selectedDocumentId, viewerPage]
  );
  const overlapsByField = useMemo(() => detectFieldOverlaps(fields), [fields]);

  function canvasOwnsKeyboard(): boolean {
    return Boolean(containerRef.current?.contains(document.activeElement));
  }

  useEffect(() => {
    const visibleFieldIds = new Set(fieldsOnPage.map((field) => field.localId));

    setSelectedFieldIdsInternal((current) => {
      const next = current.filter((fieldId) => visibleFieldIds.has(fieldId));
      return next.length === current.length ? current : next;
    });

    if (selectedFieldId && !visibleFieldIds.has(selectedFieldId)) {
      onFieldSelect(null);
    }
  }, [fieldsOnPage, onFieldSelect, selectedDocumentId, selectedFieldId, viewerPage]);

  useEffect(() => {
    if (!selectedFieldId) {
      setSelectedFieldIdsInternal([]);
      return;
    }

    setSelectedFieldIdsInternal((current) =>
      current.includes(selectedFieldId) ? current : [selectedFieldId]
    );
  }, [selectedFieldId]);

  useEffect(() => {
    if (placementType) {
      return;
    }

    setGhostPosition(null);
    placementPointerStateRef.current = null;
  }, [placementType]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setInteraction(null);
        setSelectedFieldIdsInternal([]);
        setSnapGuides({ vertical: [], horizontal: [] });
        onFieldSelect(null);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onFieldSelect]);

  useEffect(() => {
    if (!interaction || interaction.canvasWidth <= 0 || interaction.canvasHeight <= 0) {
      return;
    }

    const activeInteraction = interaction;

    function updateField(nextField: PlacedField) {
      const nextFields = activeInteraction.allFieldsSnapshot.map((field) =>
        field.localId === activeInteraction.fieldId ? normalizeFieldPosition(nextField) : field
      );
      interactionPreviewRef.current = nextFields;
      onFieldsChange(
        nextFields,
        { recordHistory: false }
      );
    }

    function onPointerMove(event: PointerEvent) {
      if (activeInteraction.kind === 'drag') {
        const deltaX = (event.clientX - activeInteraction.startClientX) / activeInteraction.canvasWidth;
        const deltaY = (event.clientY - activeInteraction.startClientY) / activeInteraction.canvasHeight;
        const otherFields = activeInteraction.allFieldsSnapshot.filter(
          (field) =>
            !activeInteraction.selectedFieldIds.includes(field.localId) &&
            field.documentId === activeInteraction.fieldSnapshot.documentId &&
            field.pageNumber === activeInteraction.fieldSnapshot.pageNumber
        );
        const snappedPrimary = snapFieldToGuides({
          field: {
            ...activeInteraction.fieldSnapshot,
            xPercent: clamp(
              activeInteraction.fieldSnapshot.xPercent + deltaX,
              0,
              1 - activeInteraction.fieldSnapshot.widthPercent
            ),
            yPercent: clamp(
              activeInteraction.fieldSnapshot.yPercent + deltaY,
              0,
              1 - activeInteraction.fieldSnapshot.heightPercent
            ),
          },
          otherFields,
        });
        const appliedDeltaX = snappedPrimary.field.xPercent - activeInteraction.fieldSnapshot.xPercent;
        const appliedDeltaY = snappedPrimary.field.yPercent - activeInteraction.fieldSnapshot.yPercent;

        setSnapGuides(snappedPrimary.guides);
        const nextFields = activeInteraction.allFieldsSnapshot.map((field) => {
          const snapshot = activeInteraction.selectionSnapshots.find(
            (entry) => entry.localId === field.localId
          );
          if (!snapshot) {
            return field;
          }

          return normalizeFieldPosition({
            ...snapshot,
            xPercent: snapshot.xPercent + appliedDeltaX,
            yPercent: snapshot.yPercent + appliedDeltaY,
          });
        });
        interactionPreviewRef.current = nextFields;
        onFieldsChange(
          nextFields,
          { recordHistory: false }
        );
        return;
      }

      const deltaX = (event.clientX - activeInteraction.startClientX) / activeInteraction.canvasWidth;
      const deltaY = (event.clientY - activeInteraction.startClientY) / activeInteraction.canvasHeight;
      const field = activeInteraction.fieldSnapshot;
      const nextField = { ...field };

      if (activeInteraction.handle.includes('e')) {
        nextField.widthPercent = clamp(
          field.widthPercent + deltaX,
          ESIGNING_LIMITS.MIN_FIELD_WIDTH,
          1 - field.xPercent
        );
      }

      if (activeInteraction.handle.includes('s')) {
        nextField.heightPercent = clamp(
          field.heightPercent + deltaY,
          ESIGNING_LIMITS.MIN_FIELD_HEIGHT,
          1 - field.yPercent
        );
      }

      if (activeInteraction.handle.includes('w')) {
        nextField.xPercent = clamp(
          field.xPercent + deltaX,
          0,
          field.xPercent + field.widthPercent - ESIGNING_LIMITS.MIN_FIELD_WIDTH
        );
        nextField.widthPercent = clamp(
          field.widthPercent - (nextField.xPercent - field.xPercent),
          ESIGNING_LIMITS.MIN_FIELD_WIDTH,
          1 - nextField.xPercent
        );
      }

      if (activeInteraction.handle.includes('n')) {
        nextField.yPercent = clamp(
          field.yPercent + deltaY,
          0,
          field.yPercent + field.heightPercent - ESIGNING_LIMITS.MIN_FIELD_HEIGHT
        );
        nextField.heightPercent = clamp(
          field.heightPercent - (nextField.yPercent - field.yPercent),
          ESIGNING_LIMITS.MIN_FIELD_HEIGHT,
          1 - nextField.yPercent
        );
      }

      const snapped = snapFieldToGuides({
        field: nextField,
        otherFields: activeInteraction.allFieldsSnapshot.filter(
          (entry) =>
            entry.localId !== activeInteraction.fieldId &&
            entry.documentId === activeInteraction.fieldSnapshot.documentId &&
            entry.pageNumber === activeInteraction.fieldSnapshot.pageNumber
        ),
      });
      setSnapGuides(snapped.guides);
      updateField(snapped.field);
    }

    function onPointerUp() {
      const previewFields = interactionPreviewRef.current;
      interactionPreviewRef.current = null;
      if (
        previewFields &&
        !areFieldCollectionsEqual(previewFields, activeInteraction.allFieldsSnapshot)
      ) {
        onFieldsChange(previewFields, {
          historySnapshot: activeInteraction.allFieldsSnapshot,
        });
      }
      setInteraction(null);
      setSnapGuides({ vertical: [], horizontal: [] });
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [interaction, onFieldsChange]);

  function beginDrag(
    event: React.PointerEvent<HTMLDivElement>,
    field: PlacedField,
    canvasWidth: number,
    canvasHeight: number
  ) {
    event.preventDefault();
    event.stopPropagation();
    onPageChange(field.pageNumber);
    interactionPreviewRef.current = null;
    const selectedFieldIds = selectedFieldIdsInternal.includes(field.localId)
      ? selectedFieldIdsInternal
      : [field.localId];
    setSelectedFieldIdsInternal(selectedFieldIds);
    onFieldSelect(field.localId);
    setInteraction({
      kind: 'drag',
      fieldId: field.localId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      fieldSnapshot: field,
      canvasWidth,
      canvasHeight,
      selectedFieldIds,
      selectionSnapshots: fields.filter((entry) => selectedFieldIds.includes(entry.localId)),
      allFieldsSnapshot: fields,
    });
  }

  function beginResize(
    event: React.PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    handle: ResizeHandle,
    canvasWidth: number,
    canvasHeight: number
  ) {
    event.preventDefault();
    event.stopPropagation();
    onPageChange(field.pageNumber);
    interactionPreviewRef.current = null;
    onFieldSelect(field.localId);
    setInteraction({
      kind: 'resize',
      fieldId: field.localId,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      fieldSnapshot: field,
      canvasWidth,
      canvasHeight,
      allFieldsSnapshot: fields,
    });
  }

  function updateSelection(fieldId: string, append: boolean) {
    if (!append) {
      setSelectedFieldIdsInternal([fieldId]);
      onFieldSelect(fieldId);
      return;
    }

    setSelectedFieldIdsInternal((current) => {
      const nextSelection = current.includes(fieldId)
        ? current.filter((entry) => entry !== fieldId)
        : [...current, fieldId];
      onFieldSelect(nextSelection[nextSelection.length - 1] ?? null);
      return nextSelection;
    });
  }

  const moveSelectedFields = useCallback(
    (deltaX: number, deltaY: number) => {
      if (selectedFieldIdsInternal.length === 0) {
        return;
      }

      onFieldsChange(
        fields.map((field) =>
          selectedFieldIdsInternal.includes(field.localId)
            ? normalizeFieldPosition({
                ...field,
                xPercent: field.xPercent + deltaX,
                yPercent: field.yPercent + deltaY,
              })
            : field
        )
      );
    },
    [fields, onFieldsChange, selectedFieldIdsInternal]
  );

  const cloneFieldsForPaste = useCallback(
    (sourceFields: PlacedField[]): PlacedField[] =>
      sourceFields.map((field, index) =>
        normalizeFieldPosition({
          ...field,
          localId: crypto.randomUUID(),
          documentId: selectedDocumentId,
          pageNumber: viewerPage,
          xPercent: field.xPercent + 0.02,
          yPercent: field.yPercent + 0.02,
          sortOrder: fields.length + index,
        })
      ),
    [fields.length, selectedDocumentId, viewerPage]
  );

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

      return ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase());
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      if (shouldIgnoreShortcut(event.target)) {
        return;
      }

      const ownsKeyboard = canvasOwnsKeyboard();
      const visibleSelectedFieldIds = selectedFieldIdsInternal.filter((fieldId) =>
        fieldsOnPage.some((field) => field.localId === fieldId)
      );
      const hasVisibleSelection = ownsKeyboard && visibleSelectedFieldIds.length > 0;

      const nudgeDistance = event.shiftKey ? LARGE_NUDGE_STEP : NUDGE_STEP;
      if (event.key === 'ArrowLeft') {
        if (!hasVisibleSelection) return;
        event.preventDefault();
        moveSelectedFields(-nudgeDistance, 0);
        return;
      }
      if (event.key === 'ArrowRight') {
        if (!hasVisibleSelection) return;
        event.preventDefault();
        moveSelectedFields(nudgeDistance, 0);
        return;
      }
      if (event.key === 'ArrowUp') {
        if (!hasVisibleSelection) return;
        event.preventDefault();
        moveSelectedFields(0, -nudgeDistance);
        return;
      }
      if (event.key === 'ArrowDown') {
        if (!hasVisibleSelection) return;
        event.preventDefault();
        moveSelectedFields(0, nudgeDistance);
        return;
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && hasVisibleSelection) {
        event.preventDefault();
        onFieldsChange(
          fields.filter((field) => !visibleSelectedFieldIds.includes(field.localId))
        );
        setSelectedFieldIdsInternal([]);
        onFieldSelect(null);
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;
      if (!isModifierPressed) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'c' && hasVisibleSelection) {
        event.preventDefault();
        clipboardRef.current = fields.filter((field) =>
          visibleSelectedFieldIds.includes(field.localId)
        );
      }

      if (key === 'v' && ownsKeyboard && clipboardRef.current.length > 0 && selectedDocumentId) {
        event.preventDefault();
        const nextFields = cloneFieldsForPaste(clipboardRef.current);
        onFieldsChange([...fields, ...nextFields]);
        setSelectedFieldIdsInternal(nextFields.map((field) => field.localId));
        onFieldSelect(nextFields[0]?.localId ?? null);
      }

      if (key === 'd' && hasVisibleSelection && selectedDocumentId) {
        event.preventDefault();
        const sourceFields = fields.filter((field) =>
          visibleSelectedFieldIds.includes(field.localId)
        );
        const nextFields = cloneFieldsForPaste(sourceFields);
        clipboardRef.current = sourceFields;
        onFieldsChange([...fields, ...nextFields]);
        setSelectedFieldIdsInternal(nextFields.map((field) => field.localId));
        onFieldSelect(nextFields[0]?.localId ?? null);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    canEdit,
    cloneFieldsForPaste,
    fields,
    fieldsOnPage,
    moveSelectedFields,
    onFieldSelect,
    onFieldsChange,
    selectedDocumentId,
    selectedFieldIdsInternal,
    viewerPage,
  ]);

  function placeFieldAt(pageNumber: number, xPercent: number, yPercent: number) {
    if (!canEdit || !placementType || !placementRecipientId || !selectedDocumentId) {
      setSelectedFieldIdsInternal([]);
      onFieldSelect(null);
      return;
    }
    const size = DEFAULT_FIELD_SIZES[placementType];

    const newField = normalizeFieldPosition({
      localId: crypto.randomUUID(),
      documentId: selectedDocumentId,
      recipientId: placementRecipientId,
      type: placementType,
      pageNumber,
      xPercent: xPercent - size.w / 2,
      yPercent: yPercent - size.h / 2,
      widthPercent: size.w,
      heightPercent: size.h,
      required: placementType !== 'CHECKBOX',
      label: null,
      placeholder: null,
      sortOrder: fields.length,
    });

    onFieldsChange([...fields, newField]);
    setSelectedFieldIdsInternal([newField.localId]);
    onFieldSelect(newField.localId);
  }

  function updateGhostPositionFromClient(
    target: HTMLDivElement,
    pageNumber: number,
    clientX: number,
    clientY: number
  ) {
    const rect = target.getBoundingClientRect();
    setGhostPosition({
      pageNumber,
      xPercent: clamp((clientX - rect.left) / rect.width, 0, 1),
      yPercent: clamp((clientY - rect.top) / rect.height, 0, 1),
    });
  }

  function getViewerScrollContainer(): HTMLDivElement | null {
    const scrollContainer = containerRef.current?.querySelector('[data-document-scroll-container="true"]');
    return scrollContainer instanceof HTMLDivElement ? scrollContainer : null;
  }

  function handlePlacementPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    pageNumber: number
  ) {
    if (!canEdit || !placementType || event.button !== 0) {
      return;
    }

    onPageChange(pageNumber);
    updateGhostPositionFromClient(event.currentTarget, pageNumber, event.clientX, event.clientY);

    const scrollContainer = getViewerScrollContainer();
    placementPointerStateRef.current = {
      pointerId: event.pointerId,
      pageNumber,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: scrollContainer?.scrollLeft ?? 0,
      startScrollTop: scrollContainer?.scrollTop ?? 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePlacementPointerMove(
    event: React.PointerEvent<HTMLDivElement>,
    pageNumber: number
  ) {
    if (!canEdit || !placementType) {
      return;
    }

    updateGhostPositionFromClient(event.currentTarget, pageNumber, event.clientX, event.clientY);

    const pointerState = placementPointerStateRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointerState.startClientX;
    const deltaY = event.clientY - pointerState.startClientY;
    if (!pointerState.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
      pointerState.moved = true;
    }

    if (!pointerState.moved) {
      return;
    }

    const scrollContainer = getViewerScrollContainer();
    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollLeft = pointerState.startScrollLeft - deltaX;
    scrollContainer.scrollTop = pointerState.startScrollTop - deltaY;
  }

  function handlePlacementPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const pointerState = placementPointerStateRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    placementPointerStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (!pointerState.moved) {
      const rect = event.currentTarget.getBoundingClientRect();
      placeFieldAt(
        pointerState.pageNumber,
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      );
    }
  }

  function handleKeyboardPlacement(pageNumber: number) {
    if (!canEdit || !placementType || !placementRecipientId || !selectedDocumentId) {
      return;
    }

    const size = DEFAULT_FIELD_SIZES[placementType];
    const ghost =
      ghostPosition?.pageNumber === pageNumber
        ? ghostPosition
        : { pageNumber, xPercent: 0.5, yPercent: 0.5 };
    const newField = normalizeFieldPosition({
      localId: crypto.randomUUID(),
      documentId: selectedDocumentId,
      recipientId: placementRecipientId,
      type: placementType,
      pageNumber: ghost.pageNumber,
      xPercent: ghost.xPercent - size.w / 2,
      yPercent: ghost.yPercent - size.h / 2,
      widthPercent: size.w,
      heightPercent: size.h,
      required: placementType !== 'CHECKBOX',
      label: null,
      placeholder: null,
      sortOrder: fields.length,
    });

    onFieldsChange([...fields, newField]);
    setSelectedFieldIdsInternal([newField.localId]);
    onFieldSelect(newField.localId);
  }

  function renderPageFields({ pageNumber, width, height }: DocumentPageOverlayContext) {
    const pageFields = fields.filter(
      (field) => field.documentId === selectedDocumentId && field.pageNumber === pageNumber
    );
    const showGhost = placementType && ghostPosition?.pageNumber === pageNumber;
    const showGuides = interaction?.fieldSnapshot.pageNumber === pageNumber;

    return (
      <div
        data-esigning-page-overlay={pageNumber}
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {canEdit ? (
          <div
            role={placementType ? 'button' : undefined}
            tabIndex={pageNumber === viewerPage ? 0 : -1}
            aria-label={
              placementType
                ? `Place ${ESIGNING_FIELD_TYPE_LABELS[placementType]} field on page ${pageNumber}`
                : pageNumber === viewerPage
                  ? 'Document field canvas. Select a field to use arrow keys.'
                  : `Document field canvas, page ${pageNumber}`
            }
            onFocus={() => onPageChange(pageNumber)}
            onPointerDown={
              placementType
                ? (event) => handlePlacementPointerDown(event, pageNumber)
                : undefined
            }
            onPointerMove={
              placementType
                ? (event) => handlePlacementPointerMove(event, pageNumber)
                : undefined
            }
            onPointerUp={placementType ? handlePlacementPointerEnd : undefined}
            onPointerCancel={placementType ? handlePlacementPointerEnd : undefined}
            onMouseMove={
              placementType
                ? undefined
                : () => {
                    setGhostPosition(null);
                  }
            }
            onMouseLeave={() => {
              if (!placementPointerStateRef.current) {
                setGhostPosition(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onPageChange(pageNumber);
                handleKeyboardPlacement(pageNumber);
              }
            }}
            className={cn(
              'absolute inset-0',
              placementType
                ? 'pointer-events-auto cursor-crosshair'
                : 'pointer-events-none cursor-default'
            )}
          />
        ) : null}

        {showGhost ? (
          <div
            className="pointer-events-none absolute rounded border border-dashed border-oak-primary bg-oak-primary/10"
            style={{
              left:
                clamp(
                  ghostPosition.xPercent - DEFAULT_FIELD_SIZES[placementType].w / 2,
                  0,
                  1 - DEFAULT_FIELD_SIZES[placementType].w
                ) * width,
              top:
                clamp(
                  ghostPosition.yPercent - DEFAULT_FIELD_SIZES[placementType].h / 2,
                  0,
                  1 - DEFAULT_FIELD_SIZES[placementType].h
                ) * height,
              width: DEFAULT_FIELD_SIZES[placementType].w * width,
              height: DEFAULT_FIELD_SIZES[placementType].h * height,
            }}
          />
        ) : null}

        {showGuides
          ? snapGuides.vertical.map((guide) => (
              <div
                key={`vertical-${guide}`}
                className="pointer-events-none absolute top-0 w-px bg-oak-primary/60"
                style={{ left: guide * width, height }}
              />
            ))
          : null}
        {showGuides
          ? snapGuides.horizontal.map((guide) => (
              <div
                key={`horizontal-${guide}`}
                className="pointer-events-none absolute left-0 h-px bg-oak-primary/60"
                style={{ top: guide * height, width }}
              />
            ))
          : null}

        {pageFields.map((field) => (
          <PlacedFieldChip
            key={field.localId}
            field={field}
            canvasWidth={width}
            canvasHeight={height}
            isSelected={selectedFieldIdsInternal.includes(field.localId)}
            hasOverlap={overlapsByField.has(field.localId)}
            canEdit={canEdit}
            recipients={recipients}
            onSelect={(event) => {
              onPageChange(pageNumber);
              updateSelection(
                field.localId,
                event.shiftKey || event.metaKey || event.ctrlKey
              );
            }}
            onDelete={() => {
              onFieldsChange(fields.filter((entry) => entry.localId !== field.localId));
              setSelectedFieldIdsInternal((current) =>
                current.filter((entry) => entry !== field.localId)
              );
              onFieldSelect(null);
            }}
            onBeginDrag={(event) => beginDrag(event, field, width, height)}
            onBeginResize={(event, handle) =>
              beginResize(event, field, handle, width, height)
            }
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {documents.length > 1 ? (
        <div className="flex flex-shrink-0 items-end overflow-x-auto overflow-y-hidden border-b border-border-primary bg-background-secondary pl-2">
          {documents.map((document) => {
            const isActive = document.id === selectedDocumentId;
            return (
              <button
                key={document.id}
                type="button"
                onClick={() => onDocumentChange(document.id)}
                className={cn(
                  'relative flex-shrink-0 rounded-tl-lg rounded-tr-lg border border-b-0 px-4 py-2 text-xs font-medium transition-colors -mb-px',
                  isActive
                    ? 'border-border-primary bg-background-primary text-text-primary z-10'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-primary/50'
                )}
              >
                {document.fileName}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="relative flex-1 overflow-hidden" ref={containerRef}>
        {selectedDocument ? (
          <DocumentPageViewer
            showPageSideNavigation={false}
            showHighlightsToggle={false}
            pdfUrl={selectedDocument.pdfUrl}
            initialPage={viewerPage}
            fitFirstPageWidthOnInitialLoad
            zoomLevel={zoomLevel}
            onZoomLevelChange={onZoomLevelChange}
            highlights={canEdit ? [] : highlights}
            thumbnailMarkers={thumbnailMarkers}
            onPageChange={onPageChange}
            viewMode="continuous"
            renderPageOverlay={canEdit ? renderPageFields : undefined}
            className="h-full w-full"
            keyboardShortcutScope="focused"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            No documents uploaded yet.
          </div>
        )}
      </div>
    </div>
  );
}

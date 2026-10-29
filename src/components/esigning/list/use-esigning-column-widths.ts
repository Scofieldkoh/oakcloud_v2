'use client';

import { useCallback, useEffect, useState } from 'react';
import { useColumnResize } from '@/hooks/use-column-resize';
import { useUpsertUserPreference, useUserPreference } from '@/hooks/use-user-preferences';
import {
  DEFAULT_ESIGNING_COLUMN_WIDTHS,
  ESIGNING_COLUMN_WIDTH_PREF_KEY,
  ESIGNING_TABLE_COLUMNS,
  type EsigningTableColumnId,
} from './esigning-list-config';

type ColumnWidths = Partial<Record<EsigningTableColumnId, number>>;

const getDefaultColumnWidth = (columnId: EsigningTableColumnId) => DEFAULT_ESIGNING_COLUMN_WIDTHS[columnId];
const clampColumnWidth = (width: number) => Math.max(30, width);

/**
 * Envelope table column widths, loaded from and saved to the user's preferences.
 * Columns resize by dragging the header handle or with the arrow keys, never below 30px.
 */
export function useEsigningColumnWidths() {
  const columnWidthPreference = useUserPreference<ColumnWidths>(ESIGNING_COLUMN_WIDTH_PREF_KEY);
  const saveColumnWidthPreference = useUpsertUserPreference<Record<string, number>>();
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({});

  useEffect(() => {
    const value = columnWidthPreference.data?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const sanitized = Object.fromEntries(
      ESIGNING_TABLE_COLUMNS.flatMap((columnId) => {
        const width = value[columnId];
        return typeof width === 'number' && Number.isFinite(width)
          ? [[columnId, Math.max(30, width)]]
          : [];
      })
    ) as ColumnWidths;
    setColumnWidths(sanitized);
  }, [columnWidthPreference.data?.value]);

  const saveWidth = useCallback((columnId: EsigningTableColumnId, width: number) => {
    const nextWidths = { ...columnWidths, [columnId]: width };
    setColumnWidths(nextWidths);
    saveColumnWidthPreference.mutate({
      key: ESIGNING_COLUMN_WIDTH_PREF_KEY,
      value: nextWidths,
    });
  }, [columnWidths, saveColumnWidthPreference]);

  const { liveWidths, startResize, resizeWithKeyboard } = useColumnResize<EsigningTableColumnId>({
    getWidth: useCallback((columnId: EsigningTableColumnId) => columnWidths[columnId], [columnWidths]),
    getDefaultWidth: getDefaultColumnWidth,
    clampWidth: clampColumnWidth,
    onResizeEnd: saveWidth,
  });

  return {
    columnWidths: { ...columnWidths, ...liveWidths },
    startColumnResize: startResize,
    resizeColumnByKeyboard: resizeWithKeyboard,
  };
}

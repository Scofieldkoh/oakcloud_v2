'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUpsertUserPreference, useUserPreference } from '@/hooks/use-user-preferences';

export interface TableColumnPreference<Id extends string> {
  version: 1;
  columnOrder: Id[];
  columnVisibility: Partial<Record<Id, boolean>>;
  columnWidths: Partial<Record<Id, number>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads a saved column layout, keeping only known columns: saved order first,
 * then any column added since; widths clamped to `minWidth`..800; locked
 * columns always shown.
 */
export function parseTableColumnPreference<Id extends string>(
  value: unknown,
  columns: readonly Id[],
  options: { minWidth?: number; locked?: readonly Id[]; hiddenByDefault?: readonly Id[] } = {},
): TableColumnPreference<Id> {
  const { minWidth = 60, locked = [], hiddenByDefault = [] } = options;
  const defaults: TableColumnPreference<Id> = {
    version: 1,
    columnOrder: [...columns],
    columnVisibility: Object.fromEntries(columns.map((id) => [id, !hiddenByDefault.includes(id)])) as Record<Id, boolean>,
    columnWidths: {},
  };
  if (!isRecord(value) || value.version !== 1) return defaults;

  const savedOrder = Array.isArray(value.columnOrder) ? value.columnOrder : [];
  const columnOrder = [...savedOrder, ...columns].filter(
    (id, index, all): id is Id => typeof id === 'string' && columns.includes(id as Id) && all.indexOf(id) === index,
  );

  const columnVisibility = { ...defaults.columnVisibility };
  if (isRecord(value.columnVisibility)) {
    for (const id of columns) {
      const visible = value.columnVisibility[id];
      if (typeof visible === 'boolean') columnVisibility[id] = visible;
    }
  }
  for (const id of locked) columnVisibility[id] = true;

  const columnWidths: Partial<Record<Id, number>> = {};
  if (isRecord(value.columnWidths)) {
    for (const id of columns) {
      const width = value.columnWidths[id];
      if (typeof width === 'number' && Number.isFinite(width)) {
        columnWidths[id] = Math.min(800, Math.max(minWidth, Math.round(width)));
      }
    }
  }

  return { version: 1, columnOrder, columnVisibility, columnWidths };
}

/**
 * Column order, visibility and widths for a list table, saved per user under
 * `preferenceKey` so the layout follows them across devices. Pairs with
 * `ServiceColumnModal` (Columns button) and `DataGrid` (resizing).
 */
export function useTableColumnPreference<Id extends string>(
  preferenceKey: string,
  columns: readonly Id[],
  options: { minWidth?: number; locked?: readonly Id[]; hiddenByDefault?: readonly Id[] } = {},
) {
  const preference = useUserPreference<TableColumnPreference<Id>>(preferenceKey);
  const savePreference = useUpsertUserPreference<TableColumnPreference<Id>>();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const [layout, setLayout] = useState<TableColumnPreference<Id>>(
    () => parseTableColumnPreference(undefined, columns, options),
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const restored = useRef(false);

  useEffect(() => {
    if (preference.isLoading || restored.current) return;
    restored.current = true;
    setLayout(parseTableColumnPreference(preference.data?.value, columnsRef.current, optionsRef.current));
  }, [preference.data?.value, preference.isLoading]);

  const update = useCallback((change: (current: TableColumnPreference<Id>) => TableColumnPreference<Id>) => {
    const next = change(layoutRef.current);
    if (next === layoutRef.current) return;
    layoutRef.current = next;
    setLayout(next);
    savePreference.mutate({ key: preferenceKey, value: next });
  }, [preferenceKey, savePreference]);

  const setColumnWidth = useCallback((id: Id, width: number) => {
    update((current) => ({ ...current, columnWidths: { ...current.columnWidths, [id]: width } }));
  }, [update]);

  const toggleColumn = useCallback((id: Id) => {
    if (optionsRef.current.locked?.includes(id)) return;
    update((current) => ({
      ...current,
      columnVisibility: { ...current.columnVisibility, [id]: current.columnVisibility[id] === false },
    }));
  }, [update]);

  const moveColumn = useCallback((id: Id, direction: -1 | 1) => {
    update((current) => {
      const order = [...current.columnOrder];
      const from = order.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= order.length) return current;
      [order[from], order[to]] = [order[to], order[from]];
      return { ...current, columnOrder: order };
    });
  }, [update]);

  const showAllColumns = useCallback(() => {
    update((current) => ({
      ...current,
      columnVisibility: Object.fromEntries(columnsRef.current.map((id) => [id, true])) as Record<Id, boolean>,
    }));
  }, [update]);

  const resetColumnWidths = useCallback(() => {
    update((current) => ({ ...current, columnWidths: {} }));
  }, [update]);

  const visibility = useMemo(
    () => Object.fromEntries(layout.columnOrder.map((id) => [id, layout.columnVisibility[id] !== false])) as Record<Id, boolean>,
    [layout],
  );
  const hiddenColumnCount = layout.columnOrder.filter((id) => !visibility[id]).length;

  return {
    columnOrder: layout.columnOrder,
    columnVisibility: visibility,
    columnWidths: layout.columnWidths as Record<string, number>,
    hiddenColumnCount,
    setColumnWidth,
    toggleColumn,
    moveColumn,
    showAllColumns,
    resetColumnWidths,
  };
}

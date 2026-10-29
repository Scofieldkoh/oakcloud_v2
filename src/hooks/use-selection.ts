import { useState, useCallback, useMemo } from 'react';

interface UseSelectionOptions<T> {
  /** Key extractor function to get unique ID from item */
  keyExtractor?: (item: T) => string;
  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
}

interface UseSelectionReturn {
  /** Set of currently selected IDs */
  selectedIds: Set<string>;
  /** Array of selected IDs (for API calls) */
  selectedArray: string[];
  /** Number of selected items */
  selectedCount: number;
  /** Check if a specific item is selected */
  isSelected: (id: string) => boolean;
  /** Check if all items are selected */
  isAllSelected: boolean;
  /** Check if some (but not all) items are selected */
  isIndeterminate: boolean;
  /** Toggle selection of a single item */
  toggleOne: (id: string) => void;
  /** Select a single item (for single-select mode) */
  selectOne: (id: string) => void;
  /** Toggle selection of all items */
  toggleAll: () => void;
  /** Select all items */
  selectAll: () => void;
  /** Deselect all items */
  deselectAll: () => void;
  /** Clear all selections */
  clear: () => void;
}

/**
 * Hook for managing selection state in tables/lists.
 * Supports single and multi-select with select-all functionality.
 *
 * @example
 * ```tsx
 * const { isSelected, toggleOne, toggleAll, isAllSelected, isIndeterminate, selectedCount, clear } = useSelection(items);
 *
 * // In table header
 * <Checkbox
 *   checked={isAllSelected}
 *   indeterminate={isIndeterminate}
 *   onChange={toggleAll}
 * />
 *
 * // In table row
 * <Checkbox
 *   checked={isSelected(item.id)}
 *   onChange={() => toggleOne(item.id)}
 * />
 * ```
 */
export function useSelection<T extends { id: string }>(
  items: T[],
  options: UseSelectionOptions<T> = {}
): UseSelectionReturn {
  const { keyExtractor = (item) => item.id, onSelectionChange } = options;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Get all item IDs
  const allIds = useMemo(() => items.map(keyExtractor), [items, keyExtractor]);

  // Computed values
  const selectedCount = selectedIds.size;
  const isAllSelected = items.length > 0 && selectedIds.size === items.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < items.length;
  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  // Update handler that also calls the callback
  const updateSelection = useCallback(
    (newSelection: Set<string>) => {
      setSelectedIds(newSelection);
      if (onSelectionChange) {
        onSelectionChange(Array.from(newSelection));
      }
    },
    [onSelectionChange]
  );

  // Check if a specific item is selected
  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  // Toggle a single item
  const toggleOne = useCallback(
    (id: string) => {
      const newSelection = new Set(selectedIds);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      updateSelection(newSelection);
    },
    [selectedIds, updateSelection]
  );

  // Select a single item (single-select mode)
  const selectOne = useCallback(
    (id: string) => {
      updateSelection(new Set([id]));
    },
    [updateSelection]
  );

  // Toggle all items
  const toggleAll = useCallback(() => {
    if (isAllSelected) {
      updateSelection(new Set());
    } else {
      updateSelection(new Set(allIds));
    }
  }, [isAllSelected, allIds, updateSelection]);

  // Select all items
  const selectAll = useCallback(() => {
    updateSelection(new Set(allIds));
  }, [allIds, updateSelection]);

  // Deselect all items
  const deselectAll = useCallback(() => {
    updateSelection(new Set());
  }, [updateSelection]);

  // Clear selections
  const clear = useCallback(() => {
    updateSelection(new Set());
  }, [updateSelection]);

  return {
    selectedIds,
    selectedArray,
    selectedCount,
    isSelected,
    isAllSelected,
    isIndeterminate,
    toggleOne,
    selectOne,
    toggleAll,
    selectAll,
    deselectAll,
    clear,
  };
}

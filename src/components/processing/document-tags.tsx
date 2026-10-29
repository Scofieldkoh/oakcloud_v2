/**
 * Document Tags Component
 *
 * Displays and manages tags on a processing document.
 * Features:
 * - Display current tags as colored chips
 * - Add tags via autocomplete (recent + search)
 * - Create new tags with color selection
 * - Remove tags via chip X button
 */

'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Tag, Plus, X, Search, Check, Settings, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TAG_COLORS, type TagColor } from '@/lib/validations/document-tag';
import {
  useDocumentTags,
  useAvailableRecentTags,
  useSearchAvailableTags,
  useAddDocumentTag,
  useRemoveDocumentTag,
  useCreateAndAddTag,
  useAvailableTags,
  useTenantTags,
  useCompanyTags,
  useCreateTag,
  useCreateWorkspaceTag,
  useUpdateTag,
  useDeleteTag,
  useUpdateTenantTag,
  useDeleteWorkspaceTag,
  type TagScope,
} from '@/hooks/use-document-tags';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-auth';

// ============================================================================
// TagChip Component
// ============================================================================

interface TagChipProps {
  name: string;
  color: TagColor;
  size?: 'xs' | 'sm' | 'md';
  scope?: TagScope;
  onRemove?: () => void;
  isLoading?: boolean;
}

export function TagChip({ name, color, size = 'md', scope, onRemove, isLoading }: TagChipProps) {
  const colors = TAG_COLORS[color] || TAG_COLORS.GRAY;
  const isTenantTag = scope === 'tenant';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium border transition-all',
        colors.bg,
        colors.text,
        colors.border,
        size === 'xs' && 'px-1.5 py-0.5 text-2xs',
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-2.5 py-1 text-xs',
        isLoading && 'opacity-50'
      )}
      title={isTenantTag ? 'Shared tag (available across all companies)' : undefined}
    >
      {isTenantTag ? (
        <Globe className={cn(size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
      ) : (
        <Tag className={cn(size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
      )}
      <span className="max-w-[120px] truncate">{name}</span>
      {onRemove && !isLoading && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            'p-0.5 rounded-full transition-colors',
            'hover:bg-black/10 dark:hover:bg-white/10',
            'focus:outline-none focus:ring-1 focus:ring-current'
          )}
          aria-label={`Remove tag ${name}`}
        >
          <X className={cn(size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
        </button>
      )}
    </span>
  );
}

// ============================================================================
// Color Picker Component
// ============================================================================

interface ColorPickerProps {
  selectedColor: TagColor;
  onColorSelect: (color: TagColor) => void;
}

function ColorPicker({ selectedColor, onColorSelect }: ColorPickerProps) {
  const colors = Object.keys(TAG_COLORS) as TagColor[];

  return (
    <div className="flex flex-wrap gap-1.5 p-2">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onColorSelect(color)}
          className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center transition-all',
            'hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1',
            TAG_COLORS[color].bg,
            TAG_COLORS[color].border,
            'border',
            selectedColor === color && 'ring-2 ring-oak-primary ring-offset-1'
          )}
          aria-label={`Select ${color.toLowerCase()} color`}
          title={color.charAt(0) + color.slice(1).toLowerCase()}
        >
          {selectedColor === color && (
            <Check className={cn('w-3.5 h-3.5', TAG_COLORS[color].text)} />
          )}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// DocumentTags Component
// ============================================================================

interface DocumentTagsProps {
  documentId: string;
  companyId: string | null;
  tenantId?: string | null;
  readOnly?: boolean;
  className?: string;
  /** Limit the number of tags shown (for table view) */
  limit?: number;
}

export function DocumentTags({
  documentId,
  companyId,
  tenantId,
  readOnly = false,
  className,
  limit,
}: DocumentTagsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [manageDropdownPos, setManageDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [newTagColor, setNewTagColor] = useState<TagColor>('GRAY');
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<{ id: string; name: string; color: TagColor; scope: TagScope } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; scope: TagScope } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const manageRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const toast = useToast();
  const { data: session } = useSession();
  const isAdmin = session?.isSuperAdmin || session?.isWorkspaceAdmin;

  // Queries
  // Fetch document tags lazily after component mount
  const { data: documentTags = [], isLoading: isLoadingDocTags } = useDocumentTags(documentId);

  // Lazy load tag selector data - only fetch when dropdown is open
  const { data: recentTags = [] } = useAvailableRecentTags(
    isOpen ? companyId : null, // Only fetch when dropdown is open
    isOpen ? tenantId : null
  );
  const { data: tenantTags = [] } = useTenantTags(
    isOpen ? tenantId : null // Only fetch when dropdown is open
  );
  const { data: searchResults = [], isLoading: isSearching } = useSearchAvailableTags(
    isOpen ? companyId : null, // Only search when dropdown is open
    debouncedQuery,
    isOpen ? tenantId : null
  );

  // Mutations
  const addTagMutation = useAddDocumentTag();
  const removeTagMutation = useRemoveDocumentTag();
  const createAndAddMutation = useCreateAndAddTag();
  const updateTagMutation = useUpdateTag();
  const deleteTagMutation = useDeleteTag();
  const updateTenantTagMutation = useUpdateTenantTag();
  const deleteWorkspaceTagMutation = useDeleteWorkspaceTag();

  // Fetch all available tags for manage dropdown (tenant + company)
  const { data: allAvailableTags = [], isLoading: isLoadingAllTags } = useAvailableTags(companyId, tenantId);

  // Debounce search query
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  // Tags to show in dropdown (exclude already added)
  // When searching: show search results
  // When not searching: show recent tags + all tenant tags (not already in recent)
  const { availableRecentTags, availableTenantTags, availableSearchResults } = useMemo(() => {
    const docTagIds = new Set(documentTags.map((t) => t.tagId));

    if (debouncedQuery.length > 0) {
      // When searching, just filter search results
      return {
        availableRecentTags: [],
        availableTenantTags: [],
        availableSearchResults: searchResults.filter((t) => !docTagIds.has(t.id)),
      };
    }

    // Filter recent tags
    const filteredRecent = recentTags.filter((t) => !docTagIds.has(t.id));
    const recentTagIds = new Set(filteredRecent.map((t) => t.id));

    // Filter tenant tags that are not already in recent and not already added to doc
    const filteredTenant = tenantTags.filter(
      (t) => !docTagIds.has(t.id) && !recentTagIds.has(t.id)
    );

    return {
      availableRecentTags: filteredRecent,
      availableTenantTags: filteredTenant,
      availableSearchResults: [],
    };
  }, [documentTags, debouncedQuery, searchResults, recentTags, tenantTags]);

  // Check if search query exactly matches an existing tag
  const queryMatchesExisting = useMemo(() => {
    if (!searchQuery.trim()) return false;
    // Check recent tags, tenant tags, and search results
    const allTags = [...recentTags, ...tenantTags, ...searchResults];
    return allTags.some((t) => t.name.toLowerCase() === searchQuery.trim().toLowerCase());
  }, [searchQuery, recentTags, tenantTags, searchResults]);

  // Handle adding an existing tag
  const handleAddTag = useCallback(
    async (tagId: string) => {
      try {
        await addTagMutation.mutateAsync({
          documentId,
          tagId,
          companyId: companyId || undefined,
        });
        setSearchQuery('');
        setIsOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add tag');
      }
    },
    [documentId, companyId, addTagMutation, toast]
  );

  // Handle removing a tag
  const handleRemoveTag = useCallback(
    async (tagId: string) => {
      setRemovingTagId(tagId);
      try {
        await removeTagMutation.mutateAsync({ documentId, tagId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove tag');
      } finally {
        setRemovingTagId(null);
      }
    },
    [documentId, removeTagMutation, toast]
  );

  // Handle creating and adding a new tag
  const handleCreateAndAddTag = useCallback(async () => {
    if (!searchQuery.trim() || queryMatchesExisting) return;

    try {
      await createAndAddMutation.mutateAsync({
        documentId,
        name: searchQuery.trim(),
        color: newTagColor,
        companyId: companyId || undefined,
      });
      setSearchQuery('');
      setNewTagColor('GRAY');
      setShowColorPicker(false);
      setIsOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tag');
    }
  }, [searchQuery, queryMatchesExisting, documentId, newTagColor, companyId, createAndAddMutation, toast]);

  // Click outside handler for add tag dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setShowColorPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Click outside handler for manage tags dropdown
  const manageDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isManageOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is outside both the button and the dropdown
      const isOutsideButton = manageRef.current && !manageRef.current.contains(target);
      const isOutsideDropdown = manageDropdownRef.current && !manageDropdownRef.current.contains(target);

      if (isOutsideButton && isOutsideDropdown) {
        setIsManageOpen(false);
        setManageDropdownPos(null);
        setEditingTag(null);
        setDeleteConfirm(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isManageOpen]);

  // Handle tag color change (manage dropdown) - supports both tenant and company tags
  const handleTagColorChange = useCallback(async (tagId: string, newColor: TagColor, scope: TagScope) => {
    try {
      if (scope === 'tenant') {
        // Update tenant tag (admin only)
        await updateTenantTagMutation.mutateAsync({ tagId, color: newColor });
      } else {
        if (!companyId) return;
        await updateTagMutation.mutateAsync({ companyId, tagId, color: newColor });
      }
      setEditingTag(null);
      toast.success('Tag color updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tag');
    }
  }, [companyId, updateTagMutation, updateTenantTagMutation, toast]);

  // Handle tag deletion (manage dropdown) - supports both tenant and company tags
  const handleTagDelete = useCallback(async (tagId: string, scope: TagScope) => {
    try {
      if (scope === 'tenant') {
        // Delete tenant tag (admin only)
        await deleteWorkspaceTagMutation.mutateAsync({ tagId });
      } else {
        if (!companyId) return;
        await deleteTagMutation.mutateAsync({ companyId, tagId });
      }
      setDeleteConfirm(null);
      toast.success('Tag deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete tag');
    }
  }, [companyId, deleteTagMutation, deleteWorkspaceTagMutation, toast]);

  // Handle opening manage dropdown with position calculation
  const handleOpenManageDropdown = useCallback(() => {
    if (isManageOpen) {
      setIsManageOpen(false);
      setManageDropdownPos(null);
      return;
    }

    if (manageRef.current) {
      const rect = manageRef.current.getBoundingClientRect();
      const dropdownWidth = 288; // w-72 = 18rem = 288px
      const margin = 16;

      // Calculate left position - prefer aligning to button, but don't overflow right edge
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth - margin) {
        left = window.innerWidth - dropdownWidth - margin;
      }
      // Don't overflow left edge either
      if (left < margin) {
        left = margin;
      }

      setManageDropdownPos({
        top: rect.bottom + 8,
        left,
      });
    }
    setIsManageOpen(true);
  }, [isManageOpen]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchQuery('');
        setShowColorPicker(false);
      } else if (e.key === 'Enter' && searchQuery.trim() && !queryMatchesExisting) {
        e.preventDefault();
        handleCreateAndAddTag();
      }
    },
    [searchQuery, queryMatchesExisting, handleCreateAndAddTag]
  );

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Current Tags Display */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isLoadingDocTags ? (
          <span className="text-xs text-text-muted">Loading...</span>
        ) : documentTags.length === 0 && readOnly ? (
          <span className="text-xs text-text-muted">No tags</span>
        ) : (
          (limit ? documentTags.slice(0, limit) : documentTags).map((tag) => (
            <TagChip
              key={tag.id}
              name={tag.name}
              color={tag.color as TagColor}
              size="sm"
              scope={tag.scope}
              onRemove={readOnly ? undefined : () => handleRemoveTag(tag.tagId)}
              isLoading={removingTagId === tag.tagId}
            />
          ))
        )}
        {limit && documentTags.length > limit && (
          <span className="text-xs text-text-muted">+{documentTags.length - limit}</span>
        )}

        {!readOnly && (
          <>
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full',
                'text-text-muted hover:text-text-secondary',
                'hover:bg-background-tertiary transition-colors',
                'border border-dashed border-border-secondary hover:border-border-primary'
              )}
            >
              <Plus className="w-3 h-3" />
              <span>Add tag</span>
            </button>

            {/* Manage Tags Button */}
            <div ref={manageRef}>
              <button
                type="button"
                onClick={handleOpenManageDropdown}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full',
                  'text-text-muted hover:text-text-secondary',
                  'hover:bg-background-tertiary transition-colors',
                  'border border-dashed border-border-secondary hover:border-border-primary'
                )}
              >
                <Settings className="w-3 h-3" />
                <span>Manage</span>
              </button>

              {/* Manage Tags Dropdown - using fixed positioning to escape overflow */}
              {isManageOpen && manageDropdownPos && (
                <div
                  ref={manageDropdownRef}
                  className={cn(
                    'fixed z-[100] w-72',
                    'bg-background-elevated rounded-lg',
                    'border border-border-primary shadow-elevation-2',
                    'animate-in fade-in-0 zoom-in-95 duration-150'
                  )}
                  style={{
                    top: manageDropdownPos.top,
                    left: manageDropdownPos.left,
                  }}
                >
                  <div className="px-3 py-2.5 border-b border-border-primary">
                    <h4 className="text-sm font-medium text-text-primary">Manage Tags</h4>
                    <p className="text-2xs text-text-muted mt-0.5">Edit colors or delete tags</p>
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {isLoadingAllTags ? (
                      <p className="px-3 py-4 text-xs text-text-muted text-center">Loading...</p>
                    ) : allAvailableTags.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-text-muted text-center">
                        No tags created yet. Add tags to documents to create them.
                      </p>
                    ) : (
                      <div className="py-1">
                        {/* Shared Tags Section */}
                        {allAvailableTags.filter(t => t.scope === 'tenant').length > 0 && (
                          <>
                            <p className="px-3 py-1 text-2xs text-text-muted uppercase tracking-wider flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              Shared tags
                              {!isAdmin && <span className="text-text-tertiary ml-1">(view only)</span>}
                            </p>
                            {allAvailableTags.filter(t => t.scope === 'tenant').map((tag) => (
                              <div key={tag.id}>
                                {editingTag?.id === tag.id ? (
                                  // Color picker mode
                                  <div className="px-3 py-2 bg-background-secondary">
                                    <div className="flex items-center justify-between mb-2">
                                      <TagChip name={tag.name} color={editingTag.color} size="sm" scope="tenant" />
                                      <button
                                        type="button"
                                        onClick={() => setEditingTag(null)}
                                        className="text-xs text-text-muted hover:text-text-secondary"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(Object.keys(TAG_COLORS) as TagColor[]).map((color) => (
                                        <button
                                          key={color}
                                          type="button"
                                          onClick={() => handleTagColorChange(tag.id, color, 'tenant')}
                                          disabled={updateTenantTagMutation.isPending}
                                          className={cn(
                                            'w-6 h-6 rounded-full border-2 transition-all',
                                            TAG_COLORS[color].bg,
                                            editingTag.color === color
                                              ? 'border-text-primary scale-110'
                                              : 'border-transparent hover:border-border-primary hover:scale-105',
                                            'disabled:opacity-50'
                                          )}
                                          title={color.toLowerCase()}
                                        >
                                          {editingTag.color === color && (
                                            <Check className={cn('w-3 h-3 mx-auto', TAG_COLORS[color].text)} />
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : deleteConfirm?.id === tag.id ? (
                                  // Delete confirmation mode
                                  <div className="px-3 py-2 bg-status-error/5">
                                    <p className="text-xs text-text-secondary mb-2">
                                      Delete shared tag &quot;{tag.name}&quot;? This will remove it from all documents across all companies.
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleTagDelete(tag.id, 'tenant')}
                                        disabled={deleteWorkspaceTagMutation.isPending}
                                        className="px-2 py-1 text-xs bg-status-error text-white rounded hover:bg-status-error/90 disabled:opacity-50"
                                      >
                                        {deleteWorkspaceTagMutation.isPending ? 'Deleting...' : 'Delete'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeleteConfirm(null)}
                                        className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  // Normal display mode
                                  <div className="group flex items-center justify-between px-3 py-1.5 hover:bg-background-tertiary">
                                    <TagChip name={tag.name} color={tag.color} size="sm" scope="tenant" />
                                    {isAdmin && (
                                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          type="button"
                                          onClick={() => setEditingTag({ id: tag.id, name: tag.name, color: tag.color, scope: 'tenant' })}
                                          className="p-1 text-text-muted hover:text-text-secondary rounded hover:bg-background-secondary"
                                          title="Change color"
                                        >
                                          <div className={cn('w-4 h-4 rounded-full border', TAG_COLORS[tag.color].bg, TAG_COLORS[tag.color].border)} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setDeleteConfirm({ id: tag.id, scope: 'tenant' })}
                                          className="p-1 text-text-muted hover:text-status-error rounded hover:bg-background-secondary"
                                          title="Delete tag"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </>
                        )}

                        {/* Company Tags Section */}
                        {allAvailableTags.filter(t => t.scope === 'company').length > 0 && (
                          <>
                            <p className={cn(
                              'px-3 py-1 text-2xs text-text-muted uppercase tracking-wider flex items-center gap-1',
                              allAvailableTags.filter(t => t.scope === 'tenant').length > 0 && 'mt-2 pt-2 border-t border-border-primary'
                            )}>
                              <Tag className="w-3 h-3" />
                              Company tags
                            </p>
                            {allAvailableTags.filter(t => t.scope === 'company').map((tag) => (
                              <div key={tag.id}>
                                {editingTag?.id === tag.id ? (
                                  // Color picker mode
                                  <div className="px-3 py-2 bg-background-secondary">
                                    <div className="flex items-center justify-between mb-2">
                                      <TagChip name={tag.name} color={editingTag.color} size="sm" scope="company" />
                                      <button
                                        type="button"
                                        onClick={() => setEditingTag(null)}
                                        className="text-xs text-text-muted hover:text-text-secondary"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(Object.keys(TAG_COLORS) as TagColor[]).map((color) => (
                                        <button
                                          key={color}
                                          type="button"
                                          onClick={() => handleTagColorChange(tag.id, color, 'company')}
                                          disabled={updateTagMutation.isPending}
                                          className={cn(
                                            'w-6 h-6 rounded-full border-2 transition-all',
                                            TAG_COLORS[color].bg,
                                            editingTag.color === color
                                              ? 'border-text-primary scale-110'
                                              : 'border-transparent hover:border-border-primary hover:scale-105',
                                            'disabled:opacity-50'
                                          )}
                                          title={color.toLowerCase()}
                                        >
                                          {editingTag.color === color && (
                                            <Check className={cn('w-3 h-3 mx-auto', TAG_COLORS[color].text)} />
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : deleteConfirm?.id === tag.id ? (
                                  // Delete confirmation mode
                                  <div className="px-3 py-2 bg-status-error/5">
                                    <p className="text-xs text-text-secondary mb-2">
                                      Delete tag &quot;{tag.name}&quot;? This will remove it from all documents.
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleTagDelete(tag.id, 'company')}
                                        disabled={deleteTagMutation.isPending}
                                        className="px-2 py-1 text-xs bg-status-error text-white rounded hover:bg-status-error/90 disabled:opacity-50"
                                      >
                                        {deleteTagMutation.isPending ? 'Deleting...' : 'Delete'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeleteConfirm(null)}
                                        className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  // Normal display mode
                                  <div className="group flex items-center justify-between px-3 py-1.5 hover:bg-background-tertiary">
                                    <TagChip name={tag.name} color={tag.color} size="sm" scope="company" />
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        type="button"
                                        onClick={() => setEditingTag({ id: tag.id, name: tag.name, color: tag.color, scope: 'company' })}
                                        className="p-1 text-text-muted hover:text-text-secondary rounded hover:bg-background-secondary"
                                        title="Change color"
                                      >
                                        <div className={cn('w-4 h-4 rounded-full border', TAG_COLORS[tag.color].bg, TAG_COLORS[tag.color].border)} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeleteConfirm({ id: tag.id, scope: 'company' })}
                                        className="p-1 text-text-muted hover:text-status-error rounded hover:bg-background-secondary"
                                        title="Delete tag"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tag Input Dropdown */}
      {isOpen && (
        <div
          className={cn(
            'absolute z-50 mt-2 w-72',
            'bg-background-elevated rounded-lg',
            'border border-border-primary shadow-elevation-2',
            'animate-in fade-in-0 zoom-in-95 duration-150'
          )}
        >
          {/* Search Input */}
          <div className="p-2 border-b border-border-primary">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search or create tag..."
                className={cn(
                  'w-full pl-8 pr-3 py-1.5 text-sm rounded-md',
                  'bg-background-secondary border border-border-primary',
                  'focus:border-oak-light focus:outline-none',
                  'placeholder:text-text-muted'
                )}
              />
            </div>
          </div>

          {/* Tag List */}
          <div className="max-h-64 overflow-y-auto">
            {isSearching ? (
              <p className="px-3 py-4 text-xs text-text-muted text-center">Searching...</p>
            ) : debouncedQuery.length > 0 ? (
              // Search results
              availableSearchResults.length > 0 ? (
                <div className="py-1">
                  {availableSearchResults.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleAddTag(tag.id)}
                      disabled={addTagMutation.isPending}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                        'hover:bg-background-tertiary transition-colors',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    >
                      <TagChip name={tag.name} color={tag.color} size="xs" scope={tag.scope} />
                    </button>
                  ))}
                </div>
              ) : !queryMatchesExisting ? (
                <p className="px-3 py-3 text-xs text-text-muted text-center">
                  No matching tags found
                </p>
              ) : null
            ) : (
              // Not searching: show recent + tenant tags
              <div className="py-1">
                {/* Recent Tags Section */}
                {availableRecentTags.length > 0 && (
                  <>
                    <p className="px-3 py-1 text-2xs text-text-muted uppercase tracking-wider">
                      Recent tags
                    </p>
                    {availableRecentTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => handleAddTag(tag.id)}
                        disabled={addTagMutation.isPending}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                          'hover:bg-background-tertiary transition-colors',
                          'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                      >
                        <TagChip name={tag.name} color={tag.color} size="xs" scope={tag.scope} />
                      </button>
                    ))}
                  </>
                )}

                {/* Shared Tags Section */}
                {availableTenantTags.length > 0 && (
                  <>
                    <p className={cn(
                      'px-3 py-1 text-2xs text-text-muted uppercase tracking-wider flex items-center gap-1',
                      availableRecentTags.length > 0 && 'mt-2 pt-2 border-t border-border-primary'
                    )}>
                      <Globe className="w-3 h-3" />
                      Shared tags
                    </p>
                    {availableTenantTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => handleAddTag(tag.id)}
                        disabled={addTagMutation.isPending}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                          'hover:bg-background-tertiary transition-colors',
                          'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                      >
                        <TagChip name={tag.name} color={tag.color} size="xs" scope="tenant" />
                      </button>
                    ))}
                  </>
                )}

                {/* No tags at all */}
                {availableRecentTags.length === 0 && availableTenantTags.length === 0 && (
                  <p className="px-3 py-4 text-xs text-text-muted text-center">
                    No tags available. Start typing to create one.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Create New Tag Option */}
          {searchQuery.trim() && !queryMatchesExisting && (
            <div className="border-t border-border-primary">
              <button
                type="button"
                onClick={() => setShowColorPicker(!showColorPicker)}
                disabled={createAndAddMutation.isPending}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                  'hover:bg-background-tertiary transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center',
                    TAG_COLORS[newTagColor].bg,
                    TAG_COLORS[newTagColor].border,
                    'border'
                  )}
                >
                  <Plus className={cn('w-3 h-3', TAG_COLORS[newTagColor].text)} />
                </div>
                <span>
                  Create <span className="font-medium">&quot;{searchQuery.trim()}&quot;</span>
                </span>
              </button>

              {showColorPicker && (
                <div className="border-t border-border-primary">
                  <p className="px-3 pt-2 text-2xs text-text-muted uppercase tracking-wider">
                    Select color
                  </p>
                  <ColorPicker
                    selectedColor={newTagColor}
                    onColorSelect={(color) => {
                      setNewTagColor(color);
                      handleCreateAndAddTag();
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Keyboard hint */}
          {searchQuery.trim() && !queryMatchesExisting && !showColorPicker && (
            <div className="px-3 py-2 border-t border-border-primary">
              <p className="text-2xs text-text-muted">
                Press <kbd className="px-1 py-0.5 bg-background-secondary rounded text-text-secondary">Enter</kbd> to create with default color
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DocumentTags;

// ============================================================================
// TagManager Component - For managing tags (both tenant and company tags)
// ============================================================================

interface TagManagerProps {
  companyId: string | null;
  tenantId?: string | null;
  className?: string;
}

export function TagManager({ companyId, tenantId, className }: TagManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<{ id: string; name: string; color: TagColor; scope: TagScope } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; scope: TagScope } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<TagColor>('GRAY');
  const [newTagScope, setNewTagScope] = useState<TagScope>('company');
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const { data: session } = useSession();
  const isAdmin = session?.isSuperAdmin || session?.isWorkspaceAdmin;

  // Fetch tenant tags (requires tenantId for super admins)
  const { data: tenantTags = [], isLoading: isLoadingTenant } = useTenantTags(tenantId);
  // Fetch company tags (only when companyId is provided)
  const { data: companyTags = [], isLoading: isLoadingCompany } = useCompanyTags(companyId);

  const isLoading = isLoadingTenant || isLoadingCompany;

  // Combined tags for display
  const allTags = useMemo(() => {
    const tenant = tenantTags.map(t => ({ ...t, scope: 'tenant' as TagScope }));
    const company = companyTags.map(t => ({ ...t, scope: 'company' as TagScope }));
    return [...tenant, ...company];
  }, [tenantTags, companyTags]);

  const updateTagMutation = useUpdateTag();
  const deleteTagMutation = useDeleteTag();
  const updateTenantTagMutation = useUpdateTenantTag();
  const deleteWorkspaceTagMutation = useDeleteWorkspaceTag();
  const createTagMutation = useCreateTag();
  const createWorkspaceTagMutation = useCreateWorkspaceTag();

  // Click outside handler
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setEditingTag(null);
        setDeleteConfirm(null);
        setIsCreating(false);
        setNewTagName('');
        setNewTagColor('GRAY');
        setNewTagScope('company');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleColorChange = async (tagId: string, newColor: TagColor, scope: TagScope) => {
    try {
      if (scope === 'tenant') {
        await updateTenantTagMutation.mutateAsync({ tagId, color: newColor });
      } else {
        if (!companyId) return;
        await updateTagMutation.mutateAsync({ companyId, tagId, color: newColor });
      }
      setEditingTag(null);
      toast.success('Tag color updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tag');
    }
  };

  const handleDelete = async (tagId: string, scope: TagScope) => {
    try {
      if (scope === 'tenant') {
        await deleteWorkspaceTagMutation.mutateAsync({ tagId });
      } else {
        if (!companyId) return;
        await deleteTagMutation.mutateAsync({ companyId, tagId });
      }
      setDeleteConfirm(null);
      toast.success('Tag deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete tag');
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      if (newTagScope === 'tenant') {
        await createWorkspaceTagMutation.mutateAsync({
          name: newTagName.trim(),
          color: newTagColor,
          tenantId: tenantId || undefined,
        });
      } else {
        if (!companyId) {
          toast.error('Please select a company to create a company-specific tag');
          return;
        }
        await createTagMutation.mutateAsync({
          companyId,
          name: newTagName.trim(),
          color: newTagColor,
        });
      }
      setNewTagName('');
      setNewTagColor('GRAY');
      setNewTagScope('company');
      setIsCreating(false);
      toast.success(`${newTagScope === 'tenant' ? 'Shared' : 'Company'} tag created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tag');
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md',
          'text-text-secondary hover:text-text-primary',
          'hover:bg-background-tertiary transition-colors',
          'border border-border-secondary hover:border-border-primary'
        )}
      >
        <Tag className="w-3.5 h-3.5" />
        <span>Manage Tags</span>
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute z-50 mt-2 w-80 right-0',
            'bg-background-elevated rounded-lg',
            'border border-border-primary shadow-elevation-2',
            'animate-in fade-in-0 zoom-in-95 duration-150'
          )}
        >
          <div className="px-3 py-2.5 border-b border-border-primary flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-text-primary">Manage Tags</h4>
              <p className="text-2xs text-text-muted mt-0.5">Edit colors or delete tags</p>
            </div>
            {/* Create new tag button - only for admins or when company is selected */}
            {(isAdmin || companyId) && (
              <button
                type="button"
                onClick={() => {
                  setIsCreating(true);
                  // Default to workspace scope for admins when no company, otherwise company
                  setNewTagScope(companyId ? 'company' : 'tenant');
                }}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded',
                  'text-text-secondary hover:text-text-primary',
                  'hover:bg-background-tertiary transition-colors'
                )}
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {/* Create New Tag Form */}
            {isCreating && (
              <div className="px-3 py-3 bg-background-secondary border-b border-border-primary">
                <div className="space-y-3">
                  <div>
                    <label className="text-2xs text-text-muted uppercase tracking-wider block mb-1">Tag Name</label>
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="Enter tag name..."
                      className="input input-sm w-full"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="text-2xs text-text-muted uppercase tracking-wider block mb-1">Color</label>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(TAG_COLORS) as TagColor[]).map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewTagColor(color)}
                          className={cn(
                            'w-6 h-6 rounded-full border-2 transition-all',
                            TAG_COLORS[color].bg,
                            newTagColor === color
                              ? 'border-text-primary scale-110'
                              : 'border-transparent hover:border-border-primary hover:scale-105'
                          )}
                          title={color.toLowerCase()}
                        >
                          {newTagColor === color && (
                            <Check className={cn('w-3 h-3 mx-auto', TAG_COLORS[color].text)} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Scope selector - only show for admins when company is selected */}
                  {isAdmin && companyId && (
                    <div>
                      <label className="text-2xs text-text-muted uppercase tracking-wider block mb-1">Scope</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setNewTagScope('company')}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border transition-all',
                            newTagScope === 'company'
                              ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                              : 'border-border-secondary text-text-secondary hover:border-border-primary'
                          )}
                        >
                          <Tag className="w-3 h-3" />
                          Company
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewTagScope('tenant')}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border transition-all',
                            newTagScope === 'tenant'
                              ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                              : 'border-border-secondary text-text-secondary hover:border-border-primary'
                          )}
                        >
                          <Globe className="w-3 h-3" />
                          Shared
                        </button>
                      </div>
                      <p className="text-2xs text-text-muted mt-1">
                        {newTagScope === 'tenant'
                          ? 'Shared tags are available across all companies'
                          : 'Company tags are only available to this company'}
                      </p>
                    </div>
                  )}

                  {/* For admins with no company, only tenant tags */}
                  {isAdmin && !companyId && (
                    <p className="text-2xs text-text-muted">
                      <Globe className="w-3 h-3 inline mr-1" />
                      Creating a shared tag (available across all companies)
                    </p>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCreateTag}
                      disabled={!newTagName.trim() || createTagMutation.isPending || createWorkspaceTagMutation.isPending}
                      className="btn-primary btn-sm flex-1"
                    >
                      {createTagMutation.isPending || createWorkspaceTagMutation.isPending ? 'Creating...' : 'Create Tag'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreating(false);
                        setNewTagName('');
                        setNewTagColor('GRAY');
                        setNewTagScope('company');
                      }}
                      className="btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isLoading ? (
              <p className="px-3 py-4 text-xs text-text-muted text-center">Loading...</p>
            ) : allTags.length === 0 ? (
              <p className="px-3 py-4 text-xs text-text-muted text-center">
                No tags created yet. {isAdmin || companyId ? 'Click "New" to create one.' : 'Add tags to documents to create them.'}
              </p>
            ) : (
              <div className="py-1">
                {/* Shared Tags Section */}
                {tenantTags.length > 0 && (
                  <>
                    <p className="px-3 py-1 text-2xs text-text-muted uppercase tracking-wider flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      Shared tags
                      {!isAdmin && <span className="text-text-tertiary ml-1">(view only)</span>}
                    </p>
                    {tenantTags.map((tag) => (
                      <div key={tag.id}>
                        {editingTag?.id === tag.id ? (
                          // Color picker mode
                          <div className="px-3 py-2 bg-background-secondary">
                            <div className="flex items-center justify-between mb-2">
                              <TagChip name={tag.name} color={editingTag.color} size="sm" scope="tenant" />
                              <button
                                type="button"
                                onClick={() => setEditingTag(null)}
                                className="text-xs text-text-muted hover:text-text-secondary"
                              >
                                Cancel
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {(Object.keys(TAG_COLORS) as TagColor[]).map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => handleColorChange(tag.id, color, 'tenant')}
                                  disabled={updateTenantTagMutation.isPending}
                                  className={cn(
                                    'w-6 h-6 rounded-full border-2 transition-all',
                                    TAG_COLORS[color].bg,
                                    editingTag.color === color
                                      ? 'border-text-primary scale-110'
                                      : 'border-transparent hover:border-border-primary hover:scale-105',
                                    'disabled:opacity-50'
                                  )}
                                  title={color.toLowerCase()}
                                >
                                  {editingTag.color === color && (
                                    <Check className={cn('w-3 h-3 mx-auto', TAG_COLORS[color].text)} />
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : deleteConfirm?.id === tag.id ? (
                          // Delete confirmation mode
                          <div className="px-3 py-2 bg-status-error/5">
                            <p className="text-xs text-text-secondary mb-2">
                              Delete shared tag &quot;{tag.name}&quot;? This will remove it from all documents across all companies.
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDelete(tag.id, 'tenant')}
                                disabled={deleteWorkspaceTagMutation.isPending}
                                className="px-2 py-1 text-xs bg-status-error text-white rounded hover:bg-status-error/90 disabled:opacity-50"
                              >
                                {deleteWorkspaceTagMutation.isPending ? 'Deleting...' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm(null)}
                                className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          // Normal display mode
                          <div className="group flex items-center justify-between px-3 py-1.5 hover:bg-background-tertiary">
                            <TagChip name={tag.name} color={tag.color} size="sm" scope="tenant" />
                            {isAdmin && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => setEditingTag({ id: tag.id, name: tag.name, color: tag.color, scope: 'tenant' })}
                                  className="p-1 text-text-muted hover:text-text-secondary rounded hover:bg-background-secondary"
                                  title="Change color"
                                >
                                  <div className={cn('w-4 h-4 rounded-full border', TAG_COLORS[tag.color].bg, TAG_COLORS[tag.color].border)} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirm({ id: tag.id, scope: 'tenant' })}
                                  className="p-1 text-text-muted hover:text-status-error rounded hover:bg-background-secondary"
                                  title="Delete tag"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {/* Company Tags Section */}
                {companyTags.length > 0 && (
                  <>
                    <p className={cn(
                      'px-3 py-1 text-2xs text-text-muted uppercase tracking-wider flex items-center gap-1',
                      tenantTags.length > 0 && 'mt-2 pt-2 border-t border-border-primary'
                    )}>
                      <Tag className="w-3 h-3" />
                      Company tags
                    </p>
                    {companyTags.map((tag) => (
                      <div key={tag.id}>
                        {editingTag?.id === tag.id ? (
                          // Color picker mode
                          <div className="px-3 py-2 bg-background-secondary">
                            <div className="flex items-center justify-between mb-2">
                              <TagChip name={tag.name} color={editingTag.color} size="sm" scope="company" />
                              <button
                                type="button"
                                onClick={() => setEditingTag(null)}
                                className="text-xs text-text-muted hover:text-text-secondary"
                              >
                                Cancel
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {(Object.keys(TAG_COLORS) as TagColor[]).map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => handleColorChange(tag.id, color, 'company')}
                                  disabled={updateTagMutation.isPending}
                                  className={cn(
                                    'w-6 h-6 rounded-full border-2 transition-all',
                                    TAG_COLORS[color].bg,
                                    editingTag.color === color
                                      ? 'border-text-primary scale-110'
                                      : 'border-transparent hover:border-border-primary hover:scale-105',
                                    'disabled:opacity-50'
                                  )}
                                  title={color.toLowerCase()}
                                >
                                  {editingTag.color === color && (
                                    <Check className={cn('w-3 h-3 mx-auto', TAG_COLORS[color].text)} />
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : deleteConfirm?.id === tag.id ? (
                          // Delete confirmation mode
                          <div className="px-3 py-2 bg-status-error/5">
                            <p className="text-xs text-text-secondary mb-2">
                              Delete tag &quot;{tag.name}&quot;? This will remove it from all documents.
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDelete(tag.id, 'company')}
                                disabled={deleteTagMutation.isPending}
                                className="px-2 py-1 text-xs bg-status-error text-white rounded hover:bg-status-error/90 disabled:opacity-50"
                              >
                                {deleteTagMutation.isPending ? 'Deleting...' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm(null)}
                                className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          // Normal display mode
                          <div className="group flex items-center justify-between px-3 py-1.5 hover:bg-background-tertiary">
                            <TagChip name={tag.name} color={tag.color} size="sm" scope="company" />
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => setEditingTag({ id: tag.id, name: tag.name, color: tag.color, scope: 'company' })}
                                className="p-1 text-text-muted hover:text-text-secondary rounded hover:bg-background-secondary"
                                title="Change color"
                              >
                                <div className={cn('w-4 h-4 rounded-full border', TAG_COLORS[tag.color].bg, TAG_COLORS[tag.color].border)} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm({ id: tag.id, scope: 'company' })}
                                className="p-1 text-text-muted hover:text-status-error rounded hover:bg-background-secondary"
                                title="Delete tag"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

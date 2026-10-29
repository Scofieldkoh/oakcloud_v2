'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, X, Pencil, Save, Loader2, StickyNote } from 'lucide-react';
import { RichTextEditor, RichTextDisplay } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import {
  useNoteTabs,
  useCreateNoteTab,
  useUpdateNoteTab,
  useDeleteNoteTab,
  type EntityType,
  type NoteTab,
} from '@/hooks/use-notes';

// ============================================================================
// Types
// ============================================================================

interface InternalNotesProps {
  entityType: EntityType;
  entityId: string;
  canEdit: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function InternalNotes({
  entityType,
  entityId,
  canEdit,
}: InternalNotesProps) {
  // Queries and mutations
  const { data: tabs = [], isLoading, error } = useNoteTabs(entityType, entityId);
  const createMutation = useCreateNoteTab(entityType, entityId);
  const updateMutation = useUpdateNoteTab(entityType, entityId);
  const deleteMutation = useDeleteNoteTab(entityType, entityId);

  // Local state
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<NoteTab | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Set active tab when tabs load or change
  useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
      setActiveTabId(tabs[0].id);
    } else if (tabs.length > 0 && !tabs.find((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    } else if (tabs.length === 0) {
      setActiveTabId(null);
    }
  }, [tabs, activeTabId]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // Get active tab
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Handlers
  const handleAddTab = async () => {
    try {
      const newTab = await createMutation.mutateAsync({ title: 'New Tab' });
      setActiveTabId(newTab.id);
      setEditingTitle(newTab.id);
      setTitleInput(newTab.title);
    } catch {
      toast.error('Failed to create tab');
    }
  };

  const handleTitleSave = async (tabId: string) => {
    const trimmedTitle = titleInput.trim();
    if (!trimmedTitle) {
      setEditingTitle(null);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        tabId,
        data: { title: trimmedTitle },
      });
      setEditingTitle(null);
    } catch {
      toast.error('Failed to rename tab');
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent, tabId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSave(tabId);
    } else if (e.key === 'Escape') {
      setEditingTitle(null);
    }
  };

  const handleDeleteClick = (tab: NoteTab, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirm(tab);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;

    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      toast.success('Tab deleted');
      setDeleteConfirm(null);
    } catch {
      toast.error('Failed to delete tab');
    }
  };

  const handleEditClick = () => {
    if (!activeTab) return;
    setEditedContent(activeTab.content || '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!activeTab) return;

    try {
      await updateMutation.mutateAsync({
        tabId: activeTab.id,
        data: { content: editedContent },
      });
      setIsEditing(false);
      toast.success('Notes saved');
    } catch {
      toast.error('Failed to save notes');
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedContent('');
  };

  // Handler for rename button click
  const handleRenameClick = (tab: NoteTab, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    setEditingTitle(tab.id);
    setTitleInput(tab.title);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="mt-6 card">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
          <span className="ml-2 text-text-muted">Loading notes...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="mt-6 card">
        <div className="flex items-center justify-center py-8 text-status-error">
          Failed to load notes
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="card overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border-primary flex items-center justify-between">
          <h2 className="font-medium text-text-primary flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-text-tertiary" />
            Internal Notes
          </h2>
          {canEdit && activeTab && !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEditClick}
              className="flex items-center gap-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
          )}
          {canEdit && isEditing && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="flex items-center gap-1"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex items-center border-b border-border-primary overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => !editingTitle && setActiveTabId(tab.id)}
              className={`group flex items-center gap-1 px-3 py-2 border-r border-border-primary cursor-pointer transition-colors min-w-0 ${
                tab.id === activeTabId
                  ? 'bg-background-tertiary text-text-primary'
                  : 'text-text-muted hover:bg-background-secondary hover:text-text-primary'
              }`}
            >
              {editingTitle === tab.id ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onBlur={() => handleTitleSave(tab.id)}
                  onKeyDown={(e) => handleTitleKeyDown(e, tab.id)}
                  className="w-24 px-1 py-0.5 text-xs border border-accent-primary rounded bg-background-elevated outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="text-xs font-medium truncate max-w-[100px]">
                    {tab.title}
                  </span>
                  {canEdit && (
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleRenameClick(tab, e)}
                        className="p-0.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                        title="Rename tab"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(tab, e)}
                        className="p-0.5 rounded hover:bg-background-tertiary text-text-muted hover:text-status-error transition-colors"
                        title="Delete tab"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {canEdit && (
            <button
              onClick={handleAddTab}
              disabled={createMutation.isPending}
              className="flex items-center justify-center px-3 py-2 text-text-muted hover:text-text-primary hover:bg-background-secondary transition-colors"
              title="Add new tab"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        {/* Content Area */}
        <div
          className="min-h-[400px] overflow-auto resize-y"
          style={{ maxHeight: '800px' }}
        >
          {tabs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted">
              <p className="text-sm">No notes yet</p>
              {canEdit && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={handleAddTab}
                  className="mt-2"
                  disabled={createMutation.isPending}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Tab
                </Button>
              )}
            </div>
          ) : activeTab ? (
            isEditing ? (
              <RichTextEditor
                value={editedContent}
                onChange={setEditedContent}
                minHeight={380}
                placeholder="Enter your notes here..."
                className="border-0 rounded-none"
              />
            ) : (
              <div className="p-3">
                {activeTab.content ? (
                  <RichTextDisplay content={activeTab.content} />
                ) : (
                  <p className="text-sm text-text-muted italic">
                    No content. {canEdit && 'Click Edit to add notes.'}
                  </p>
                )}
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Tab"
        description={
          deleteConfirm?.content
            ? `Are you sure you want to delete "${deleteConfirm.title}"? This tab has content that will be permanently lost.`
            : `Are you sure you want to delete "${deleteConfirm?.title}"?`
        }
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

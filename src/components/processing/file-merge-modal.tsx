'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  GripVertical,
  Trash2,
  FileUp,
  Image as ImageIcon,
  FileText,
  Loader2,
  Merge,
  ClipboardPaste,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { mergeFilesToPdf, isSupportedFileType } from '@/lib/pdf-utils';

interface MergeFile {
  id: string;
  file: File;
  preview?: string;
}

interface FileMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMergeComplete: (mergedFile: File) => void;
  initialFiles?: File[];
}

const MAX_MERGE_FILES = 50;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file

/**
 * FileMergeModal - Modal for combining multiple files into a single PDF
 *
 * Features:
 * - Drag & drop file reordering
 * - Paste support (Ctrl+V)
 * - Drop zone for adding files
 * - Preview thumbnails
 * - Remove individual files
 */
export function FileMergeModal({
  isOpen,
  onClose,
  onMergeComplete,
  initialFiles = [],
}: FileMergeModalProps) {
  const [files, setFiles] = useState<MergeFile[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  // Initialize with initial files or clear when modal opens fresh
  useEffect(() => {
    // Only run when modal transitions from closed to open
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      if (initialFiles.length > 0) {
        const mergeFiles = initialFiles.map((file) => ({
          id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        }));
        setFiles(mergeFiles);
      } else {
        // Clear files when modal opens with no initial files
        setFiles((prev) => {
          prev.forEach((f) => {
            if (f.preview) URL.revokeObjectURL(f.preview);
          });
          return [];
        });
      }
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, initialFiles]);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      files.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, [files]);

  // Add files to the merge list
  const addFiles = useCallback((newFiles: File[]) => {
    const validFiles = newFiles.filter((f) => isSupportedFileType(f) && f.size <= MAX_FILE_SIZE);

    const mergeFiles: MergeFile[] = validFiles.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));

    setFiles((prev) => {
      const combined = [...prev, ...mergeFiles];
      return combined.slice(0, MAX_MERGE_FILES);
    });
  }, []);

  // Handle paste event
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && isSupportedFileType(file)) {
            pastedFiles.push(file);
          }
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        addFiles(pastedFiles);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isOpen, addFiles]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: addFiles,
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/tiff': ['.tif', '.tiff'],
    },
    maxSize: MAX_FILE_SIZE,
    disabled: isMerging,
    noClick: false,
    noKeyboard: false,
  });

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const clearAll = () => {
    files.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setFiles([]);
  };

  // Drag and drop reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    setFiles((prev) => {
      const newFiles = [...prev];
      const [draggedFile] = newFiles.splice(draggedIndex, 1);
      newFiles.splice(dropIndex, 0, draggedFile);
      return newFiles;
    });

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleMerge = useCallback(async () => {
    if (files.length < 2) return;

    setIsMerging(true);
    setMergeError(null);
    try {
      const mergedFile = await mergeFilesToPdf(files.map((f) => f.file));
      onMergeComplete(mergedFile);
      onClose();
    } catch (err) {
      console.error('Merge failed:', err);
      setMergeError('Failed to merge files. Please try again.');
    } finally {
      setIsMerging(false);
    }
  }, [files, onMergeComplete, onClose]);

    // Keyboard hotkeys (Escape to cancel, Ctrl+M to merge)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Skip when typing in inputs
      const isInInput = e.target instanceof HTMLInputElement ||
                        e.target instanceof HTMLSelectElement ||
                        e.target instanceof HTMLTextAreaElement;

      // Escape - Cancel (works even in input fields)
      if (e.key === 'Escape' && !isMerging) {
        e.preventDefault();
        onClose();
        return;
      }

      if (isInInput) return;

      // Ctrl+M - Merge files
      if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M') && !isMerging && files.length >= 2) {
        e.preventDefault();
        handleMerge();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMerging, onClose, files.length, handleMerge]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div
        ref={containerRef}
        className="bg-background-primary rounded-lg shadow-xl w-full max-w-lg sm:max-w-3xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border-primary">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-text-primary flex items-center gap-2">
              <Merge className="w-4 h-4 sm:w-5 sm:h-5 text-oak-primary" />
              Merge Files into PDF
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary mt-0.5">
              Combine multiple files into a single PDF document
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isMerging}
            className="btn-ghost btn-xs btn-icon"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drop zone for adding more files */}
        <div className="px-4 sm:px-6 pt-3 sm:pt-4">
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-lg p-3 sm:p-4 text-center cursor-pointer transition-colors',
              isDragActive
                ? 'border-oak-primary bg-oak-primary/5'
                : 'border-border-secondary hover:border-oak-primary/50'
            )}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 text-text-secondary">
              <FileUp className="w-5 h-5" />
              <span className="text-xs sm:text-sm text-center">
                Drop files here, click to browse, or <kbd className="px-1.5 py-0.5 bg-background-tertiary rounded text-xs">Ctrl+V</kbd> to paste
              </span>
            </div>
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 sm:py-4">
          {files.length === 0 ? (
            <div className="text-center py-8 sm:py-12 text-text-muted">
              <ClipboardPaste className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm sm:text-base">No files added yet</p>
              <p className="text-xs sm:text-sm mt-1">Drag files here, browse, or paste from clipboard</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-text-secondary">
                  {files.length} file{files.length !== 1 ? 's' : ''} • Drag to reorder
                </span>
                <button
                  onClick={clearAll}
                  disabled={isMerging}
                  className="btn-ghost btn-xs text-status-error hover:text-status-error"
                >
                  Clear All
                </button>
              </div>

              {files.map((mergeFile, index) => (
                <div
                  key={mergeFile.id}
                  draggable={!isMerging}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border transition-all',
                    draggedIndex === index
                      ? 'opacity-50 border-oak-primary bg-oak-primary/5'
                      : dragOverIndex === index
                      ? 'border-oak-primary border-2'
                      : 'border-border-secondary bg-background-secondary hover:border-border-primary',
                    isMerging && 'cursor-not-allowed'
                  )}
                >
                  {/* Drag handle */}
                  <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary">
                    <GripVertical className="w-4 h-4" />
                  </div>

                  {/* Order number */}
                  <span className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-background-tertiary text-text-secondary text-xs font-medium flex items-center justify-center">
                    {index + 1}
                  </span>

                  {/* Thumbnail or icon */}
                  <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded bg-background-tertiary flex items-center justify-center overflow-hidden">
                    {mergeFile.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- File preview data URLs
                      <img
                        src={mergeFile.preview}
                        alt={mergeFile.file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : mergeFile.file.type === 'application/pdf' ? (
                      <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-status-error" />
                    ) : (
                      <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 text-oak-primary" />
                    )}
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-text-primary truncate">{mergeFile.file.name}</p>
                    <p className="text-xs text-text-muted">
                      {mergeFile.file.size >= 1024 * 1024
                        ? `${(mergeFile.file.size / 1024 / 1024).toFixed(1)} MB`
                        : `${(mergeFile.file.size / 1024).toFixed(1)} KB`}
                    </p>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={() => removeFile(mergeFile.id)}
                    disabled={isMerging}
                    className="flex-shrink-0 p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-status-error transition-colors"
                    title="Remove file"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {mergeError ? (
          <p role="alert" className="border-t border-border-primary px-4 py-2 text-sm text-status-error sm:px-6">{mergeError}</p>
        ) : null}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-border-primary bg-background-secondary">
          <p className="text-xs text-text-muted text-center sm:text-left">
            Files will be merged in the order shown above
          </p>
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            <button
              onClick={onClose}
              disabled={isMerging}
              className="btn-secondary btn-sm text-center"
              title="Cancel (Esc)"
            >
              Cancel (Esc)
            </button>
            <button
              onClick={handleMerge}
              disabled={isMerging || files.length < 2}
              className="btn-primary btn-sm flex items-center justify-center gap-2"
              title="Merge files (Ctrl+M)"
            >
              {isMerging ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <Merge className="w-4 h-4" />
                  Merge {files.length} Files (Ctrl+M)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

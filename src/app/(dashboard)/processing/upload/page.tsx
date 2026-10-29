'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import {
  ArrowLeft,
  FileUp,
  File,
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Building2,
  RotateCcw,
  Merge,
  ClipboardPaste,
  Image as ImageIcon,
  FileText,
  Copy,
  Settings,
} from 'lucide-react';
import { useSession } from '@/hooks/use-auth';
import { useCompanySearch } from '@/hooks/use-company-search';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useActiveCompanyId } from '@/components/ui/company-selector';
import { AsyncSearchSelect } from '@/components/ui/async-search-select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { AIModelSelector, buildFullContext } from '@/components/ui/ai-model-selector';
import { FileMergeModal } from '@/components/processing/file-merge-modal';
import { DocumentExtractionPromptModal } from '@/components/processing/document-extraction-prompt-modal';
import { useDocumentExtractionPromptSettings } from '@/hooks/use-document-extraction-prompt-settings';
import { processFileForUpload, isSupportedFileType } from '@/lib/pdf-utils';
import { calculateFileHash } from '@/lib/file-hash';
import { cn } from '@/lib/utils';
import { postFormDataWithFallback } from '@/lib/browser-upload';
import { MISTRAL_OCR_MODEL_ID } from '@/lib/ocr/constants';
import { AI_MODELS } from '@/lib/ai/models';
import type { AIModel } from '@/lib/ai/types';

type UploadStatus = 'pending' | 'processing' | 'uploading' | 'success' | 'error';

interface DuplicateInfo {
  documentId: string;
  fileName: string;
  uploadedAt: string;
}

interface QueuedFile {
  file: File;
  id: string;
  status: UploadStatus;
  error?: string;
  processingDocumentId?: string;
  originalFile?: File; // Keep reference to original file before processing
  fileHash?: string; // SHA-256 hash for duplicate detection
  isDuplicate?: boolean; // Whether this file is a duplicate
  duplicateInfo?: DuplicateInfo; // Info about the existing duplicate
  uploadAnyway?: boolean; // User override to upload despite duplicate
}

const MAX_FILES = 100;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB to match API

function getBatchProcessingProvider(modelId: string): 'mistral' | 'openai' | null {
  if (modelId === MISTRAL_OCR_MODEL_ID) {
    return 'mistral';
  }

  const modelConfig = AI_MODELS[modelId as AIModel];
  return modelConfig?.provider === 'openai' ? 'openai' : null;
}

export default function ProcessingUploadPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { success, error: toastError, info } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  // Get active tenant and company
  const isSuperAdmin = session?.isSuperAdmin ?? false;
  const activeTenantId = useActiveWorkspaceId(isSuperAdmin, session?.tenantId);
  const activeCompanyId = useActiveCompanyId();

  // State
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [uploadWithoutAiExtraction, setUploadWithoutAiExtraction] = useState(false);
  const [useBatchProcessing, setUseBatchProcessing] = useState(false);

  // AI model selection and context (consistent with BizFile upload)
  const [selectedModelId, setSelectedModelId] = useState('');
  const [companyContext, setCompanyContext] = useState(''); // Auto-populated from company
  const [aiContext, setAiContext] = useState(''); // User's additional context
  const [selectedStandardContexts, setSelectedStandardContexts] = useState<string[]>([]);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const previousBatchProviderRef = useRef<'mistral' | 'openai' | null>(null);
  const {
    settings: promptSettings,
    setSettings: setPromptSettings,
    standardContextOptions,
  } = useDocumentExtractionPromptSettings(!uploadWithoutAiExtraction);
  const {
    searchQuery: companySearchQuery,
    setSearchQuery: setCompanySearchQuery,
    options: companyOptions,
    isLoading: isLoadingCompanies,
    selectedCompany,
    setSelectedCompany,
  } = useCompanySearch({ minChars: 0, limit: 50 });

  // Clear extraction-specific fields when extraction is disabled
  useEffect(() => {
    if (!uploadWithoutAiExtraction) return;
    setSelectedModelId('');
    setUseBatchProcessing(false);
    setAiContext('');
    setSelectedStandardContexts([]);
  }, [uploadWithoutAiExtraction]);

  useEffect(() => {
    const batchProvider = getBatchProcessingProvider(selectedModelId);

    if (batchProvider === 'mistral') {
      setUseBatchProcessing(true);
    } else if (batchProvider === 'openai' && previousBatchProviderRef.current !== 'openai') {
      setUseBatchProcessing(false);
    } else if (!batchProvider) {
      setUseBatchProcessing(false);
    }

    previousBatchProviderRef.current = batchProvider;
  }, [selectedModelId]);

  // Update selected company when activeCompanyId changes or the initial option page loads.
  useEffect(() => {
    if (selectedCompanyId) return;

    const activeCompany = activeCompanyId
      ? companyOptions.find((company) => company.id === activeCompanyId)
      : null;

    if (activeCompany && activeCompanyId) {
      setSelectedCompanyId(activeCompanyId);
      setSelectedCompany(activeCompany);
    }
  }, [activeCompanyId, companyOptions, selectedCompanyId, setSelectedCompany]);

  // Auto-populate company context when company is selected (separate from user's additional context)
  useEffect(() => {
    if (selectedCompanyId) {
      const company = selectedCompany?.id === selectedCompanyId ? selectedCompany : null;
      if (company) {
        const contextParts: string[] = [];

        // Company name (clearly labeled as uploading company)
        contextParts.push(`Uploading Company: ${company.name}`);

        // Business nature from SSIC description
        if (company.primarySsicDescription) {
          contextParts.push(`Business Nature: ${company.primarySsicDescription}`);
        }

        // Home currency
        if (company.homeCurrency) {
          contextParts.push(`Home Currency: ${company.homeCurrency}`);
        }

        // Add explicit business relationship guidance for AI extraction
        contextParts.push('');
        contextParts.push('IMPORTANT BUSINESS CONTEXT:');
        contextParts.push(`- "${company.name}" is uploading this document for processing`);
        contextParts.push(`- For ACCOUNTS_PAYABLE (vendor invoices/bills): "${company.name}" is the BUYER/RECIPIENT - the vendor/supplier name must be a DIFFERENT company`);
        contextParts.push(`- For ACCOUNTS_RECEIVABLE (sales invoices): "${company.name}" is the SELLER/ISSUER - extract the customer name as the other party`);

        setCompanyContext(contextParts.join('\n'));
      } else {
        setCompanyContext('');
      }
    } else {
      setCompanyContext('');
    }
  }, [selectedCompanyId, selectedCompany]);

  // Check files for duplicates against server
  const checkFilesForDuplicates = useCallback(async (files: QueuedFile[]) => {
    if (!selectedCompanyId || files.length === 0) return;

    try {
      // Calculate hashes for all files
      const hashPromises = files.map(async (qf) => {
        const hash = await calculateFileHash(qf.file);
        return { id: qf.id, hash };
      });
      const hashResults = await Promise.all(hashPromises);

      // Update files with their hashes
      setQueuedFiles((prev) =>
        prev.map((f) => {
          const result = hashResults.find((h) => h.id === f.id);
          return result ? { ...f, fileHash: result.hash } : f;
        })
      );

      // Check hashes against server
      const hashes = hashResults.map((h) => h.hash);
      const response = await fetch('/api/processing-documents/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileHashes: hashes, companyId: selectedCompanyId }),
      });

      if (response.ok) {
        const { data } = await response.json();
        const duplicateMap = new Map(
          data.duplicates.map((d: DuplicateInfo & { hash: string }) => [d.hash, d])
        );

        // Mark duplicate files
        setQueuedFiles((prev) =>
          prev.map((f) => {
            if (f.fileHash && duplicateMap.has(f.fileHash)) {
              const dupInfo = duplicateMap.get(f.fileHash) as DuplicateInfo & { hash: string };
              return {
                ...f,
                isDuplicate: true,
                duplicateInfo: {
                  documentId: dupInfo.documentId,
                  fileName: dupInfo.fileName,
                  uploadedAt: dupInfo.uploadedAt,
                },
              };
            }
            return f;
          })
        );

        if (data.duplicateCount > 0) {
          info(`${data.duplicateCount} file(s) already exist in the system`);
        }
      }
    } catch (err) {
      console.error('Duplicate check failed:', err);
    }
  }, [selectedCompanyId, info]);

  // File queue management
  const addFilesToQueue = useCallback((acceptedFiles: File[]) => {
    const newFiles: QueuedFile[] = acceptedFiles.map((file) => ({
      file,
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending' as UploadStatus,
      originalFile: file,
    }));

    setQueuedFiles((prev) => {
      const combined = [...prev, ...newFiles];
      if (combined.length > MAX_FILES) {
        toastError(`Maximum ${MAX_FILES} files allowed. Some files were not added.`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });

    // Check for duplicates after adding (only if company selected)
    if (selectedCompanyId) {
      setTimeout(() => checkFilesForDuplicates(newFiles), 100);
    }
  }, [toastError, selectedCompanyId, checkFilesForDuplicates]);

  // Check for files passed from processing page on mount
  useEffect(() => {
    const windowWithFiles = window as Window & { __pendingUploadFiles?: FileList };
    const pendingFiles = windowWithFiles.__pendingUploadFiles;
    if (pendingFiles && pendingFiles.length > 0) {
      const filesArray = Array.from(pendingFiles);
      addFilesToQueue(filesArray);

      // Clean up
      delete windowWithFiles.__pendingUploadFiles;
      sessionStorage.removeItem('pendingUploadFiles');

      info(`${filesArray.length} file${filesArray.length > 1 ? 's' : ''} ready to upload`);
    }
  }, [addFilesToQueue, info]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    addFilesToQueue(acceptedFiles);
  }, [addFilesToQueue]);

  // Handle paste event for the entire page
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Don't handle if merge modal is open (it has its own paste handler)
      if (isMergeModalOpen) return;

      // Don't intercept paste in input/textarea elements
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

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
        info(`Pasted ${pastedFiles.length} file${pastedFiles.length > 1 ? 's' : ''}`);
        addFilesToQueue(pastedFiles);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isMergeModalOpen, addFilesToQueue, info]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/tiff': ['.tif', '.tiff'],
    },
    maxSize: MAX_FILE_SIZE,
    disabled: isUploading,
    onDropRejected: (rejections) => {
      rejections.forEach((rejection) => {
        const fileName = rejection.file.name;
        const errors = rejection.errors.map((e) => e.message).join(', ');
        toastError(`${fileName}: ${errors}`);
      });
    },
  });

  const removeFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearAllFiles = () => {
    setQueuedFiles([]);
  };

  const retryFile = (id: string) => {
    setQueuedFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status: 'pending' as UploadStatus, error: undefined } : f
      )
    );
  };

  const retryAllFailed = () => {
    setQueuedFiles((prev) =>
      prev.map((f) =>
        f.status === 'error' ? { ...f, status: 'pending' as UploadStatus, error: undefined } : f
      )
    );
  };

  const handleMergeComplete = (mergedFile: File) => {
    // Add the merged file to the queue
    addFilesToQueue([mergedFile]);
    success('Files merged successfully');
  };

  const openMergeModal = useCallback(() => {
    setIsMergeModalOpen(true);
  }, []);

  const uploadFiles = useCallback(async () => {
    if (!selectedCompanyId) {
      toastError('Please select a company');
      return;
    }

    if (queuedFiles.length === 0) {
      toastError('Please add files to upload');
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    const fullContext = uploadWithoutAiExtraction
      ? ''
      : [
        companyContext,
        buildFullContext(selectedStandardContexts, aiContext, standardContextOptions),
      ].filter(Boolean).join('\n\n');

    for (const queuedFile of queuedFiles) {
      if (queuedFile.status === 'success') {
        successCount++;
        continue;
      }

      // Step 1: Process file (convert images to PDF, compress large PDFs)
      setQueuedFiles((prev) =>
        prev.map((f) =>
          f.id === queuedFile.id ? { ...f, status: 'processing' as UploadStatus } : f
        )
      );

      let processedFile: File;
      try {
        processedFile = await processFileForUpload(queuedFile.file);
      } catch (err) {
        console.error('File processing failed:', err);
        setQueuedFiles((prev) =>
          prev.map((f) =>
            f.id === queuedFile.id
              ? {
                ...f,
                status: 'error' as UploadStatus,
                error: err instanceof Error ? err.message : 'File processing failed',
              }
              : f
          )
        );
        errorCount++;
        continue;
      }

      // Step 2: Upload the processed file
      setQueuedFiles((prev) =>
        prev.map((f) =>
          f.id === queuedFile.id ? { ...f, status: 'uploading' as UploadStatus } : f
        )
      );

      try {
        const formData = new FormData();
        formData.append('file', processedFile);
        formData.append('companyId', selectedCompanyId);
        formData.append('priority', 'NORMAL');
        formData.append('uploadSource', 'WEB');
        formData.append('skipExtraction', uploadWithoutAiExtraction ? 'true' : 'false');
        if (!uploadWithoutAiExtraction && useBatchProcessing) {
          formData.append('batchMode', 'true');
        }
        // Pass AI model and context if specified
        if (!uploadWithoutAiExtraction && selectedModelId) {
          formData.append('modelId', selectedModelId);
        }
        if (!uploadWithoutAiExtraction && fullContext) {
          formData.append('additionalContext', fullContext);
        }

        const response = await postFormDataWithFallback('/api/processing-documents', formData);

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message || 'Upload failed');
        }

        const result = await response.json();

        // Update status to success
        setQueuedFiles((prev) =>
          prev.map((f) =>
            f.id === queuedFile.id
              ? {
                ...f,
                status: 'success' as UploadStatus,
                processingDocumentId: result.data?.document?.id,
                file: processedFile, // Update to processed file
              }
              : f
          )
        );
        successCount++;
      } catch (err) {
        // Update status to error
        setQueuedFiles((prev) =>
          prev.map((f) =>
            f.id === queuedFile.id
              ? {
                ...f,
                status: 'error' as UploadStatus,
                error: err instanceof Error ? err.message : 'Upload failed',
              }
              : f
          )
        );
        errorCount++;
      }
    }

    setIsUploading(false);

    if (successCount > 0 && errorCount === 0) {
      success(`Successfully uploaded ${successCount} document${successCount > 1 ? 's' : ''}`);
    } else if (successCount > 0 && errorCount > 0) {
      toastError(`Uploaded ${successCount} document${successCount > 1 ? 's' : ''}, ${errorCount} failed`);
    } else {
      toastError('All uploads failed');
    }
  }, [
    selectedCompanyId,
    queuedFiles,
    selectedModelId,
    companyContext,
    selectedStandardContexts,
    aiContext,
    standardContextOptions,
    uploadWithoutAiExtraction,
    useBatchProcessing,
    toastError,
    success,
  ]);

  const completedCount = queuedFiles.filter((f) => f.status === 'success').length;
  const pendingCount = queuedFiles.filter((f) => ['pending', 'processing'].includes(f.status)).length;
  const errorCount = queuedFiles.filter((f) => f.status === 'error').length;
  const allComplete = queuedFiles.length > 0 && completedCount === queuedFiles.length;

  // Keyboard shortcuts (standardized): F1 primary action, F2 secondary action
  useKeyboardShortcuts([
    {
      key: 'Backspace',
      ctrl: true,
      handler: () => {
        if (!isMergeModalOpen && !isUploading) {
          router.push('/processing');
        }
      },
      description: 'Back to processing',
    },
    {
      key: 'F1',
      handler: () => {
        if (!isMergeModalOpen && !isUploading && queuedFiles.length > 0 && selectedCompanyId && !allComplete) {
          uploadFiles();
        }
      },
      description: 'Upload files',
    },
    {
      key: 'F2',
      handler: () => {
        if (!isMergeModalOpen && !isUploading) {
          openMergeModal();
        }
      },
      description: 'Merge files',
    },
      // Keep Ctrl+M as an alias for existing users
      {
        key: 'm',
        ctrl: true,
        handler: () => {
          if (!isMergeModalOpen && !isUploading) {
            openMergeModal();
          }
      },
      description: 'Merge files',
    },
  ]);

  // Get file icon based on type
  const getFileIcon = (file: File) => {
    if (file.type === 'application/pdf') {
      return <FileText className="w-4 h-4 text-status-error" />;
    }
    if (file.type.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4 text-oak-primary" />;
    }
    return <File className="w-4 h-4 text-text-muted" />;
  };

  // Get status icon
  const getStatusIcon = (qf: QueuedFile) => {
    switch (qf.status) {
      case 'pending':
        return getFileIcon(qf.file);
      case 'processing':
        return <Loader2 className="w-4 h-4 text-status-warning animate-spin" />;
      case 'uploading':
        return <Loader2 className="w-4 h-4 text-oak-primary animate-spin" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-status-success" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-status-error" />;
    }
  };

  // Get status badge
  const getStatusBadge = (qf: QueuedFile) => {
    switch (qf.status) {
      case 'processing':
        return <span className="badge badge-warning ml-2">Converting</span>;
      case 'uploading':
        return <span className="badge badge-info ml-2">Uploading</span>;
      case 'success':
        return <span className="badge badge-success ml-2">Uploaded</span>;
      default:
        return null;
    }
  };

  return (
    <div ref={containerRef} className="p-4 sm:p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/processing"
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-3 transition-colors"
          title="Back to Processing (Ctrl+Backspace)"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Processing (Ctrl+Backspace)
        </Link>
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
          Upload Documents for Processing
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Upload invoices, receipts, credit notes, purchase orders, and other business documents for AI-powered extraction.
        </p>
      </div>

      {/* Tenant/Company Selection Warning */}
      {isSuperAdmin && !activeTenantId && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Please select a tenant from the sidebar before uploading documents.
          </p>
        </div>
      )}

      {/* Company Selection */}
      <div className="card mb-6">
        <label className="block text-sm font-medium text-text-primary mb-2">
          <Building2 className="w-4 h-4 inline-block mr-2" />
          Select Company <span className="text-status-error">*</span>
        </label>
        {isLoadingCompanies ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading companies...
          </div>
        ) : (
          <>
            <AsyncSearchSelect
              value={selectedCompanyId}
              onChange={(companyId, company) => {
                setSelectedCompanyId(companyId);
                setSelectedCompany(company);
              }}
              placeholder="Select a company..."
              disabled={isUploading}
              options={companyOptions}
              isLoading={isLoadingCompanies}
              searchQuery={companySearchQuery}
              onSearchChange={setCompanySearchQuery}
              icon={<Building2 className="w-4 h-4" />}
              emptySearchText="Type to search companies"
              noResultsText="No companies found"
              className="w-full max-w-md"
            />
            {!selectedCompanyId && companyOptions.length > 0 && (
              <p className="text-xs text-status-warning mt-1.5">
                Please select a company to upload documents
              </p>
            )}
            {companyOptions.length === 0 && activeTenantId && !isLoadingCompanies && (
              <p className="text-sm text-text-tertiary mt-2">
                No companies found.{' '}
                <Link href="/companies/new" className="text-oak-light hover:underline">
                  Create a company
                </Link>{' '}
                first.
              </p>
            )}
          </>
        )}
      </div>

      {/* Dropzone with paste hint */}
      <div
        {...getRootProps()}
        className={cn(
          'card p-6 sm:p-12 text-center border-2 border-dashed cursor-pointer transition-colors mb-4',
          isDragActive
            ? 'border-oak-primary bg-oak-primary/5'
            : isUploading
              ? 'border-border-secondary bg-background-tertiary cursor-not-allowed'
              : 'border-border-secondary hover:border-oak-primary/50'
        )}
      >
        <input {...getInputProps()} />
        <FileUp className="w-8 h-8 sm:w-12 sm:h-12 text-text-muted mx-auto mb-3 sm:mb-4" />
        <h3 className="text-base sm:text-lg font-medium text-text-primary mb-2">
          {isDragActive ? 'Drop the files here' : 'Drag & drop your documents'}
        </h3>
        <p className="text-sm sm:text-base text-text-secondary mb-2">
          or click to browse your files
        </p>
        <p className="text-xs sm:text-sm text-text-tertiary mb-3">
          PDF, PNG, JPG, TIFF • Max {MAX_FILE_SIZE / 1024 / 1024}MB per file • Up to {MAX_FILES} files
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <ClipboardPaste className="w-3.5 h-3.5" />
            <kbd className="px-1.5 py-0.5 bg-background-tertiary rounded">Ctrl+V</kbd> to paste
          </span>
          <span className="hidden sm:inline text-border-secondary">•</span>
          <span>Images auto-convert to PDF</span>
          <span className="hidden sm:inline text-border-secondary">•</span>
          <span>Large PDFs auto-compress</span>
        </div>
      </div>

      {/* Merge Files Button */}
      <div className="mb-6">
        <button
          onClick={openMergeModal}
          disabled={isUploading}
          className="btn-secondary btn-sm flex items-center gap-2"
          title="Merge multiple files into one PDF (F2)"
        >
          <Merge className="w-4 h-4" />
          Merge Multiple Files (F2)
        </button>
        <p className="text-xs text-text-muted mt-1.5">
          Combine multiple files/images into a single PDF document
        </p>
      </div>

      {/* File Queue */}
      {queuedFiles.length > 0 && (
        <div className="card mb-6">
          <div className="p-3 sm:p-4 border-b border-border-primary flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-medium text-text-primary text-sm sm:text-base">
                Queued Files ({queuedFiles.length})
              </h2>
              <p className="text-xs text-text-tertiary mt-0.5">
                {completedCount} completed, {pendingCount} pending
                {errorCount > 0 && `, ${errorCount} failed`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {errorCount > 0 && !isUploading && (
                <button
                  onClick={retryAllFailed}
                  className="btn-ghost btn-xs text-status-warning hover:text-status-warning flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Retry Failed
                </button>
              )}
              {!isUploading && !allComplete && (
                <button
                  onClick={clearAllFiles}
                  className="btn-ghost btn-xs text-text-muted hover:text-status-error"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>
          <div className="divide-y divide-border-primary max-h-60 sm:max-h-80 overflow-y-auto">
            {queuedFiles.map((qf) => (
              <div key={qf.id} className={cn(
                'p-3 flex items-center gap-3',
                qf.isDuplicate && !qf.uploadAnyway && 'bg-status-warning/5 border-l-2 border-status-warning'
              )}>
                <div className="flex-shrink-0">
                  {qf.isDuplicate && !qf.uploadAnyway ? (
                    <Copy className="w-4 h-4 text-status-warning" />
                  ) : (
                    getStatusIcon(qf)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-text-primary truncate">
                      {qf.file.name}
                      {qf.originalFile && qf.file.name !== qf.originalFile.name && (
                        <span className="text-text-muted ml-1">
                          (from {qf.originalFile.name})
                        </span>
                      )}
                    </p>
                    {getStatusBadge(qf)}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <span className="text-xs text-text-tertiary">
                      {qf.file.size >= 1024 * 1024
                        ? `${(qf.file.size / 1024 / 1024).toFixed(1)} MB`
                        : `${(qf.file.size / 1024).toFixed(1)} KB`}
                    </span>
                    {qf.isDuplicate && !qf.uploadAnyway && qf.duplicateInfo && (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                        <span className="text-2xs text-status-warning">
                          Duplicate of &quot;{qf.duplicateInfo.fileName}&quot;
                        </span>
                        <Link
                          href={`/processing/${qf.duplicateInfo.documentId}?compare=true`}
                          className="text-2xs text-text-secondary hover:text-text-primary underline"
                          target="_blank"
                        >
                          Compare documents
                        </Link>
                        <button
                          onClick={() => {
                            setQueuedFiles((prev) =>
                              prev.map((f) =>
                                f.id === qf.id ? { ...f, uploadAnyway: true } : f
                              )
                            );
                          }}
                          className="text-2xs text-text-secondary hover:text-text-primary underline"
                        >
                          Upload anyway
                        </button>
                      </>
                    )}
                    {qf.file.type.startsWith('image/') && qf.status === 'pending' && (
                      <span className="badge badge-neutral text-2xs">Will convert to PDF</span>
                    )}
                    {qf.error && (
                      <span className="text-2xs text-status-error">{qf.error}</span>
                    )}
                    {qf.processingDocumentId && (
                      <Link
                        href={`/processing/${qf.processingDocumentId}`}
                        className="text-2xs text-oak-light hover:underline font-medium"
                      >
                        View document
                      </Link>
                    )}
                  </div>
                  {qf.isDuplicate && qf.uploadAnyway && (
                    <div className="mt-2 flex items-center gap-1.5 text-2xs text-text-muted">
                      <CheckCircle className="w-3 h-3" />
                      <span>Will upload despite being a duplicate</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {qf.status === 'error' && !isUploading && (
                    <button
                      onClick={() => retryFile(qf.id)}
                      className="p-1 hover:bg-background-tertiary rounded text-status-warning hover:text-status-warning"
                      title="Retry upload"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  {(qf.status === 'pending' || qf.status === 'error') && !isUploading && (
                    <button
                      onClick={() => removeFile(qf.id)}
                      className="p-1 hover:bg-background-tertiary rounded text-text-muted hover:text-text-primary"
                      title="Remove file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Company Context - Auto-populated, always visible */}
      <div className="card mb-4">
        <div className="flex items-start gap-3">
          <Building2 className="w-4 h-4 text-text-tertiary mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <label className="label mb-1 text-sm">Company Context</label>
            <textarea
              value={companyContext}
              readOnly
              disabled
              rows={3}
              placeholder="Select a company to auto-populate context..."
              className="input w-full text-sm resize-none mt-2 px-3 py-2.5 bg-background-tertiary cursor-default"
            />
            <p className="text-xs text-text-muted mt-2.5 leading-relaxed">
              Auto-populated from the selected company. This information helps the AI understand the business context.
            </p>
          </div>
        </div>
      </div>

      {/* AI Model Selector - consistent with BizFile upload */}
      <div className="card mb-4">
        <Toggle
          checked={uploadWithoutAiExtraction}
          onChange={setUploadWithoutAiExtraction}
          disabled={isUploading}
          label="Upload without AI extraction"
          description="Skip automatic extraction now. You can manually enter fields from the document view."
        />
      </div>

      {!uploadWithoutAiExtraction && getBatchProcessingProvider(selectedModelId) && (
        <div className="card mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <label className="label mb-1 text-sm">Batch Processing</label>
              <p className="text-sm text-text-secondary leading-relaxed">
                {getBatchProcessingProvider(selectedModelId) === 'mistral'
                  ? 'Queue uploaded documents through Mistral Batch OCR. This is slower, but better suited for background processing.'
                  : 'Queue uploaded documents through the OpenAI Batch API. This runs asynchronously and is better suited for background processing.'}
              </p>
              <p className="text-xs text-text-muted mt-2.5 leading-relaxed">
                {getBatchProcessingProvider(selectedModelId) === 'mistral'
                  ? 'Mistral OCR turns batch processing on by default when selected.'
                  : 'OpenAI batch processing is available for OpenAI extraction models and can take up to 24 hours to complete.'}
              </p>
            </div>
            <Toggle
              checked={useBatchProcessing}
              onChange={setUseBatchProcessing}
              disabled={isUploading}
            />
          </div>
        </div>
      )}

      <AIModelSelector
        value={selectedModelId}
        onChange={setSelectedModelId}
        label="AI Model for Extraction"
        helpText="Choose the extraction model directly. Mistral OCR is OCR-first, while OpenAI models can also be queued through batch processing."
        disabled={isUploading || uploadWithoutAiExtraction}
        includeMistralOcrOption
        showEmptyOption={false}
        jsonModeOnly
        showContextInput
        contextValue={aiContext}
        onContextChange={setAiContext}
        contextLabel="Additional Context (Optional)"
        contextPlaceholder="E.g., 'Focus on line items and totals' or 'This is a foreign currency invoice'"
        contextHelpText="Provide your own hints to help the AI extract data more accurately."
        showStandardContexts
        standardContextOptions={standardContextOptions}
        selectedStandardContexts={selectedStandardContexts}
        onStandardContextsChange={setSelectedStandardContexts}
        tenantId={activeTenantId || undefined}
        className="mb-6"
      />

      {!uploadWithoutAiExtraction && (
        <div className="-mt-4 mb-6 flex justify-end">
          <button
            type="button"
            onClick={() => setIsPromptModalOpen(true)}
            className="btn-secondary btn-sm flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Prompt Management
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <Link href="/processing" className="btn-secondary btn-sm text-center">
          Cancel
        </Link>
        <div className="flex items-center gap-3">
          {allComplete ? (
            <Link href="/processing?pipelineStatus=QUEUED" className="btn-primary btn-sm flex items-center justify-center gap-2 w-full sm:w-auto">
              <CheckCircle className="w-4 h-4" />
              View Processing Queue
            </Link>
          ) : (
            <button
              onClick={uploadFiles}
              disabled={isUploading || queuedFiles.length === 0 || !selectedCompanyId}
              className="btn-primary btn-sm flex items-center justify-center gap-2 w-full sm:w-auto"
              title="Upload files (F1)"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <FileUp className="w-4 h-4" />
                  Upload {queuedFiles.length > 0 ? `${queuedFiles.length} File${queuedFiles.length > 1 ? 's' : ''} (F1)` : 'Files (F1)'}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Merge Modal */}
      <FileMergeModal
        isOpen={isMergeModalOpen}
        onClose={() => setIsMergeModalOpen(false)}
        onMergeComplete={handleMergeComplete}
      />
      <DocumentExtractionPromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        settings={promptSettings}
        onSettingsChange={setPromptSettings}
      />
    </div>
  );
}

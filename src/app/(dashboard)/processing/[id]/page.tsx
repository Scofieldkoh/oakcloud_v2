'use client';

import { use, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  RefreshCw,
  Play,
  History,
  Copy,
  Scissors,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Save,
  Trash2,
  Pencil,
  XCircle,
  Sparkles,
  Download,
  FileSpreadsheet,
  Building2,
  Settings,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useProcessingDocumentView,
  useRevisionHistory,
  useTriggerExtraction,
  useApproveRevision,
  useRecordDuplicateDecision,
  useRevisionWithLineItems,
  useUpdateRevision,
  useDocumentNavigation,
  useDuplicateComparison,
  useUpdatePageRotation,
  useBulkOperation,
  useCreateRevision,
  useDocumentExport,
  usePrefetchNextDocument,
  useReconcileProcessingDocument,
} from '@/hooks/use-processing-documents';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import {
  DocumentPageViewer,
  ResizableSplitView,
  VerticalSplitView,
  DuplicateComparisonModal,
  DocumentLinks,
  DocumentTags,
  DocumentSplitterModal,
} from '@/components/processing';
import type { FieldValue } from '@/components/processing/document-page-viewer';
import type { DocumentCategory } from '@/generated/prisma';
import { cn } from '@/lib/utils';
import { convertToHomeCurrency } from '@/lib/currency-conversion';
import { useRateLookup } from '@/hooks/use-exchange-rates';
import { useAccountsForSelect } from '@/hooks/use-chart-of-accounts';
import { useCompany } from '@/hooks/use-companies';
import { useIsMobile } from '@/hooks/use-media-query';
import { AIModelSelector, buildFullContext } from '@/components/ui/ai-model-selector';
import {
  DocumentExtractionPromptModal,
} from '@/components/processing/document-extraction-prompt-modal';
import {
  useDocumentExtractionPromptSettings,
} from '@/hooks/use-document-extraction-prompt-settings';
import { copyTextToClipboard, getCopyableText } from '@/lib/clipboard';
import { NoExtractionPlaceholder } from './_components/no-extraction-placeholder';
import { ExtractedHeaderFields } from './_components/extracted-header-fields';
import { AmountsSection } from './_components/amounts-section';
import { ValidationStatusSection } from './_components/validation-status-section';
import { LineItemsSection } from './_components/line-items-section';
import { HistoryDropdown } from './_components/history-dropdown';
import {
  pipelineStatusConfig,
  getBatchProcessingProvider,
  duplicateStatusConfig,
  revisionStatusConfig,
  categoryLabels,
  currencyOptions,
  getGstRate,
  type BoundingBox,
  HIGHLIGHT_COLOR_DEFAULT,
  HIGHLIGHT_COLOR_FOCUS,
  type ValidationIssue,
  type FieldEvidence,
} from './_components/helpers';

interface PageProps {
  params: Promise<{ id: string }>;
}


export default function ProcessingDocumentDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const { can } = usePermissions();
  const { data: session } = useSession();

  // Get active tenant ID (from store for SUPER_ADMIN, from session for others)
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  // Check if we should auto-open compare modal from query param
  const shouldAutoCompare = searchParams.get('compare') === 'true';

  // UI State for controlling data fetching
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const isMobile = useIsMobile();
  const [mobileActivePanel, setMobileActivePanel] = useState<'document' | 'details' | 'lineItems'>('document');

  // Data fetching - consolidated API for initial load
  // This replaces multiple hooks: useProcessingDocument, useDocumentPages, useRevisionWithLineItems
  // Tags are loaded separately by DocumentTags component for better performance
  const { data: viewData, isLoading, error, refetch } = useProcessingDocumentView(id);

  // Extract data from consolidated response
  const currentRevisionFromView = viewData?.currentRevision;
  const pagesData = viewData?.pages;

  // Compatibility layer for existing code that expects data.document and data.currentRevision
  const data = useMemo(() => viewData ? {
    document: viewData.document,
    currentRevision: viewData.currentRevision ? {
      id: viewData.currentRevision.id,
      revisionNumber: viewData.currentRevision.revisionNumber,
      status: viewData.currentRevision.status,
      documentCategory: viewData.currentRevision.documentCategory,
      vendorName: viewData.currentRevision.vendorName,
      documentNumber: viewData.currentRevision.documentNumber,
      documentDate: viewData.currentRevision.documentDate,
      totalAmount: viewData.currentRevision.totalAmount,
      currency: viewData.currentRevision.currency,
      homeEquivalent: viewData.currentRevision.homeEquivalent,
      validationStatus: viewData.currentRevision.validationStatus,
      lineItemCount: viewData.currentRevision.lineItems.length,
    } : null,
  } : undefined, [viewData]);

  const { mutateAsync: reconcilePendingExtraction } = useReconcileProcessingDocument();
  const handleCopyFieldValue = useCallback(async (label: string, value: string | null) => {
    const copyValue = getCopyableText(value);
    if (!copyValue) return;

    const copied = await copyTextToClipboard(copyValue);
    if (copied) {
      success(`${label} copied`);
      return;
    }

    toastError('Clipboard access failed');
  }, [success, toastError]);

  const refreshDocument = useCallback(async () => {
    const isExtracting = data?.document?.pipelineStatus === 'QUEUED' ||
      data?.document?.pipelineStatus === 'PROCESSING';

    if (isExtracting) {
      try {
        await reconcilePendingExtraction(id);
      } catch (err) {
        console.warn('Failed to reconcile pending extraction before refresh:', err);
      }
    }

    await refetch();
  }, [data?.document?.pipelineStatus, id, reconcilePendingExtraction, refetch]);

  // Only fetch revision history when needed (when dropdown is shown or might be shown)
  // Always fetch if document has DRAFT status (user might need to see history)
  const shouldFetchHistory = showHistoryDropdown || data?.currentRevision?.status === 'DRAFT';
  const { data: revisions, isLoading: revisionsLoading } = useRevisionHistory(id, shouldFetchHistory);

  // Only fetch navigation when document is in a reviewable state
  const isReviewable = data?.document?.pipelineStatus === 'EXTRACTION_DONE' && data?.currentRevision?.status === 'DRAFT';
  const { data: navData } = useDocumentNavigation(
    id,
    'needs-review',
    {
      tenantId: activeTenantId,
      companyId: data?.document?.company?.id || undefined,
    },
    isReviewable
  );

  // Auto-refresh every 10 seconds if document is being processed
  useEffect(() => {
    const isExtracting = data?.document?.pipelineStatus === 'QUEUED' ||
      data?.document?.pipelineStatus === 'PROCESSING';

    if (isExtracting) {
      const interval = setInterval(() => {
        void refreshDocument();
      }, 10000); // 10 seconds

      return () => clearInterval(interval);
    }
  }, [data?.document?.pipelineStatus, refreshDocument]);

  // Prefetch next document for faster navigation during approval workflow
  const prefetchNextDocument = usePrefetchNextDocument();
  useEffect(() => {
    // Only prefetch when current document is fully loaded and we have navigation data
    if (!isLoading && navData?.nextId) {
      prefetchNextDocument(navData.nextId);
    }
  }, [isLoading, navData?.nextId, prefetchNextDocument]);

  // Current revision data
  const currentRevisionId = data?.currentRevision?.id || null;

  // Snapshot viewing state - when viewing a historical revision
  const [viewingSnapshotId, setViewingSnapshotId] = useState<string | null>(null);
  const [viewingSnapshotNumber, setViewingSnapshotNumber] = useState<number | null>(null);

  // Determine which revision to display - snapshot or current
  const displayRevisionId = viewingSnapshotId || currentRevisionId;
  const isViewingSnapshot = viewingSnapshotId !== null;

  // Only fetch revision separately when viewing a snapshot (historical revision)
  // For current revision, use data from consolidated view
  const { data: snapshotRevision, isLoading: snapshotLoading, refetch: refetchSnapshot } = useRevisionWithLineItems(
    id,
    isViewingSnapshot ? viewingSnapshotId : null, // Only fetch when viewing snapshot
    false
  );

  // Use snapshot data when viewing snapshot, otherwise use consolidated view data
  const revisionWithLineItems = isViewingSnapshot ? snapshotRevision : currentRevisionFromView;
  const lineItemsLoading = isViewingSnapshot ? snapshotLoading : isLoading;
  const refetchLineItems = isViewingSnapshot ? refetchSnapshot : refetch;

  // Duplicate comparison (only fetch when needed)
  const { data: duplicateData } = useDuplicateComparison(
    id,
    data?.document?.duplicateStatus === 'SUSPECTED'
  );

  // Exchange rate lookup for home currency conversion
  // Only lookup if document currency differs from home currency and no rate is stored
  const docCurrency = revisionWithLineItems?.currency || 'SGD';
  const homeCurrency = revisionWithLineItems?.homeCurrency || 'SGD';
  const needsRateLookup = docCurrency !== homeCurrency && docCurrency !== 'SGD' && !revisionWithLineItems?.homeExchangeRate;
  const rateDate = revisionWithLineItems?.documentDate || new Date().toISOString().split('T')[0];

  const { data: rateLookupData } = useRateLookup(
    needsRateLookup ? docCurrency : '',
    needsRateLookup ? rateDate : '',
    data?.document?.tenantId
  );

  // Chart of accounts for line item assignment
  // Only fetch when user can edit and document has line items or is in editable state
  const hasInactiveExtraction = !data?.currentRevision && data?.document?.pipelineStatus === 'UPLOADED';
  const canEdit = can.updateDocument && (data?.currentRevision?.status === 'DRAFT' || hasInactiveExtraction);
  const shouldFetchAccounts = canEdit;
  const { data: accountsData } = useAccountsForSelect(
    {
      tenantId: data?.document?.tenantId,
      companyId: data?.document?.company?.id || undefined,
    },
    shouldFetchAccounts
  );

  // Transform accounts to the format expected by LineItemsSection
  const chartOfAccounts = useMemo(() => {
    if (!accountsData) return [];
    return accountsData.map((account) => ({
      code: account.code,
      name: account.name,
    }));
  }, [accountsData]);

  // Mutations
  const triggerExtraction = useTriggerExtraction();
  const approveRevision = useApproveRevision();
  const recordDuplicateDecision = useRecordDuplicateDecision();
  const updateRevision = useUpdateRevision();
  const updatePageRotation = useUpdatePageRotation();
  const bulkOperation = useBulkOperation();
  const createRevision = useCreateRevision();

  // Export hook
  const documentExport = useDocumentExport();
  const [isDownloading, setIsDownloading] = useState(false);
  const [_isRevalidating, setIsRevalidating] = useState(false);

  // UI State (showHistoryDropdown already declared above for data fetching optimization)
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showForceReExtractDialog, setShowForceReExtractDialog] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSplitterModal, setShowSplitterModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [useBatchProcessing, setUseBatchProcessing] = useState(false);
  const [isReExtraction, setIsReExtraction] = useState(false);
  const [skipAliasLearning, setSkipAliasLearning] = useState(false);
  const [isResolvingAlias, setIsResolvingAlias] = useState(false);

  // AI context state (matching upload page)
  const [aiContext, setAiContext] = useState('');
  const [selectedStandardContexts, setSelectedStandardContexts] = useState<string[]>([]);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const previousBatchProviderRef = useRef<'mistral' | 'openai' | null>(null);
  const {
    settings: promptSettings,
    setSettings: setPromptSettings,
    standardContextOptions,
  } = useDocumentExtractionPromptSettings(showModelSelector);

  useEffect(() => {
    const batchProvider = getBatchProcessingProvider(selectedModel);

    if (batchProvider === 'mistral') {
      setUseBatchProcessing(true);
    } else if (batchProvider === 'openai' && previousBatchProviderRef.current !== 'openai') {
      setUseBatchProcessing(false);
    } else if (!batchProvider) {
      setUseBatchProcessing(false);
    }

    previousBatchProviderRef.current = batchProvider;
  }, [selectedModel]);

  // Fetch company details for context
  const companyId = data?.document?.company?.id;
  const { data: companyData } = useCompany(companyId || '');

  // Build company context (matching upload page format)
  const companyContext = useMemo(() => {
    const company = companyData;
    if (!company) return '';

    const contextParts: string[] = [];
    contextParts.push(`Uploading Company: ${company.name}`);
    if (company.primarySsicDescription) {
      contextParts.push(`Business Nature: ${company.primarySsicDescription}`);
    }
    if (company.homeCurrency) {
      contextParts.push(`Home Currency: ${company.homeCurrency}`);
    }
    contextParts.push('');
    contextParts.push('IMPORTANT BUSINESS CONTEXT:');
    contextParts.push(`- "${company.name}" is uploading this document for processing`);
    contextParts.push(`- For ACCOUNTS_PAYABLE (vendor invoices/bills): "${company.name}" is the BUYER/RECIPIENT - the vendor/supplier name must be a DIFFERENT company`);
    contextParts.push(`- For ACCOUNTS_RECEIVABLE (sales invoices): "${company.name}" is the SELLER/ISSUER - extract the customer name as the other party`);

    return contextParts.join('\n');
  }, [companyData]);

  // Fetch available AI models (no longer using the custom hook - AIModelSelector handles this)

  // Handler to view a historical revision snapshot
  const handleViewSnapshot = useCallback((revisionId: string, revisionNumber: number) => {
    setViewingSnapshotId(revisionId);
    setViewingSnapshotNumber(revisionNumber);
    setShowHistoryDropdown(false);
  }, []);

  // Handler to return to current revision
  const handleExitSnapshot = useCallback(() => {
    setViewingSnapshotId(null);
    setViewingSnapshotNumber(null);
  }, []);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  // Track if we're editing an approved document (need to create revision on save)
  const [isEditingApproved, setIsEditingApproved] = useState(false);
  const [editFormData, setEditFormData] = useState<{
    documentCategory: string;
    documentSubCategory: string;
    vendorName: string;
    identificationType: string;
    identificationNumber: string;
    counterpartyAddress: string;
    counterpartyEmail: string;
    counterpartyPhone: string;
    documentNumber: string;
    documentDate: string;
    dueDate: string;
    currency: string;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    supplierGstNo: string;
    // Phase 2: Home currency fields
    homeCurrency: string;
    homeExchangeRate: string;
    homeSubtotal: string;
    homeTaxAmount: string;
    homeTotal: string;
    isHomeExchangeRateOverride: boolean;
  }>({
    documentCategory: '',
    documentSubCategory: '',
    vendorName: '',
    identificationType: '',
    identificationNumber: '',
    counterpartyAddress: '',
    counterpartyEmail: '',
    counterpartyPhone: '',
    documentNumber: '',
    documentDate: '',
    dueDate: '',
    currency: 'SGD',
    subtotal: '',
    taxAmount: '',
    totalAmount: '',
    supplierGstNo: '',
    // Phase 2: Home currency defaults
    homeCurrency: 'SGD',
    homeExchangeRate: '1',
    homeSubtotal: '',
    homeTaxAmount: '',
    homeTotal: '',
    isHomeExchangeRateOverride: false,
  });
  const [editLineItems, setEditLineItems] = useState<Array<{
    id?: string;
    lineNo: number;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    gstAmount: string;
    taxCode: string;
    accountCode: string;
    // Phase 2: Home currency line item fields
    homeAmount: string;
    homeGstAmount: string;
    isHomeAmountOverride: boolean;
    isHomeGstOverride: boolean;
  }>>([]);
  const [deletedLineItemIds, setDeletedLineItemIds] = useState<string[]>([]);
  const [didInitializeManualEntry, setDidInitializeManualEntry] = useState(false);

  // Auto-open compare modal if query param is set
  useEffect(() => {
    if (shouldAutoCompare && duplicateData && !showDuplicateModal) {
      setShowDuplicateModal(true);
      // Remove the query param to prevent re-opening on navigation
      router.replace(`/processing/${id}`, { scroll: false });
    }
  }, [shouldAutoCompare, duplicateData, id, router, showDuplicateModal]);

  // Reset manual-entry initialization when navigating to a different document.
  useEffect(() => {
    setDidInitializeManualEntry(false);
  }, [id]);

  // For documents uploaded without active extraction, open in editable mode with empty fields.
  useEffect(() => {
    if (
      !data?.document ||
      data.currentRevision ||
      data.document.pipelineStatus !== 'UPLOADED' ||
      !can.updateDocument ||
      didInitializeManualEntry
    ) {
      return;
    }

    const companyHomeCurrency = data.document.company?.homeCurrency || 'SGD';
    setEditFormData((prev) => ({
      ...prev,
      documentCategory: prev.documentCategory || 'OTHER',
      currency: prev.currency || 'SGD',
      homeCurrency: companyHomeCurrency,
      homeExchangeRate: prev.homeExchangeRate || '1',
    }));
    setDeletedLineItemIds([]);
    setIsEditing(true);
    setIsEditingApproved(false);
    setDidInitializeManualEntry(true);
  }, [data, can.updateDocument, didInitializeManualEntry]);

  // Helper function to initialize form data from revision with home currency calculation
  const initializeFormDataFromRevision = useCallback((revision: typeof revisionWithLineItems, fetchedRate?: string) => {
    if (!revision) return;

    const docCurrency = revision.currency || 'SGD';
    const homeCurrency = revision.homeCurrency || 'SGD';
    const isSameCurrency = docCurrency === homeCurrency;

    // Get exchange rate - use stored rate, fetched rate, or default to 1
    // Priority: stored rate > fetched rate > default 1
    const storedRate = revision.homeExchangeRate;
    const rateToUse = isSameCurrency
      ? '1'
      : storedRate || fetchedRate || '1';
    const exchangeRate = parseFloat(rateToUse) || 1;

    // Calculate home currency amounts if not already provided
    let homeSubtotal = revision.homeSubtotal || '';
    let homeTaxAmount = revision.homeTaxAmount || '';

    // If home amounts are empty but we have document amounts, calculate them
    if (!homeSubtotal && revision.subtotal) {
      const subtotal = parseFloat(revision.subtotal);
      if (!isNaN(subtotal)) {
        homeSubtotal = isSameCurrency
          ? revision.subtotal
          : convertToHomeCurrency(subtotal, exchangeRate).toFixed(2);
      }
    }

    if (!homeTaxAmount && revision.taxAmount) {
      const taxAmount = parseFloat(revision.taxAmount);
      if (!isNaN(taxAmount)) {
        homeTaxAmount = isSameCurrency
          ? revision.taxAmount
          : convertToHomeCurrency(taxAmount, exchangeRate).toFixed(2);
      }
    }

    // Always calculate homeTotal as sum of homeSubtotal + homeTaxAmount for consistency
    // This ensures the displayed total always matches its components
    let homeTotal = '';
    const homeSubtotalNum = parseFloat(homeSubtotal) || 0;
    const homeTaxNum = parseFloat(homeTaxAmount) || 0;
    if (homeSubtotal || homeTaxAmount) {
      homeTotal = (homeSubtotalNum + homeTaxNum).toFixed(2);
    } else if (revision.totalAmount) {
      // Fallback: calculate from document total if no components available
      const totalAmount = parseFloat(revision.totalAmount);
      if (!isNaN(totalAmount)) {
        homeTotal = isSameCurrency
          ? revision.totalAmount
          : convertToHomeCurrency(totalAmount, exchangeRate).toFixed(2);
      }
    }

    setEditFormData({
      documentCategory: revision.documentCategory || '',
      documentSubCategory: revision.documentSubCategory || '',
      vendorName: revision.vendorName || '',
      identificationType: revision.counterpartyIdentity?.identificationType || '',
      identificationNumber: revision.counterpartyIdentity?.identificationNumber || '',
      counterpartyAddress: revision.counterpartyIdentity?.fullAddress || '',
      counterpartyEmail: revision.counterpartyIdentity?.email || '',
      counterpartyPhone: revision.counterpartyIdentity?.phone || '',
      documentNumber: revision.documentNumber || '',
      documentDate: revision.documentDate || '',
      dueDate: revision.dueDate || '',
      currency: docCurrency,
      subtotal: revision.subtotal || '',
      taxAmount: revision.taxAmount || '',
      totalAmount: revision.totalAmount || '',
      supplierGstNo: '',
      // Phase 2: Home currency fields
      homeCurrency: homeCurrency,
      homeExchangeRate: rateToUse,
      homeSubtotal: homeSubtotal,
      homeTaxAmount: homeTaxAmount,
      homeTotal: homeTotal,
      isHomeExchangeRateOverride: revision.isHomeExchangeRateOverride || false,
    });

    // Calculate line item home amounts if not provided
    setEditLineItems(
      revision.lineItems?.map((item) => {
        let homeAmount = item.homeAmount || '';
        let homeGstAmount = item.homeGstAmount || '';

        // Calculate if not provided
        if (!homeAmount && item.amount) {
          const amount = parseFloat(item.amount);
          if (!isNaN(amount)) {
            homeAmount = isSameCurrency
              ? item.amount
              : convertToHomeCurrency(amount, exchangeRate).toFixed(2);
          }
        }

        if (!homeGstAmount && item.gstAmount) {
          const gstAmount = parseFloat(item.gstAmount);
          if (!isNaN(gstAmount)) {
            homeGstAmount = isSameCurrency
              ? item.gstAmount
              : convertToHomeCurrency(gstAmount, exchangeRate).toFixed(2);
          }
        }

        return {
          id: item.id,
          lineNo: item.lineNo,
          description: item.description,
          quantity: item.quantity || '',
          unitPrice: item.unitPrice || '',
          amount: item.amount,
          gstAmount: item.gstAmount || '',
          taxCode: item.taxCode || '',
          accountCode: item.accountCode || '',
          // Phase 2: Home currency line item fields
          homeAmount: homeAmount,
          homeGstAmount: homeGstAmount,
          isHomeAmountOverride: item.isHomeAmountOverride || false,
          isHomeGstOverride: item.isHomeGstOverride || false,
        };
      }) || []
    );
  }, []);

  // Initialize edit form when revision data changes or rate lookup completes
  useEffect(() => {
    if (revisionWithLineItems && !isEditing) {
      // Pass the fetched rate if available
      const fetchedRate = rateLookupData?.rate;
      initializeFormDataFromRevision(revisionWithLineItems, fetchedRate);
    }
  }, [revisionWithLineItems, isEditing, initializeFormDataFromRevision, rateLookupData]);

  // Convert evidence JSON to highlights for DocumentPageViewer
  const highlights = useMemo((): BoundingBox[] => {
    if (!revisionWithLineItems?.headerEvidenceJson) return [];

    const evidence = revisionWithLineItems.headerEvidenceJson as Record<string, FieldEvidence>;
    const boxes: BoundingBox[] = [];

    // Field keys that have evidence
    const fieldKeys = [
      'vendorName', 'counterpartyIdentificationNumber', 'counterpartyAddress',
      'counterpartyEmail', 'counterpartyPhone', 'documentNumber', 'documentDate',
      'totalAmount', 'subtotal', 'taxAmount', 'supplierGstNo',
    ];

    fieldKeys.forEach((key) => {
      const fieldEvidence = evidence[key];
      if (fieldEvidence?.bbox) {
        const { x0, y0, x1, y1 } = fieldEvidence.bbox;
        const isFocused = focusedField === key;

        boxes.push({
          pageNumber: fieldEvidence.containerPageNumber || 1,
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
          label: isFocused ? key : undefined,
          color: isFocused ? HIGHLIGHT_COLOR_FOCUS : HIGHLIGHT_COLOR_DEFAULT,
          fieldKey: key,
        });
      }
    });

    return boxes;
  }, [revisionWithLineItems?.headerEvidenceJson, focusedField]);

  // Get confidence for a field from evidence
  const getFieldConfidence = useCallback((fieldKey: string): number | undefined => {
    if (!revisionWithLineItems?.headerEvidenceJson) return undefined;
    const evidence = revisionWithLineItems.headerEvidenceJson as Record<string, FieldEvidence>;
    return evidence[fieldKey]?.confidence;
  }, [revisionWithLineItems?.headerEvidenceJson]);

  // Create fieldValues for text layer search (more accurate bounding boxes)
  const fieldValues = useMemo((): FieldValue[] => {
    if (!revisionWithLineItems) return [];

    const values: FieldValue[] = [];
    const isFocusedColor = HIGHLIGHT_COLOR_FOCUS;
    const defaultColor = HIGHLIGHT_COLOR_DEFAULT;

    // Add field values that we want to highlight
    if (revisionWithLineItems.vendorName) {
      values.push({
        label: 'vendorName',
        value: revisionWithLineItems.vendorName,
        color: focusedField === 'vendorName' ? isFocusedColor : defaultColor,
      });
    }
    const identityValues = [
      ['counterpartyIdentificationNumber', revisionWithLineItems.counterpartyIdentity?.identificationNumber],
      ['counterpartyAddress', revisionWithLineItems.counterpartyIdentity?.fullAddress],
      ['counterpartyEmail', revisionWithLineItems.counterpartyIdentity?.email],
      ['counterpartyPhone', revisionWithLineItems.counterpartyIdentity?.phone],
    ] as const;
    for (const [label, value] of identityValues) {
      if (value) values.push({ label, value, color: focusedField === label ? isFocusedColor : defaultColor });
    }
    if (revisionWithLineItems.documentNumber) {
      values.push({
        label: 'documentNumber',
        value: revisionWithLineItems.documentNumber,
        color: focusedField === 'documentNumber' ? isFocusedColor : defaultColor,
      });
    }
    if (revisionWithLineItems.totalAmount) {
      values.push({
        label: 'totalAmount',
        value: revisionWithLineItems.totalAmount,
        color: focusedField === 'totalAmount' ? isFocusedColor : defaultColor,
      });
    }
    if (revisionWithLineItems.subtotal) {
      values.push({
        label: 'subtotal',
        value: revisionWithLineItems.subtotal,
        color: focusedField === 'subtotal' ? isFocusedColor : defaultColor,
      });
    }
    if (revisionWithLineItems.taxAmount) {
      values.push({
        label: 'taxAmount',
        value: revisionWithLineItems.taxAmount,
        color: focusedField === 'taxAmount' ? isFocusedColor : defaultColor,
      });
    }
    if (revisionWithLineItems.currency) {
      values.push({
        label: 'currency',
        value: revisionWithLineItems.currency,
        color: focusedField === 'currency' ? isFocusedColor : defaultColor,
      });
    }

    return values;
  }, [revisionWithLineItems, focusedField]);

  // Navigation handlers
  const handleNavigatePrev = useCallback(() => {
    if (!navData?.prevId) return;
    router.push(`/processing/${navData.prevId}`);
  }, [navData, router]);

  const handleNavigateNext = useCallback(() => {
    if (!navData?.nextId) return;
    router.push(`/processing/${navData.nextId}`);
  }, [navData, router]);

  // Keyboard navigation (basic - before handlers are defined)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft' && e.altKey) {
        handleNavigatePrev();
      } else if (e.key === 'ArrowRight' && e.altKey) {
        handleNavigateNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNavigatePrev, handleNavigateNext]);

  // Action handlers
  const handleTriggerExtraction = async (model?: string, context?: string, batchMode?: boolean) => {
    try {
      const result = await triggerExtraction.mutateAsync({ documentId: id, model, context, batchMode });
      success(
        batchMode
          ? `Batch extraction queued${result.jobId ? ` (${result.jobId})` : ''}`
          : 'Extraction triggered successfully'
      );
      refetch();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to trigger extraction');
    }
  };

  // Handler to show model selector modal for extraction/re-extraction
  const handleShowModelSelector = useCallback((reExtract: boolean = false) => {
    setSelectedModel(''); // Reset selection
    setUseBatchProcessing(false);
    setAiContext(''); // Reset context
    setSelectedStandardContexts([]); // Reset standard contexts
    setIsReExtraction(reExtract);
    setShowModelSelector(true);
  }, []);

  // Handler to confirm extraction with selected model and context
  const handleConfirmExtraction = async () => {
    setShowModelSelector(false);

    // Build full context including company context, standard contexts, and custom context
    const fullContext = [
      companyContext,
      buildFullContext(selectedStandardContexts, aiContext, standardContextOptions),
    ].filter(Boolean).join('\n\n');

    await handleTriggerExtraction(
      selectedModel || undefined,
      fullContext || undefined,
      useBatchProcessing
    );

    // Reset state
    setSelectedModel('');
    setUseBatchProcessing(false);
    setAiContext('');
    setSelectedStandardContexts([]);
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/processing-documents/${id}/download`);
      if (!response.ok) {
        throw new Error('Failed to download document');
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      let fileName = doc?.fileName || 'document';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          fileName = decodeURIComponent(match[1]);
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      success('Document downloaded');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to download');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await documentExport.mutateAsync({ documentId: id, includeLinked: false });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      link.download = `export-${dateStr}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      success('Document exported');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to export');
    }
  };

  // Handle split document
  const handleSplitDocument = async (ranges: { pageFrom: number; pageTo: number; label: string }[]) => {
    try {
      const response = await fetch(`/api/processing-documents/${id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranges }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to split document');
      }
      const result = await response.json();
      success(`Document split into ${result.data.splitCount} parts`);
      refetch();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to split document');
      throw err;
    }
  };

  const handleApproveRevision = useCallback(async () => {
    if (!data?.document || !data?.currentRevision) return;
    try {
      const isReceivable = data.currentRevision.documentCategory === 'ACCOUNTS_RECEIVABLE';
      const body = {
        aliasLearning: isReceivable
          ? { customer: (skipAliasLearning ? 'SKIP' : 'AUTO') as 'SKIP' | 'AUTO' }
          : { vendor: (skipAliasLearning ? 'SKIP' : 'AUTO') as 'SKIP' | 'AUTO' },
      };
      await approveRevision.mutateAsync({
        documentId: id,
        revisionId: data.currentRevision.id,
        lockVersion: data.document.lockVersion,
        body,
      });
      success('Revision approved');
      setShowApproveDialog(false);
      refetch();
      // Auto-advance to next document after approval
      if (navData?.nextId) {
        router.push(`/processing/${navData.nextId}`);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to approve revision');
    }
  }, [data, skipAliasLearning, id, approveRevision, success, refetch, navData?.nextId, router, toastError]);

  const handleResolveCounterpartyAlias = async () => {
    if (!data?.document || !data?.currentRevision) return;
    const rawName = editFormData.vendorName?.trim();
    if (!rawName) {
      toastError('Please enter a vendor/customer name first');
      return;
    }

    try {
      setIsResolvingAlias(true);
      const res = await fetch(
        `/api/processing-documents/${id}/revisions/${data.currentRevision.id}/resolve-alias`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawName }),
        }
      );

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to resolve alias');
      }

      if (json?.data?.matched && json?.data?.canonicalName) {
        setEditFormData({ ...editFormData, vendorName: json.data.canonicalName });
        success('Applied saved contact name');
      } else {
        toastError('No saved match found for this name');
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to resolve alias');
    } finally {
      setIsResolvingAlias(false);
    }
  };

  const handleDeleteDocument = async () => {
    try {
      await bulkOperation.mutateAsync({
        operation: 'DELETE',
        documentIds: [id],
      });
      success('Document deleted');
      setShowDeleteDialog(false);
      // Navigate back to list
      router.push('/processing');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete document');
    }
  };

  const handleDuplicateDecision = async (decision: 'REJECT_DUPLICATE' | 'CONFIRM_DUPLICATE' | 'MARK_AS_NEW_VERSION') => {
    if (!duplicateData?.duplicateDocument?.id) {
      toastError('No duplicate document found');
      return;
    }
    try {
      await recordDuplicateDecision.mutateAsync({
        documentId: id,
        suspectedOfId: duplicateData.duplicateDocument.id,
        decision,
      });
      success('Duplicate decision recorded');
      setShowDuplicateModal(false);
      refetch();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to record decision');
    }
  };

  const handleRotationChange = useCallback(async (rotation: number, pageNumber: number) => {
    try {
      await updatePageRotation.mutateAsync({
        documentId: id,
        pageNumber,
        rotation,
      });
      // No need to show success toast for rotation - it's a quick action
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to save rotation');
    }
  }, [id, updatePageRotation, toastError]);

  // Start editing a draft revision directly
  const handleStartEdit = useCallback(() => {
    if (revisionWithLineItems) {
      initializeFormDataFromRevision(revisionWithLineItems, rateLookupData?.rate);
    }
    setDeletedLineItemIds([]); // Reset deleted items when starting edit
    setIsEditing(true);
  }, [revisionWithLineItems, rateLookupData?.rate, initializeFormDataFromRevision]);

  // Start editing an approved document - only enter edit mode, don't create revision yet
  const handleEditApproved = useCallback(() => {
    if (!data?.document || !currentRevisionId || !revisionWithLineItems) return;
    // Initialize form data from current revision (with home currency calculation)
    initializeFormDataFromRevision(revisionWithLineItems, rateLookupData?.rate);
    setDeletedLineItemIds([]);
    // Mark that we're editing an approved document (revision will be created on save)
    setIsEditingApproved(true);
    setIsEditing(true);
  }, [data?.document, currentRevisionId, revisionWithLineItems, rateLookupData?.rate, initializeFormDataFromRevision]);

  const handleSaveEdit = useCallback(async () => {
    if (!data?.document) return;
    try {
      let targetRevisionId = currentRevisionId;
      let lockVersion = data.document.lockVersion;

      // If this document has no revision yet (uploaded without extraction), create an initial draft first.
      if (!targetRevisionId) {
        const result = await createRevision.mutateAsync({
          documentId: id,
          lockVersion,
          input: {
            reason: 'Manual entry without AI extraction',
          },
        });
        targetRevisionId = result.revision.id;
        lockVersion = result.document.lockVersion;
        success(`Created draft revision #${result.revision.revisionNumber}`);
      }

      // If editing an approved document, create a new revision first
      if (isEditingApproved && currentRevisionId) {
        const result = await createRevision.mutateAsync({
          documentId: id,
          lockVersion,
          input: {
            basedOnRevisionId: currentRevisionId,
            reason: 'Edit approved document',
          },
        });
        targetRevisionId = result.revision.id;
        lockVersion = result.document.lockVersion;
        success(`Created new draft revision #${result.revision.revisionNumber}`);
      }

      if (!targetRevisionId) {
        throw new Error('Unable to determine revision to save');
      }

      // Now update the revision with the changes
      // For new revisions from approved docs, we need to exclude item IDs since they're new copies
      await updateRevision.mutateAsync({
        documentId: id,
        revisionId: targetRevisionId,
        lockVersion,
        data: {
          headerUpdates: {
            documentCategory: editFormData.documentCategory || undefined,
            documentSubCategory: editFormData.documentSubCategory || undefined,
            vendorName: editFormData.vendorName || undefined,
            counterpartyIdentity: {
              identificationType: (editFormData.identificationType || undefined) as 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER' | undefined,
              identificationNumber: editFormData.identificationNumber || undefined,
              fullAddress: editFormData.counterpartyAddress || undefined,
              email: editFormData.counterpartyEmail || undefined,
              phone: editFormData.counterpartyPhone || undefined,
              confidence: {
                identificationNumber: editFormData.identificationNumber ? 1 : undefined,
                fullAddress: editFormData.counterpartyAddress ? 1 : undefined,
                email: editFormData.counterpartyEmail ? 1 : undefined,
                phone: editFormData.counterpartyPhone ? 1 : undefined,
              },
            },
            documentNumber: editFormData.documentNumber || undefined,
            documentDate: editFormData.documentDate || undefined,
            dueDate: editFormData.dueDate || undefined,
            currency: editFormData.currency || undefined,
            subtotal: editFormData.subtotal || undefined,
            taxAmount: editFormData.taxAmount || undefined,
            totalAmount: editFormData.totalAmount || undefined,
            // Phase 2: Home currency header fields
            homeCurrency: editFormData.homeCurrency || undefined,
            homeExchangeRate: editFormData.homeExchangeRate || undefined,
            homeSubtotal: editFormData.homeSubtotal || undefined,
            homeTaxAmount: editFormData.homeTaxAmount || undefined,
            homeEquivalent: editFormData.homeTotal || undefined,
            isHomeExchangeRateOverride: editFormData.isHomeExchangeRateOverride,
          },
          itemsToUpsert: editLineItems.map((item) => ({
            // For new revisions from approved docs, don't pass old IDs
            id: isEditingApproved ? undefined : item.id,
            lineNo: item.lineNo,
            description: item.description,
            quantity: item.quantity || undefined,
            unitPrice: item.unitPrice || undefined,
            amount: item.amount,
            gstAmount: item.gstAmount || undefined,
            taxCode: item.taxCode || undefined,
            accountCode: item.accountCode || undefined,
            // Phase 2: Home currency line item fields
            homeAmount: item.homeAmount || undefined,
            homeGstAmount: item.homeGstAmount || undefined,
            isHomeAmountOverride: item.isHomeAmountOverride,
            isHomeGstOverride: item.isHomeGstOverride,
          })),
          // For new revisions, don't pass deleted items since they're fresh copies
          itemsToDelete: isEditingApproved ? undefined : (deletedLineItemIds.length > 0 ? deletedLineItemIds : undefined),
        },
      });
      success('Changes saved successfully');
      setIsEditing(false);
      setIsEditingApproved(false);
      setDeletedLineItemIds([]); // Reset deleted items tracking
      refetch();
      refetchLineItems();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to save changes');
    }
  }, [
    data?.document,
    currentRevisionId,
    isEditingApproved,
    id,
    editFormData,
    editLineItems,
    deletedLineItemIds,
    createRevision,
    updateRevision,
    success,
    toastError,
    refetch,
    refetchLineItems,
  ]);

  const _handleRevalidate = useCallback(async () => {
    if (!displayRevisionId) return;
    try {
      setIsRevalidating(true);
      const response = await fetch(`/api/processing-documents/${id}/revisions/${displayRevisionId}?revalidate=true`);
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error?.message || 'Failed to revalidate');
      }
      const result = await response.json();
      const updated = result.data;

      queryClient.setQueryData(['revision-line-items', id, displayRevisionId, false], updated);
      queryClient.setQueryData(['revision-line-items', id, displayRevisionId, true], updated);

      success('Revalidation complete');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to revalidate');
    } finally {
      setIsRevalidating(false);
    }
  }, [displayRevisionId, id, queryClient, success, toastError]);

  const handleAddLineItem = () => {
    const maxLineNo = editLineItems.reduce((max, item) => Math.max(max, item.lineNo), 0);
    setEditLineItems([
      ...editLineItems,
      {
        lineNo: maxLineNo + 1,
        description: '',
        quantity: '',
        unitPrice: '',
        amount: '0',
        gstAmount: '',
        taxCode: 'SR', // Default to 9% GST
        accountCode: '',
        // Phase 2: Home currency defaults for new line items
        homeAmount: '',
        homeGstAmount: '',
        isHomeAmountOverride: false,
        isHomeGstOverride: false,
      },
    ]);
  };

  const handleRemoveLineItem = (index: number) => {
    const itemToRemove = editLineItems[index];
    // Track the deleted item ID if it exists (i.e., it was saved before)
    if (itemToRemove.id) {
      setDeletedLineItemIds((prev) => [...prev, itemToRemove.id!]);
    }
    const updated = editLineItems.filter((_, i) => i !== index);
    setEditLineItems(updated);
  };

  const handleLineItemChange = (index: number, field: string, value: string) => {
    const updated = [...editLineItems];
    updated[index] = { ...updated[index], [field]: value };

    const exchangeRate = parseFloat(editFormData.homeExchangeRate) || 1;
    const isSameCurrency = editFormData.currency === editFormData.homeCurrency;

    // Auto-calculate amount when qty or unitPrice changes
    if (field === 'quantity' || field === 'unitPrice') {
      const qty = parseFloat(field === 'quantity' ? value : updated[index].quantity) || 0;
      const unitPrice = parseFloat(field === 'unitPrice' ? value : updated[index].unitPrice) || 0;
      // Allow negative unitPrice for credit notes (qty=1, unitPrice=-5.12 => amount=-5.12)
      if (qty !== 0 && unitPrice !== 0) {
        const calculatedAmount = qty * unitPrice;
        updated[index].amount = calculatedAmount.toFixed(2);
      }
    }

    // Auto-calculate GST amount when amount or taxCode changes
    if (field === 'amount' || field === 'taxCode' || field === 'quantity' || field === 'unitPrice') {
      const amount = parseFloat(updated[index].amount) || 0;
      const taxCode = field === 'taxCode' ? value : updated[index].taxCode;
      const rate = getGstRate(taxCode);
      const gstAmount = amount * rate;
      // Use !== 0 to handle negative amounts (credit notes) correctly
      updated[index].gstAmount = gstAmount !== 0 ? gstAmount.toFixed(2) : '';
    }

    // Auto-calculate home currency amounts when document currency amounts change
    // (unless user has manually overridden home amounts)
    if (!isSameCurrency) {
      if (field === 'amount' || field === 'quantity' || field === 'unitPrice') {
        // Only auto-calculate if not manually overridden
        if (!updated[index].isHomeAmountOverride) {
          const amount = parseFloat(updated[index].amount) || 0;
          updated[index].homeAmount = (amount * exchangeRate).toFixed(2);
        }
      }
      if (field === 'gstAmount' || field === 'amount' || field === 'taxCode' || field === 'quantity' || field === 'unitPrice') {
        // Only auto-calculate if not manually overridden
        if (!updated[index].isHomeGstOverride) {
          const gstAmount = parseFloat(updated[index].gstAmount) || 0;
          updated[index].homeGstAmount = (gstAmount * exchangeRate).toFixed(2);
        }
      }
      // When user manually edits home amounts, set override flag
      if (field === 'homeAmount') {
        updated[index].isHomeAmountOverride = true;
      }
      if (field === 'homeGstAmount') {
        updated[index].isHomeGstOverride = true;
      }
    }

    setEditLineItems(updated);
  };

  // Recalculate all line items when exchange rate changes
  // Note: editLineItems is intentionally excluded from deps to prevent infinite loops
  // The hasChanges check prevents unnecessary re-renders
  useEffect(() => {
    if (!isEditing || editLineItems.length === 0) return;

    const exchangeRate = parseFloat(editFormData.homeExchangeRate) || 1;
    const isSameCurrency = editFormData.currency === editFormData.homeCurrency;

    if (isSameCurrency) return;

    // Recalculate home amounts for all line items that aren't manually overridden
    const updated = editLineItems.map((item) => {
      const newItem = { ...item };
      if (!item.isHomeAmountOverride) {
        const amount = parseFloat(item.amount) || 0;
        newItem.homeAmount = (amount * exchangeRate).toFixed(2);
      }
      if (!item.isHomeGstOverride) {
        const gstAmount = parseFloat(item.gstAmount) || 0;
        newItem.homeGstAmount = (gstAmount * exchangeRate).toFixed(2);
      }
      return newItem;
    });

    // Only update if there are actual changes to prevent infinite loops
    const hasChanges = updated.some((item, idx) =>
      item.homeAmount !== editLineItems[idx].homeAmount ||
      item.homeGstAmount !== editLineItems[idx].homeGstAmount
    );

    if (hasChanges) {
      setEditLineItems(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFormData.homeExchangeRate, editFormData.currency, editFormData.homeCurrency, isEditing]);

  // Recalculate header totals when line items change
  // This ensures subtotal, taxAmount, homeSubtotal, and homeTaxAmount stay in sync with line items
  useEffect(() => {
    if (!isEditing || editLineItems.length === 0) return;

    // Sum up line item amounts and GST amounts (document currency)
    const subtotalSum = editLineItems.reduce((sum, item) => {
      const amount = parseFloat(item.amount) || 0;
      return sum + amount;
    }, 0);

    const taxSum = editLineItems.reduce((sum, item) => {
      const gstAmount = parseFloat(item.gstAmount) || 0;
      return sum + gstAmount;
    }, 0);

    // Sum up line item home amounts and home GST amounts
    const homeSubtotalSum = editLineItems.reduce((sum, item) => {
      const homeAmount = parseFloat(item.homeAmount) || 0;
      return sum + homeAmount;
    }, 0);

    const homeTaxSum = editLineItems.reduce((sum, item) => {
      const homeGstAmount = parseFloat(item.homeGstAmount) || 0;
      return sum + homeGstAmount;
    }, 0);

    const newSubtotal = subtotalSum.toFixed(2);
    const newTaxAmount = taxSum.toFixed(2);
    const newTotalAmount = (subtotalSum + taxSum).toFixed(2);
    const newHomeSubtotal = homeSubtotalSum.toFixed(2);
    const newHomeTaxAmount = homeTaxSum.toFixed(2);
    const newHomeTotal = (homeSubtotalSum + homeTaxSum).toFixed(2);

    // Use functional update to compare with current state and avoid stale closures
    setEditFormData((prev) => {
      // Only update if values have changed to prevent infinite loops
      if (newSubtotal !== prev.subtotal ||
        newTaxAmount !== prev.taxAmount ||
        newTotalAmount !== prev.totalAmount ||
        newHomeSubtotal !== prev.homeSubtotal ||
        newHomeTaxAmount !== prev.homeTaxAmount ||
        newHomeTotal !== prev.homeTotal) {
        return {
          ...prev,
          subtotal: newSubtotal,
          taxAmount: newTaxAmount,
          totalAmount: newTotalAmount,
          homeSubtotal: newHomeSubtotal,
          homeTaxAmount: newHomeTaxAmount,
          homeTotal: newHomeTotal,
        };
      }
      return prev; // Return same reference if no changes
    });
  }, [editLineItems, isEditing]);

  // Hotkeys effect (after all handler definitions)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip hotkeys when typing in inputs (except for modal hotkeys)
      const isInInput = e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement;

      // Handle approval modal hotkeys first (F1 to confirm, Escape to cancel)
      if (showApproveDialog) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowApproveDialog(false);
          return;
        }
        if (e.key === 'F1' && !approveRevision.isPending) {
          e.preventDefault();
          handleApproveRevision();
          return;
        }
        return; // Block other hotkeys when modal is open
      }

      // Ctrl+Backspace - Cancel editing
      if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && isEditing && !isInInput) {
        e.preventDefault();
        setIsEditing(false);
        setIsEditingApproved(false);
        setDeletedLineItemIds([]);
        return;
      }

      // Ctrl+Backspace - Go back to processing page (when not editing, not in modal, not in input)
      if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && !isEditing && !isInInput) {
        e.preventDefault();
        router.push('/processing');
        return;
      }

      // Skip other hotkeys when in input fields
      if (isInInput) return;

      // Skip action hotkeys if data not loaded
      if (!data) return;

      const currentRev = data.currentRevision;
      const doc = data.document;
      const canApproveNow = currentRev?.status === 'DRAFT' &&
        (doc.duplicateStatus === 'NONE' || doc.duplicateStatus === 'REJECTED');

      // Ctrl+R - Refresh document view
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        refreshDocument();
        return;
      }

      // F1 - Primary action: Approve (when viewing, not editing)
      if (e.key === 'F1') {
        e.preventDefault();
        if (!isEditing && !isViewingSnapshot && canApproveNow && can.updateDocument) {
          setSkipAliasLearning(false);
          setShowApproveDialog(true);
        }
      }

      // F2 - Secondary action: Edit
      if (e.key === 'F2') {
        e.preventDefault();
        if (!isViewingSnapshot && !isEditing && can.updateDocument) {
          if (currentRev?.status === 'DRAFT') {
            handleStartEdit();
          } else if (currentRev?.status === 'APPROVED') {
            handleEditApproved();
          } else if (!currentRev && doc.pipelineStatus === 'UPLOADED') {
            handleStartEdit();
          }
        }
      }

      // F3 - Save (when editing)
      if (e.key === 'F3') {
        e.preventDefault();
        if (isEditing && !updateRevision.isPending && !createRevision.isPending) {
          handleSaveEdit();
        }
      }

      // F4 - Re-extract (when editing)
      if (e.key === 'F4') {
        e.preventDefault();
        if (isEditing && !triggerExtraction.isPending) {
          handleShowModelSelector(true);
        }
      }
    };
    // Use capture phase to intercept F3/F4 before browser handles them
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    isEditing,
    isViewingSnapshot,
    data,
    can.updateDocument,
    updateRevision.isPending,
    createRevision.isPending,
    triggerExtraction.isPending,
    handleStartEdit,
    handleEditApproved,
    handleSaveEdit,
    handleShowModelSelector,
    showApproveDialog,
    approveRevision.isPending,
    handleApproveRevision,
    refreshDocument,
    router,
  ]);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-6 h-6 animate-spin text-oak-light" />
        <span className="ml-3 text-text-secondary">Loading document...</span>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="p-6">
        <div className="card p-6 border-status-error bg-status-error/5">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{error instanceof Error ? error.message : 'Failed to load document'}</p>
          </div>
          <Link href="/processing" className="btn-secondary btn-sm mt-4 inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to List
          </Link>
        </div>
      </div>
    );
  }

  const { document: doc, currentRevision } = data;
  const pipelineConfig = pipelineStatusConfig[doc.pipelineStatus];
  const duplicateConfig = duplicateStatusConfig[doc.duplicateStatus];

  const canTriggerExtraction =
    doc.pipelineStatus === 'UPLOADED' ||
    doc.pipelineStatus === 'QUEUED' ||
    doc.pipelineStatus === 'FAILED_RETRYABLE';
  const canForceReExtract = doc.pipelineStatus === 'PROCESSING';

  const canApprove =
    currentRevision?.status === 'DRAFT' &&
    (doc.duplicateStatus === 'NONE' || doc.duplicateStatus === 'REJECTED');

  const needsDuplicateDecision = doc.duplicateStatus === 'SUSPECTED' && currentRevision?.status === 'DRAFT';
  const headerRevisionData = (revisionWithLineItems || currentRevision || {
    documentCategory: (editFormData.documentCategory as DocumentCategory) || null,
    documentSubCategory: editFormData.documentSubCategory || null,
    vendorName: editFormData.vendorName || null,
    counterpartyIdentity: {
      identificationType: (editFormData.identificationType || undefined) as 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER' | undefined,
      identificationNumber: editFormData.identificationNumber || undefined,
      fullAddress: editFormData.counterpartyAddress || undefined,
      email: editFormData.counterpartyEmail || undefined,
      phone: editFormData.counterpartyPhone || undefined,
      confidence: {},
    },
    documentNumber: editFormData.documentNumber || null,
    documentDate: editFormData.documentDate || null,
    dueDate: editFormData.dueDate || null,
    currency: editFormData.currency || 'SGD',
    subtotal: editFormData.subtotal || null,
    taxAmount: editFormData.taxAmount || null,
    totalAmount: editFormData.totalAmount || '0',
  }) as {
    documentCategory: DocumentCategory | null;
    documentSubCategory?: string | null;
    vendorName: string | null;
    counterpartyIdentity?: {
      identificationType?: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER';
      identificationNumber?: string;
      fullAddress?: string;
      email?: string;
      phone?: string;
      confidence: Partial<Record<'identificationNumber' | 'fullAddress' | 'email' | 'phone', number>>;
    } | null;
    documentNumber: string | null;
    documentDate: string | null;
    dueDate?: string | null;
    currency: string;
    subtotal?: string | null;
    taxAmount?: string | null;
    totalAmount: string;
  };

  const viewerPanel = (
    <DocumentPageViewer
      documentId={id}
      pdfUrl={pagesData?.pdfUrl || undefined}
      highlights={highlights}
      fieldValues={fieldValues}
      className="h-full"
      onRotationChange={handleRotationChange}
      documentStatus={currentRevision?.status}
      onPagesChanged={refetch}
    />
  );

  const detailsPanel = (
    <div className="h-full overflow-y-auto bg-background-primary p-4">
      {/* Header Information Section */}
      {!currentRevision && !isEditing ? (
        <NoExtractionPlaceholder
          canTrigger={canTriggerExtraction}
          isPending={triggerExtraction.isPending}
          pipelineStatus={doc.pipelineStatus}
          onTrigger={() => handleShowModelSelector(false)}
        />
      ) : (
        <div className="space-y-4">
          {/* Section Header - Company Name - Full width like PDF toolbar */}
          <div className="-mx-4 -mt-4 px-4 py-3 bg-background-tertiary border-b border-border-primary">
            <span className="text-sm font-medium text-text-primary">
              {doc.company?.name || 'Unassigned Company'}
            </span>
          </div>

          {/* Tags Section - Above document type, always editable */}
          <div className="pt-2">
            <DocumentTags
              documentId={id}
              companyId={doc.company?.id || null}
              tenantId={activeTenantId}
            />
          </div>

          {/* Header Fields */}
          <div className="max-w-2xl space-y-4">
            <ExtractedHeaderFields
              revision={headerRevisionData}
              isEditing={isEditing}
              editFormData={editFormData}
              setEditFormData={setEditFormData}
              onResolveAlias={currentRevision ? handleResolveCounterpartyAlias : undefined}
              isResolvingAlias={isResolvingAlias}
              disableResolveAlias={approveRevision.isPending || !currentRevision}
              focusedField={focusedField}
              setFocusedField={setFocusedField}
              getFieldConfidence={getFieldConfidence}
              categoryLabels={categoryLabels}
              onCopyFieldValue={handleCopyFieldValue}
            />

            {/* Amounts Section - Combined document and home currency */}
            <AmountsSection
              documentCurrency={revisionWithLineItems?.currency || currentRevision?.currency || editFormData.currency || 'SGD'}
              documentSubtotal={revisionWithLineItems?.subtotal || (isEditing ? editFormData.subtotal || null : null)}
              documentTaxAmount={revisionWithLineItems?.taxAmount || (isEditing ? editFormData.taxAmount || null : null)}
              documentTotalAmount={revisionWithLineItems?.totalAmount || currentRevision?.totalAmount || editFormData.totalAmount || '0'}
              isEditing={isEditing}
              editFormData={editFormData}
              setEditFormData={setEditFormData}
              currencyOptions={currencyOptions}
              focusedField={focusedField}
              setFocusedField={setFocusedField}
              getFieldConfidence={getFieldConfidence}
              tenantId={data?.document?.tenantId}
              validationIssues={(revisionWithLineItems?.validationIssues as { issues?: ValidationIssue[] })?.issues}
            />

            {/* Validation Status */}
            {revisionWithLineItems?.validationStatus && revisionWithLineItems.validationStatus !== 'PENDING' && (
              <div className="pt-2">
                <ValidationStatusSection
                  status={revisionWithLineItems.validationStatus}
                  issues={(revisionWithLineItems.validationIssues as { issues?: ValidationIssue[] })?.issues}
                />
              </div>
            )}

            {/* Document Links - Only show when not viewing a snapshot */}
            {!isViewingSnapshot && (
              <DocumentLinks
                documentId={id}
                canUpdate={can.updateDocument}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );

  const lineItemsPanel = (
    <div className="h-full overflow-auto bg-background-primary">
      {(currentRevision || isEditing) ? (
        <LineItemsSection
          lineItems={isEditing ? editLineItems : revisionWithLineItems?.lineItems}
          isEditing={isEditing}
          isLoading={currentRevision ? lineItemsLoading : false}
          currency={isEditing ? editFormData.currency : (revisionWithLineItems?.currency || currentRevision?.currency || 'SGD')}
          homeCurrency={isEditing ? editFormData.homeCurrency : (revisionWithLineItems?.homeCurrency || 'SGD')}
          exchangeRate={parseFloat(editFormData.homeExchangeRate) || 1}
          chartOfAccounts={chartOfAccounts}
          onAdd={handleAddLineItem}
          onRemove={handleRemoveLineItem}
          onChange={handleLineItemChange}
          fullWidth
          validationIssues={(revisionWithLineItems?.validationIssues as { issues?: ValidationIssue[] })?.issues}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-sm text-text-muted text-center">
          Line items will appear after extraction.
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      {/* Header */}
      <div className="px-3 md:px-4 py-3 border-b border-border-primary bg-background-primary flex-shrink-0">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-wrap md:flex-nowrap">
          <Link href="/processing" className="btn-ghost btn-sm p-2" title="Back to list (Ctrl+Backspace)">
            <ArrowLeft className="w-4 h-4" />
          </Link>

          {/* Document Navigation */}
          {navData && navData.total > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleNavigatePrev}
                disabled={!navData.prevId}
                className="btn-ghost btn-xs p-1.5"
                title="Previous document (Alt+Left)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-text-secondary whitespace-nowrap" title="Documents pending approval">
                {navData.currentIndex + 1} / {navData.total}{' '}
                <span className="hidden sm:inline">Pending approval</span>
                <span className="sm:hidden">Pending</span>
              </span>
              <button
                onClick={handleNavigateNext}
                disabled={!navData.nextId}
                className="btn-ghost btn-xs p-1.5"
                title="Next document (Alt+Right)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="h-4 w-px bg-border-primary mx-1" />

          <h1 className="text-sm font-medium text-text-primary truncate flex-1 min-w-0" title={doc.fileName}>
            {doc.fileName || 'Processing Document'}
          </h1>
          {doc.version > 1 && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-status-info/10 text-status-info">
              v{doc.version}
            </span>
          )}
          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', pipelineConfig.bgColor, pipelineConfig.color)}>
            {pipelineConfig.label}
          </span>
          </div>

          {/* Action buttons */}
          <div className="flex w-full md:w-auto items-center gap-2 overflow-x-auto flex-nowrap pb-1 md:pb-0 [&>*]:shrink-0 [&>*]:whitespace-nowrap">
          {/* Hide action buttons when viewing snapshot - only show Exit Snapshot in banner */}
          {!isViewingSnapshot && canTriggerExtraction && can.updateDocument && (
            <button
              onClick={() => handleShowModelSelector(false)}
              disabled={triggerExtraction.isPending}
              className="btn-secondary btn-sm"
            >
              {triggerExtraction.isPending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-1.5" />
              )}
              Extract
            </button>
          )}
          {!isViewingSnapshot && canForceReExtract && can.updateDocument && (
            <button
              onClick={() => setShowForceReExtractDialog(true)}
              disabled={triggerExtraction.isPending}
              className="btn-secondary btn-sm text-status-warning hover:bg-status-warning/10"
              title="Force re-run extraction if this document appears stuck in processing"
            >
              {triggerExtraction.isPending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
              )}
              Force Re-extract
            </button>
          )}
          {/* Split button - only show for multi-page documents */}
          {!isViewingSnapshot && (data?.document?.pageCount || 0) > 1 && can.updateDocument && (
            <button
              onClick={() => setShowSplitterModal(true)}
              className="btn-secondary btn-sm"
              title="Split document into multiple parts"
            >
              <Scissors className="w-3.5 h-3.5 mr-1.5" />
              Split
            </button>
          )}
          {!isViewingSnapshot && isEditing ? (
            <>
              <button onClick={() => { setIsEditing(false); setIsEditingApproved(false); setDeletedLineItemIds([]); }} className="btn-ghost btn-sm px-3" title="Cancel editing (Ctrl+Backspace)">
                {isMobile ? 'Cancel' : 'Cancel (Ctrl+Backspace)'}
              </button>
              <button
                onClick={() => handleShowModelSelector(true)}
                disabled={triggerExtraction.isPending}
                className="btn-secondary btn-sm px-3"
                title="Re-run AI extraction with model selection (F4)"
              >
                {triggerExtraction.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                )}
                {isMobile ? 'Re-extract' : 'Re-extract (F4)'}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={updateRevision.isPending || createRevision.isPending}
                className="btn-primary btn-sm px-3"
                title="Save changes (F3)"
              >
                {updateRevision.isPending || createRevision.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                )}
                {isMobile ? 'Save' : 'Save (F3)'}
              </button>
            </>
          ) : !isViewingSnapshot ? (
            <>
              {/* Edit button for DRAFT revisions - edits directly */}
              {currentRevision?.status === 'DRAFT' && can.updateDocument && (
                <button onClick={handleStartEdit} className="btn-secondary btn-sm px-3" title="Edit document (F2)">
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  {isMobile ? 'Edit' : 'Edit (F2)'}
                </button>
              )}
              {/* Edit button for APPROVED revisions - creates new draft revision */}
              {currentRevision?.status === 'APPROVED' && can.updateDocument && (
                <button
                  onClick={handleEditApproved}
                  disabled={createRevision.isPending}
                  className="btn-secondary btn-sm px-3"
                  title="Create a new draft revision from the approved document (F2)"
                >
                  {createRevision.isPending ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {isMobile ? 'Edit' : 'Edit (F2)'}
                </button>
              )}
              {!currentRevision && doc.pipelineStatus === 'UPLOADED' && can.updateDocument && (
                <button onClick={handleStartEdit} className="btn-secondary btn-sm px-3" title="Edit document (F2)">
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  {isMobile ? 'Edit' : 'Edit (F2)'}
                </button>
              )}
              {canApprove && can.updateDocument && (
                <button
                  onClick={() => {
                    setSkipAliasLearning(false);
                    setShowApproveDialog(true);
                  }}
                  className="btn-primary btn-sm px-3"
                  title="Approve document (F1)"
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                  {isMobile ? 'Approve' : 'Approve (F1)'}
                </button>
              )}
              {/* Download and Export buttons */}
              <button
                onClick={handleDownload}
                disabled={isDownloading}
                className="btn-ghost btn-sm"
                title="Download document"
              >
                {isDownloading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={handleExport}
                disabled={documentExport.isPending}
                className="btn-ghost btn-sm"
                title="Export to Excel"
              >
                {documentExport.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4" />
                )}
              </button>
            </>
          ) : null}
          {!isViewingSnapshot && can.deleteDocument && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="btn-ghost btn-sm text-status-error hover:bg-status-error/10"
              title="Delete document"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => refreshDocument()} className="btn-ghost btn-sm p-2" title="Refresh (Ctrl+R)">
            <RefreshCw className="w-4 h-4" />
          </button>
          </div>
        </div>
      </div>

      {/* Duplicate Warning Banner */}
      {needsDuplicateDecision && !isViewingSnapshot && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
            <span className="text-sm text-yellow-800 dark:text-yellow-200">
              This document is suspected to be a duplicate
            </span>
          </div>
          <button
            onClick={() => setShowDuplicateModal(true)}
            className="btn-secondary btn-sm border-yellow-500 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
          >
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Compare
          </button>
        </div>
      )}

      {/* Snapshot Viewing Banner */}
      {isViewingSnapshot && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Viewing Historical Snapshot: Revision #{viewingSnapshotNumber}
            </span>
            <span className="text-xs text-blue-600 dark:text-blue-400">
              (Read-only)
            </span>
          </div>
          <button
            onClick={handleExitSnapshot}
            className="btn-secondary btn-sm border-blue-500 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
          >
            <XCircle className="w-3.5 h-3.5 mr-1.5" />
            Exit Snapshot
          </button>
        </div>
      )}

      {/* Mobile panel switcher */}
      {isMobile && (
        <div className="px-3 py-2 border-b border-border-primary bg-background-primary flex-shrink-0">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setMobileActivePanel('document')}
              className={cn(
                'btn-ghost btn-sm justify-center',
                mobileActivePanel === 'document' && 'bg-oak-primary/10 text-oak-primary'
              )}
            >
              Document
            </button>
            <button
              onClick={() => setMobileActivePanel('details')}
              className={cn(
                'btn-ghost btn-sm justify-center',
                mobileActivePanel === 'details' && 'bg-oak-primary/10 text-oak-primary'
              )}
            >
              Details
            </button>
            <button
              onClick={() => setMobileActivePanel('lineItems')}
              className={cn(
                'btn-ghost btn-sm justify-center',
                mobileActivePanel === 'lineItems' && 'bg-oak-primary/10 text-oak-primary'
              )}
            >
              Line Items
            </button>
          </div>
          {!isViewingSnapshot && isEditing && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setIsEditingApproved(false);
                  setDeletedLineItemIds([]);
                }}
                className="btn-ghost btn-sm justify-center"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={updateRevision.isPending || createRevision.isPending}
                className="btn-primary btn-sm justify-center"
              >
                {updateRevision.isPending || createRevision.isPending ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Saving
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    Save
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Content - Vertical Split: Top (Preview + Header) | Bottom (Line Items) */}
      <div className="flex-1 overflow-hidden">
        {isMobile ? (
          <div className="h-full">
            <div className={cn('h-full', mobileActivePanel !== 'document' && 'hidden')}>
              {viewerPanel}
            </div>
            <div className={cn('h-full', mobileActivePanel !== 'details' && 'hidden')}>
              {detailsPanel}
            </div>
            <div className={cn('h-full', mobileActivePanel !== 'lineItems' && 'hidden')}>
              {lineItemsPanel}
            </div>
          </div>
        ) : (
          <VerticalSplitView
            defaultTopHeight={75}
            minTopHeight={40}
            maxTopHeight={85}
            topPanel={
              <ResizableSplitView
                leftPanel={viewerPanel}
                rightPanel={detailsPanel}
                defaultLeftWidth={70}
                minLeftWidth={50}
                maxLeftWidth={80}
              />
            }
            bottomPanel={lineItemsPanel}
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-t border-border-primary bg-background-tertiary text-xs flex-shrink-0">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="text-text-muted">Pipeline:</span>
            <span className={cn('font-medium', pipelineConfig.color)}>{pipelineConfig.label}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-text-muted">Duplicate:</span>
            <span className={cn('font-medium', duplicateConfig.color)}>{duplicateConfig.label}</span>
          </span>
          {currentRevision && (
            <span className="flex items-center gap-1.5">
              <span className="text-text-muted">Revision:</span>
              <span className={cn('font-medium', revisionStatusConfig[currentRevision.status].color)}>
                #{currentRevision.revisionNumber} {revisionStatusConfig[currentRevision.status].label}
              </span>
            </span>
          )}
        </div>

        {/* History Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
            className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
          >
            <History className="w-3.5 h-3.5" />
            <span>History</span>
            <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', showHistoryDropdown && 'rotate-90')} />
          </button>

          {showHistoryDropdown && (
            <HistoryDropdown
              revisions={revisions}
              isLoading={revisionsLoading}
              onClose={() => setShowHistoryDropdown(false)}
              categoryLabels={categoryLabels}
              currentRevisionId={currentRevisionId}
              viewingSnapshotId={viewingSnapshotId}
              onViewSnapshot={handleViewSnapshot}
              onExitSnapshot={handleExitSnapshot}
            />
          )}
        </div>
      </div>

      {/* Approve Dialog */}
      <ConfirmDialog
        isOpen={showApproveDialog}
        onClose={() => setShowApproveDialog(false)}
        onConfirm={handleApproveRevision}
        title="Approve Revision"
        description={(
          <>
            Are you sure you want to approve Revision #{currentRevision?.revisionNumber}?
            <br />
            This will mark it as the official record.
          </>
        )}
        confirmLabel="Approve (F1)"
        cancelLabel="Cancel (Esc)"
        variant="info"
        isLoading={approveRevision.isPending}
      >
        <Toggle
          size="sm"
          checked={skipAliasLearning}
          onChange={setSkipAliasLearning}
          disabled={approveRevision.isPending}
          label="Don't learn this contact name correction"
          className="pt-1"
        />
      </ConfirmDialog>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDeleteDocument}
        title="Delete Document"
        description={`Are you sure you want to delete "${doc.fileName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={bulkOperation.isPending}
      />

      {/* Force Re-extract Dialog */}
      <ConfirmDialog
        isOpen={showForceReExtractDialog}
        onClose={() => setShowForceReExtractDialog(false)}
        onConfirm={() => {
          setShowForceReExtractDialog(false);
          handleShowModelSelector(true);
        }}
        title="Force Re-extract Document"
        description="This document is still marked as Processing. Force re-extract will start a new extraction attempt and may replace extracted results."
        confirmLabel="Continue"
        cancelLabel="Cancel"
        variant="warning"
      />

      {/* AI Model Selector Modal - Matching Upload Page */}
      <Modal
        isOpen={showModelSelector}
        onClose={() => setShowModelSelector(false)}
        title={isReExtraction ? 'Re-extract Document' : 'Extract Document'}
        description={isReExtraction
          ? 'Re-run AI extraction on this document. This will replace the current extraction results.'
          : 'Run AI extraction to automatically extract data from this document.'
        }
        size="2xl"
      >
        <ModalBody>
          <div className="space-y-4">
            {(() => {
              const batchAvailable = getBatchProcessingProvider(selectedModel);
              if (!batchAvailable) {
                return null;
              }
              return (
                <div className="card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <label className="label mb-1 text-sm">Batch Processing</label>
                      <p className="text-sm text-text-secondary leading-relaxed">
                        {batchAvailable === 'mistral'
                          ? 'Queue this extraction through Mistral Batch OCR. This is slower, but better suited for background processing.'
                          : 'Queue this extraction through the OpenAI Batch API. This runs asynchronously and is better suited for background processing.'}
                      </p>
                      <p className="text-xs text-text-muted mt-2 leading-relaxed">
                        {batchAvailable === 'mistral'
                          ? 'Mistral OCR turns batch processing on by default when selected.'
                          : 'OpenAI batch processing is available for OpenAI extraction models and can take up to 24 hours to complete.'}
                      </p>
                    </div>
                    <Toggle
                      checked={useBatchProcessing}
                      onChange={(checked) => setUseBatchProcessing(checked)}
                      disabled={false}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Company Context - Auto-populated, read-only */}
            <div className="card">
              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-text-tertiary mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <label className="label mb-1 text-sm">Company Context</label>
                  <textarea
                    value={companyContext}
                    readOnly
                    disabled
                    rows={3}
                    placeholder="Loading company context..."
                    className="input w-full text-sm resize-none mt-2 px-3 py-2.5 bg-background-tertiary cursor-default"
                  />
                  <p className="text-xs text-text-muted mt-2.5 leading-relaxed">
                    Auto-populated from the selected company. This information helps the AI understand the business context.
                  </p>
                </div>
              </div>
            </div>

            {/* AI Model Selector - Matching Upload Page */}
            <AIModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              label="AI Model for Extraction"
              helpText="Choose the extraction model directly. Mistral OCR is OCR-first, while OpenAI models can also be queued through batch processing."
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
              className="mb-0"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsPromptModalOpen(true)}
                className="btn-secondary btn-sm flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Prompt Management
              </button>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowModelSelector(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirmExtraction}
            isLoading={triggerExtraction.isPending}
          >
            {isReExtraction ? (
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <Play className="w-3.5 h-3.5 mr-1.5" />
            )}
            {isReExtraction ? 'Re-extract' : 'Extract'}
          </Button>
        </ModalFooter>
      </Modal>

      <DocumentExtractionPromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        settings={promptSettings}
        onSettingsChange={setPromptSettings}
      />

      {/* Duplicate Comparison Modal */}
      {/* Document Splitter Modal */}
      {showSplitterModal && data?.document && (
        <DocumentSplitterModal
          isOpen={showSplitterModal}
          onClose={() => setShowSplitterModal(false)}
          onConfirm={handleSplitDocument}
          documentId={id}
          fileName={data?.document?.fileName || 'Document'}
          totalPages={data?.document?.pageCount || 1}
        />
      )}

      {showDuplicateModal && duplicateData && (
        <DuplicateComparisonModal
          isOpen={showDuplicateModal}
          onClose={() => setShowDuplicateModal(false)}
          currentDocument={{
            id: duplicateData.currentDocument.id,
            fileName: duplicateData.currentDocument.fileName,
            pipelineStatus: duplicateData.currentDocument.pipelineStatus,
            approvalStatus: duplicateData.currentDocument.approvalStatus,
            createdAt: duplicateData.currentDocument.createdAt,
            pdfUrl: duplicateData.currentDocument.pdfUrl,
            pages: duplicateData.currentDocument.pages,
          }}
          duplicateDocument={{
            id: duplicateData.duplicateDocument.id,
            fileName: duplicateData.duplicateDocument.fileName,
            pipelineStatus: duplicateData.duplicateDocument.pipelineStatus,
            approvalStatus: duplicateData.duplicateDocument.approvalStatus,
            createdAt: duplicateData.duplicateDocument.createdAt,
            pdfUrl: duplicateData.duplicateDocument.pdfUrl,
            pages: duplicateData.duplicateDocument.pages,
          }}
          duplicateScore={duplicateData.comparison.duplicateScore || undefined}
          duplicateReason={duplicateData.comparison.duplicateReason || undefined}
          fieldComparison={duplicateData.comparison.fieldComparison}
          onDecision={handleDuplicateDecision}
          isSubmitting={recordDuplicateDecision.isPending}
        />
      )}
    </div>
  );
}

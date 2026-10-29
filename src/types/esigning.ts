import type {
  EsigningEnvelopeEventAction,
  EsigningEnvelopeStatus,
  EsigningFieldType,
  EsigningPdfGenerationStatus,
  EsigningPostCompletionStatus,
  EsigningRecipientAccessMode,
  EsigningRecipientStatus,
  EsigningRecipientType,
  EsigningSigningOrder,
} from '@/generated/prisma';

export type EsigningCopyDeliveryStatusDto =
  | 'AWAITING_COMPLETION'
  | 'PENDING'
  | 'RETRYING'
  | 'SENT'
  | 'FAILED'
  | 'NOT_TRACKED';

export type EsigningCompletionDeliveryStatusDto =
  | 'PENDING'
  | 'RETRYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'NOT_TRACKED';

export interface EsigningPostCompletionDto {
  artifactStatus: EsigningPdfGenerationStatus | null;
  autoFilingStatus: EsigningPostCompletionStatus;
  completionDeliveryStatus: EsigningCompletionDeliveryStatusDto;
  failedCompletionDeliveryCount: number;
}

export interface EsigningEnvelopeListItem {
  id: string;
  tenantId: string;
  title: string;
  status: EsigningEnvelopeStatus;
  pdfGenerationStatus: EsigningPdfGenerationStatus | null;
  signingOrder: EsigningSigningOrder;
  certificateId: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  companyId: string | null;
  companyName: string | null;
  createdById: string;
  createdByName: string;
  canDelete: boolean;
  canVoid: boolean;
  canDuplicate: boolean;
  canResend: boolean;
  canRetryCompletionProcessing: boolean;
  emailDelivery: EsigningEmailDeliveryHealthDto;
  postCompletion: EsigningPostCompletionDto;
  resendableRecipientCount: number;
  recipientCount: number;
  signerCount: number;
  completedSignerCount: number;
  documentCount: number;
  documents: Array<{
    id: string;
    fileName: string;
    originalFileName: string | null;
  }>;
  recipients: Array<{
    id: string;
    name: string;
    email: string | null;
    type: EsigningRecipientType;
    status: EsigningRecipientStatus;
    signingOrder: number | null;
    copyDeliveryStatus: EsigningCopyDeliveryStatusDto;
  }>;
}

export interface EsigningCompanyFilterOptionDto {
  id: string;
  name: string;
  count: number;
}

export interface EsigningEmailDeliveryFailureDto {
  kind: string;
  targetKey: string;
  to: string;
  subject: string;
  error: string;
  attemptedAt: string;
}

export interface EsigningEmailDeliveryHealthDto {
  status: 'ok' | 'failed';
  lastFailureAt: string | null;
  failures: EsigningEmailDeliveryFailureDto[];
}

export type EsigningEnvelopeStatusCounts = Record<EsigningEnvelopeStatus, number>;

export interface EsigningEnvelopeDocumentDto {
  id: string;
  generatedDocumentId?: string | null;
  fileName: string;
  originalFileName?: string;
  pageCount: number;
  sortOrder: number;
  visibility?: 'SIGNER_ONLY' | 'EVERYONE';
  fileSize: number;
  originalHash: string;
  signedHash: string | null;
  pdfUrl: string;
  signedPdfUrl: string | null;
}

export interface EsigningEnvelopeRecipientDto {
  id: string;
  name: string;
  email: string | null;
  type: EsigningRecipientType;
  status: EsigningRecipientStatus;
  signingOrder: number | null;
  accessMode: EsigningRecipientAccessMode;
  hasAccessCode: boolean;
  colorTag: string;
  consentedAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  fieldsAssigned: number;
  requiredFieldsAssigned: number;
  signatureFieldsAssigned: number;
  copyDeliveryStatus: EsigningCopyDeliveryStatusDto;
}

export interface EsigningFieldDefinitionDto {
  id: string;
  documentId: string;
  recipientId: string;
  type: EsigningFieldType;
  pageNumber: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  required: boolean;
  label: string | null;
  placeholder: string | null;
  sortOrder: number;
}

export interface EsigningFieldOverlapWarning {
  fieldIds: string[];
  documentId: string;
  pageNumber: number;
  message: string;
}

export interface EsigningFieldValueDto {
  id: string;
  fieldDefinitionId: string;
  recipientId: string;
  value: string | null;
  signatureStoragePath: string | null;
  signaturePreviewUrl?: string | null;
  filledAt: string | null;
  finalizedAt: string | null;
  revision: number;
}

/**
 * A finalized signature or initials field from a signer who completed an
 * earlier signing step in the same envelope.
 *
 * Public signing sessions intentionally expose only the placement metadata
 * and an inline PNG preview needed to render the completed mark. Raw
 * recipient and field-value records stay private to the signing service.
 */
export interface EsigningSignedSignatureDto {
  fieldDefinitionId: string;
  signaturePreviewUrl: string;
  signerName: string;
  documentId: string;
  pageNumber: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export interface EsigningEnvelopeEventDto {
  id: string;
  recipientId: string | null;
  recipientName: string | null;
  action: EsigningEnvelopeEventAction;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface EsigningEnvelopeDetailDto {
  id: string;
  tenantId: string;
  title: string;
  /** Nullable for responses produced before the email-subject migration. */
  emailSubject?: string | null;
  message: string | null;
  completionCopyEmails: string[];
  status: EsigningEnvelopeStatus;
  signingOrder: EsigningSigningOrder;
  expiresAt: string | null;
  reminderFrequencyDays: number | null;
  reminderStartDays: number | null;
  expiryWarningDays: number | null;
  companyId: string | null;
  companyName: string | null;
  certificateId: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  pdfGenerationStatus: EsigningPdfGenerationStatus | null;
  pdfGenerationError: string | null;
  createdById: string;
  createdByName: string;
  canEdit: boolean;
  canDelete: boolean;
  canSend: boolean;
  canVoid: boolean;
  canDuplicate: boolean;
  canRetryCompletionProcessing: boolean;
  emailDelivery: EsigningEmailDeliveryHealthDto;
  postCompletion: EsigningPostCompletionDto;
  documentCount: number;
  signerCount: number;
  recipientCount: number;
  completedSignerCount: number;
  documents: EsigningEnvelopeDocumentDto[];
  recipients: EsigningEnvelopeRecipientDto[];
  fields: EsigningFieldDefinitionDto[];
  fieldValues: EsigningFieldValueDto[];
  fieldWarnings?: EsigningFieldOverlapWarning[];
  events: EsigningEnvelopeEventDto[];
}

export interface EsigningManualLinkDto {
  recipientId: string;
  recipientName: string;
  recipientEmail: string | null;
  signingUrl: string;
}

export interface EsigningSigningSessionDto {
  savedSignatureSpecimenDataUrl?: string | null;
  envelope: {
    id: string;
    title: string;
    message: string | null;
    status: EsigningEnvelopeStatus;
    pdfGenerationStatus: EsigningPdfGenerationStatus | null;
    certificateId: string;
    companyName: string | null;
    tenantName: string;
    senderName: string;
    completedAt: string | null;
    expiresAt: string | null;
    autoFilingStatus: EsigningPostCompletionStatus;
    completionDeliveryStatus: EsigningCompletionDeliveryStatusDto;
  };
  recipient: {
    id: string;
    name: string;
    email: string | null;
    type: EsigningRecipientType;
    status: EsigningRecipientStatus;
    accessMode: EsigningRecipientAccessMode;
    consentedAt: string | null;
    viewedAt: string | null;
    signedAt: string | null;
    colorTag: string;
  };
  documents: EsigningEnvelopeDocumentDto[];
  recipients: Array<{
    id: string;
    name: string;
    type: EsigningRecipientType;
    status: EsigningRecipientStatus;
    signingOrder: number | null;
    colorTag: string;
  }>;
  fields: EsigningFieldDefinitionDto[];
  fieldValues: EsigningFieldValueDto[];
  signedSignatures?: EsigningSignedSignatureDto[];
  downloadToken: string | null;
  currentRecipientDeliveryStatus: EsigningCopyDeliveryStatusDto;
}

export interface EsigningSigningSessionStatusDto {
  envelope: {
    id: string;
    status: EsigningEnvelopeStatus;
    expiresAt: string | null;
    pdfGenerationStatus: EsigningPdfGenerationStatus | null;
    autoFilingStatus: EsigningPostCompletionStatus;
    completionDeliveryStatus: EsigningCompletionDeliveryStatusDto;
  };
  recipient: {
    id: string;
    status: EsigningRecipientStatus;
    signedAt: string | null;
  };
  currentRecipientDeliveryStatus: EsigningCopyDeliveryStatusDto;
  remainingSignerCount: number;
  terminal: boolean;
}

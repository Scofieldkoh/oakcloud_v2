import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EsigningStepReview } from '@/components/esigning/prepare/esigning-step-review';
import type { EsigningEnvelopeDetailDto } from '@/types/esigning';

vi.mock('@/components/esigning/prepare/esigning-field-canvas', () => ({
  EsigningFieldCanvas: () => <div data-testid="review-document-viewer" />,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function makeEnvelope(): EsigningEnvelopeDetailDto {
  return {
    id: 'envelope-1',
    tenantId: 'workspace-1',
    title: 'NDA',
    emailSubject: 'Please sign the NDA',
    message: 'Please review this document.',
    completionCopyEmails: [],
    status: 'DRAFT',
    signingOrder: 'PARALLEL',
    expiresAt: null,
    reminderFrequencyDays: null,
    reminderStartDays: null,
    expiryWarningDays: null,
    companyId: null,
    companyName: null,
    certificateId: 'certificate-1',
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    voidedAt: null,
    voidReason: null,
    pdfGenerationStatus: null,
    pdfGenerationError: null,
    createdById: 'user-1',
    createdByName: 'Sender',
    canEdit: true,
    canDelete: true,
    canSend: true,
    canVoid: true,
    canDuplicate: true,
    canRetryCompletionProcessing: false,
    emailDelivery: { status: 'ok', lastFailureAt: null, failures: [] },
    postCompletion: {
      artifactStatus: null,
      autoFilingStatus: 'NOT_REQUIRED',
      completionDeliveryStatus: 'NOT_TRACKED',
      failedCompletionDeliveryCount: 0,
    },
    documentCount: 1,
    signerCount: 1,
    recipientCount: 1,
    completedSignerCount: 0,
    documents: [{
      id: 'document-1',
      fileName: 'nda.pdf',
      pageCount: 1,
      sortOrder: 1,
      fileSize: 1024,
      originalHash: 'hash-original',
      signedHash: null,
      pdfUrl: '/nda.pdf',
      signedPdfUrl: null,
    }],
    recipients: [{
      id: 'recipient-1',
      name: 'Client',
      email: 'client@example.com',
      type: 'SIGNER',
      signingOrder: 1,
      status: 'QUEUED',
      accessMode: 'EMAIL_LINK',
      hasAccessCode: false,
      colorTag: '#06b6d4',
      consentedAt: null,
      viewedAt: null,
      signedAt: null,
      declinedAt: null,
      declineReason: null,
      fieldsAssigned: 1,
      requiredFieldsAssigned: 1,
      signatureFieldsAssigned: 1,
      copyDeliveryStatus: 'AWAITING_COMPLETION',
    }],
    fields: [],
    fieldValues: [],
    events: [],
  };
}

describe('EsigningStepReview', () => {
  it('renders review information beside a viewport-sized document viewer', () => {
    render(
      <EsigningStepReview
        envelope={makeEnvelope()}
        fields={[]}
        onSend={vi.fn().mockResolvedValue(undefined)}
        isSending={false}
        onBack={vi.fn()}
        manualLinks={[]}
      />
    );

    const layout = screen.getByTestId('esigning-review-layout');
    expect(layout.className).toContain('lg:grid-cols-[25%_75%]');
    expect(screen.getByTestId('esigning-review-info-panel').className).toContain('overflow-y-auto');
    expect(screen.getByTestId('esigning-review-viewer-panel').className).toContain('min-h-0');
    expect(screen.getByTestId('esigning-review-viewer-panel').className).toContain('overflow-hidden');
  });
});

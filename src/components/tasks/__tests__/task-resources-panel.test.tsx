import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskResourcesResponse } from '@/services/tasks/types';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  copyTextToClipboard: vi.fn(),
}));

vi.mock('@/hooks/use-esigning', () => ({
  useEsigningRecipientManualLink: vi.fn(() => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  })),
}));
vi.mock('@/lib/clipboard', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
}));

import { TaskResourcesPanel } from '@/components/tasks/task-resources-panel';

function createData(): TaskResourcesResponse {
  return {
    task: {
      id: 'task-1',
      title: 'Client onboarding',
      status: 'IN_PROGRESS',
      dueDate: '2026-09-30T00:00:00.000Z',
      company: {
        id: 'company-1',
        name: 'Oak Pte. Ltd.',
        uen: '202600001A',
        href: '/companies/company-1',
      },
      owner: { id: 'user-1', name: 'Ava Tan', email: 'ava@example.com' },
      pipelineName: 'Client onboarding',
    },
    stages: [
      {
        id: 'stage-company',
        name: 'Company profile',
        position: 0,
        actionType: 'COMPANY_PROFILE',
        status: 'COMPLETED',
        description: null,
        notes: null,
        startedAt: null,
        completedAt: null,
        assignee: null,
        checklist: [],
        blockers: [],
        resources: [{
          kind: 'company',
          id: 'company-1',
          state: 'available',
          label: 'Company',
          name: 'Oak Pte. Ltd.',
          uen: '202600001A',
          href: '/companies/company-1',
          reason: null,
        }],
      },
      {
        id: 'stage-document',
        name: 'Generate agreement',
        position: 1,
        actionType: 'DOCUMENT_GENERATION',
        status: 'COMPLETED',
        description: null,
        notes: null,
        startedAt: null,
        completedAt: null,
        assignee: null,
        checklist: [],
        blockers: [],
        resources: [{
          kind: 'generatedDocument',
          id: 'doc-1',
          state: 'available',
          label: 'Generated document',
          title: 'Service Agreement',
          status: 'FINALIZED',
          href: '/generated-documents/doc-1?taskId=task-1',
          reason: null,
        }],
      },
      {
        id: 'stage-sign',
        name: 'Obtain signatures',
        position: 2,
        actionType: 'ESIGNING',
        status: 'IN_PROGRESS',
        description: 'Collect signatures from the client.',
        notes: 'Follow up after two business days.',
        startedAt: '2026-08-29T08:00:00.000Z',
        completedAt: null,
        assignee: { id: 'user-2', name: 'Maya Goh', email: 'maya@example.com' },
        checklist: [],
        blockers: [],
        resources: [{
          kind: 'esigningEnvelope',
          id: 'envelope-1',
          state: 'available',
          label: 'Signing request',
          title: 'Service Agreement',
          status: 'IN_PROGRESS',
          pdfGenerationStatus: 'COMPLETED',
          expiresAt: '2026-09-15T00:00:00.000Z',
          completedSignatures: 0,
          requiredSignatures: 1,
          href: '/esigning/envelope-1',
          canGenerateSignerLink: true,
          documents: [{
            id: 'esign-doc-1',
            fileName: 'service-agreement.pdf',
            originalPdfHref: '/api/esigning/envelopes/envelope-1/documents/esign-doc-1/pdf',
            signedPdfHref: null,
          }],
          signers: [{
            id: 'recipient-1',
            name: 'Alex Lim',
            email: 'alex@example.com',
            status: 'NOTIFIED',
            signingOrder: 1,
            linkState: 'available',
          }],
          reason: null,
        }],
      },
    ],
    hasPendingResources: true,
  };
}

describe('TaskResourcesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyTextToClipboard.mockResolvedValue(true);
    mocks.mutateAsync.mockResolvedValue({
      recipientId: 'recipient-1',
      recipientName: 'Alex Lim',
      recipientEmail: 'alex@example.com',
      signingUrl: 'https://app.example.com/sign/token',
    });
  });

  it('renders task, company, generated document, signer, and stage resources', () => {
    render(<TaskResourcesPanel data={createData()} activeStageId="stage-sign" isLoading={false} onRetry={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Task resources' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Oak Pte. Ltd.' })).toHaveAttribute('href', '/companies/company-1');
    expect(screen.getByText('UEN 202600001A')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Service Agreement' })).toHaveAttribute(
      'href',
      expect.stringContaining('/generated-documents/doc-1'),
    );
    expect(screen.getByRole('link', { name: 'Service Agreement' }).parentElement).toHaveTextContent(
      'Service Agreement (Finalized)',
    );
    expect(screen.queryByText('service-agreement-2026-08-29.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'service-agreement-2026-08-29.pdf' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'service-agreement.pdf' })).toHaveAttribute(
      'href',
      '/api/esigning/envelopes/envelope-1/documents/esign-doc-1/pdf',
    );
    expect(screen.getByText('Alex Lim')).toBeVisible();
    const activeStage = screen.getByTestId('task-resource-stage-stage-sign');
    expect(activeStage).toHaveAttribute('data-active', 'true');
    expect(within(activeStage).queryByText('Collect signatures from the client.')).not.toBeInTheDocument();
    expect(within(activeStage).queryByText('Follow up after two business days.')).not.toBeInTheDocument();
    expect(within(activeStage).queryByText('Maya Goh')).not.toBeInTheDocument();
    expect(within(activeStage).queryByText('Started')).not.toBeInTheDocument();
    expect(within(activeStage).queryByText('Assignee')).not.toBeInTheDocument();
    expect(activeStage.querySelector('dl')).toBeNull();
  });

  it('shows loading, retryable errors, pending, unavailable, and empty-stage states', () => {
    const { rerender } = render(
      <TaskResourcesPanel isLoading data={undefined} onRetry={vi.fn()} />,
    );
    expect(screen.getByTestId('task-resources-panel')).toHaveAttribute('aria-busy', 'true');

    rerender(<TaskResourcesPanel
      isLoading={false}
      error={new Error('Could not load resources')}
      onRetry={vi.fn()}
    />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load resources');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();

    const data = createData();
    data.stages[0].resources = [{
      kind: 'company',
      id: null,
      state: 'pending',
      label: 'Company',
      name: null,
      uen: null,
      href: null,
      reason: 'This resource will appear when the stage creates or links it.',
    }];
    data.stages[1].resources = [{
      kind: 'generatedDocument',
      id: null,
      state: 'unavailable',
      label: 'Generated document',
      title: null,
      status: null,
      href: null,
      reason: 'You do not have permission to view this resource.',
    }];
    data.stages[2].resources = [];
    rerender(<TaskResourcesPanel data={data} activeStageId="stage-company" isLoading={false} onRetry={vi.fn()} />);
    expect(screen.getByText('This resource will appear when the stage creates or links it.')).toBeVisible();
    expect(screen.getByText('You do not have permission to view this resource.')).toBeVisible();
    expect(screen.getByText('No linked resources for this stage.')).toBeVisible();
    expect(screen.queryByText('doc-1')).not.toBeInTheDocument();
  });

  it('renders multiple generated documents with inline statuses and no PDF links', () => {
    const data = createData();
    const generatedDocument = data.stages[1].resources[0];
    if (generatedDocument.kind !== 'generatedDocument') throw new Error('fixture error');
    data.stages[1].resources = [
      generatedDocument,
      {
        ...generatedDocument,
        id: 'doc-2',
        title: 'Privacy Notice',
        status: 'DRAFT',
        href: '/generated-documents/doc-2?taskId=task-1',
      },
    ];

    render(<TaskResourcesPanel data={data} isLoading={false} onRetry={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Service Agreement' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Service Agreement' }).parentElement).toHaveTextContent(
      'Service Agreement (Finalized)',
    );
    expect(screen.getByRole('link', { name: 'Privacy Notice' }).parentElement).toHaveTextContent(
      'Privacy Notice (Draft)',
    );
    expect(document.querySelector('a[href="/api/generated-documents/doc-1/export/pdf"]')).toBeNull();
    expect(document.querySelector('a[href="/api/generated-documents/doc-2/export/pdf"]')).toBeNull();
  });

  it('explains processing PDFs and shows the signed link after completion', () => {
    const data = createData();
    const envelope = data.stages[2].resources[0];
    if (envelope.kind !== 'esigningEnvelope') throw new Error('fixture error');
    envelope.pdfGenerationStatus = 'PROCESSING';
    const { rerender } = render(<TaskResourcesPanel data={data} isLoading={false} onRetry={vi.fn()} />);
    expect(screen.getByText('Signed PDFs are processing')).toBeVisible();

    envelope.pdfGenerationStatus = 'COMPLETED';
    envelope.documents[0].signedPdfHref = '/api/esigning/envelopes/envelope-1/documents/esign-doc-1/signed-pdf';
    rerender(<TaskResourcesPanel data={data} isLoading={false} onRetry={vi.fn()} />);
    expect(screen.queryByText('Signed PDFs are processing')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Signed PDF: service-agreement.pdf' })).toHaveAttribute(
      'href',
      '/api/esigning/envelopes/envelope-1/documents/esign-doc-1/signed-pdf',
    );
  });

  it('copies a generated signer link without printing the raw URL', async () => {
    render(<TaskResourcesPanel data={createData()} isLoading={false} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Get signing link for Alex Lim' }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith('https://app.example.com/sign/token');
    expect(screen.getByRole('link', { name: 'Open signing link for Alex Lim' })).toHaveAttribute(
      'href',
      'https://app.example.com/sign/token',
    );
    expect(screen.queryByText('https://app.example.com/sign/token')).not.toBeInTheDocument();
  });
});

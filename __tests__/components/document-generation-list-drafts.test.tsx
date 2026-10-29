import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentTable, type GeneratedDocument } from '@/components/documents/document-table';

vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreferences: () => ({
    data: {
      'generated-documents:list:columns:v1': {
        key: 'generated-documents:list:columns:v1',
        value: {},
        updatedAt: null,
      },
    },
  }),
  useUpsertUserPreference: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/components/ui/company-select', () => ({
  CompanySelect: () => <input aria-label="Filter by company" readOnly />,
}));

const baseDocument: GeneratedDocument = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Board resolution draft',
  status: 'DRAFT',
  content: '',
  useLetterhead: true,
  createdAt: '2026-07-18T01:00:00.000Z',
  updatedAt: '2026-07-18T02:00:00.000Z',
  createdBy: { firstName: 'Ava', lastName: 'Tan' },
  metadata: {
    generationSession: {
      version: 1,
      currentStep: 2,
      templateId: '33333333-3333-4333-8333-333333333333',
      companyId: null,
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      title: 'Board resolution draft',
      customData: {},
      useLetterhead: true,
      previewContent: null,
      editedContent: null,
      editedContentJson: null,
    },
  },
};

describe('DocumentTable generation drafts', () => {
  it('offers resume and discard for active generation sessions', () => {
    const onDiscardDraft = vi.fn();
    render(<DocumentTable documents={[baseDocument]} onDiscardDraft={onDiscardDraft} />);

    const resumeLinks = screen.getAllByRole('link', { name: 'Resume Board resolution draft' });
    expect(resumeLinks[0]).toHaveAttribute(
      'href',
      '/generated-documents/generate?draft=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(screen.queryByRole('link', { name: 'Edit Board resolution draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export Board resolution draft as PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Share Board resolution draft' })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Discard Board resolution draft' })[0]);
    expect(onDiscardDraft).toHaveBeenCalledWith(baseDocument.id);
  });

  it('keeps normal draft actions for generated documents', () => {
    render(<DocumentTable documents={[{ ...baseDocument, metadata: null }]} />);

    expect(screen.getAllByRole('link', { name: 'Edit Board resolution draft' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Export Board resolution draft as PDF' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Resume Board resolution draft' })).not.toBeInTheDocument();
  });

  it('does not offer resume actions for hidden batch children without a legacy session', () => {
    render(<DocumentTable documents={[{
      ...baseDocument,
      metadata: { batchItem: true },
    }]} />);

    expect(screen.queryByRole('link', { name: 'Resume Board resolution draft' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Edit Board resolution draft' }).length).toBeGreaterThan(0);
  });

  it('respects update and delete permissions for generation-session actions', () => {
    render(<DocumentTable
      documents={[baseDocument]}
      canEdit={false}
      canDelete={false}
    />);

    expect(screen.queryByRole('link', { name: 'Resume Board resolution draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard Board resolution draft' })).not.toBeInTheDocument();
  });
});

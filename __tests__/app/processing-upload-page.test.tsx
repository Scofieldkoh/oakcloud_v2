import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProcessingUploadPage from '@/app/(dashboard)/processing/upload/page';

const setSelectedCompany = vi.fn();

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { isSuperAdmin: false, tenantId: 'tenant-1' } }),
}));

vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => 'tenant-1',
}));

vi.mock('@/components/ui/company-selector', () => ({
  useActiveCompanyId: () => undefined,
}));

vi.mock('@/hooks/use-company-search', () => ({
  useCompanySearch: () => ({
    searchQuery: 'Oakt',
    setSearchQuery: vi.fn(),
    options: [
      {
        id: 'company-1',
        name: 'Oaktree Accounting & Corporate Solutions Pte. Ltd.',
        label: 'Oaktree Accounting & Corporate Solutions Pte. Ltd.',
        description: '202400001A',
        uen: '202400001A',
      },
    ],
    isLoading: false,
    selectedCompany: null,
    setSelectedCompany,
  }),
}));

vi.mock('@/components/ui/async-search-select', () => ({
  AsyncSearchSelect: ({ value, options }: { value: string; options: Array<{ label: string }> }) => (
    <div>
      <div data-testid="selected-company-value">{value}</div>
      <div data-testid="company-options">{options.map((option) => option.label).join(', ')}</div>
    </div>
  ),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/components/ui/ai-model-selector', () => ({
  AIModelSelector: () => <div data-testid="ai-model-selector" />,
  buildFullContext: () => '',
}));

vi.mock('@/components/processing/file-merge-modal', () => ({
  FileMergeModal: () => null,
}));

vi.mock('@/components/processing/document-extraction-prompt-modal', () => ({
  DocumentExtractionPromptModal: () => null,
}));

vi.mock('@/hooks/use-document-extraction-prompt-settings', () => ({
  useDocumentExtractionPromptSettings: () => ({
    settings: {},
    setSettings: vi.fn(),
    standardContextOptions: [],
  }),
}));

vi.mock('@/lib/pdf-utils', () => ({
  processFileForUpload: vi.fn(),
  isSupportedFileType: () => true,
}));

vi.mock('@/lib/file-hash', () => ({
  calculateFileHash: vi.fn(),
}));

vi.mock('@/lib/browser-upload', () => ({
  postFormDataWithFallback: vi.fn(),
}));

describe('ProcessingUploadPage company selector', () => {
  beforeEach(() => {
    setSelectedCompany.mockClear();
  });

  it('shows a single filtered company without auto-selecting it', async () => {
    render(<ProcessingUploadPage />);

    expect(screen.getByTestId('company-options')).toHaveTextContent(
      'Oaktree Accounting & Corporate Solutions Pte. Ltd.'
    );

    await waitFor(() => expect(screen.getByTestId('selected-company-value')).toBeEmptyDOMElement());
    expect(setSelectedCompany).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BatchTemplatePicker,
  type BatchTemplatePickerProps,
} from '@/components/documents/generation-batch/batch-template-picker';
import type {
  EditableBatchItem,
} from '@/components/documents/generation-batch/batch-workspace-state';
import type { DocumentTemplateSummary } from '@/types/document-generation';

function template(id: string, name: string, overrides: Partial<DocumentTemplateSummary> = {}): DocumentTemplateSummary {
  return {
    id,
    name,
    description: null,
    category: 'OTHER',
    compositionType: 'STANDARD',
    version: 1,
    isActive: true,
    engine: 'OAKDOC',
    content: '<p>x</p>',
    placeholders: [],
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

const engagement = template('template-a', 'Engagement Letter', { category: 'LETTER' });
const serviceAgreement = template('template-b', 'Service Agreement', {
  category: 'CONTRACT',
  compositionType: 'SERVICE_AGREEMENT',
  description: 'Service Agreement Template',
  version: 33,
});
const kyc = template('template-c', 'KYC Checklist');

function item(template: DocumentTemplateSummary): EditableBatchItem {
  return {
    key: template.id,
    templateId: template.id,
    templateName: template.name,
    templateKind: template.compositionType,
    templateVersion: template.version,
    templateEngine: 'A4',
    status: 'NOT_STARTED',
    configuration: {
      version: 1,
      title: `Untitled - ${template.name}`,
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {},
      masterOverrides: {},
      useLetterhead: true,
      serviceAgreement: null,
    },
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: null,
    reviewedFingerprint: null,
    validationDiagnostics: null,
    lastError: null,
  };
}

function pickerProps(overrides: Partial<BatchTemplatePickerProps> = {}): BatchTemplatePickerProps {
  return {
    templates: [engagement, serviceAgreement, kyc],
    selected: [],
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
}

function catalogueCard(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^${name}`, 'i') });
}

describe('BatchTemplatePicker', () => {
  it('shows names only in a single-column 60/40 picker layout', () => {
    const { container } = render(<BatchTemplatePicker {...pickerProps({
      selected: [item(serviceAgreement)],
    })} />);

    const catalogue = screen.getByRole('region', { name: 'Template catalogue' });
    const layout = catalogue.parentElement;

    expect(layout).toHaveClass('lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]');
    for (const list of within(catalogue).getAllByRole('list')) {
      expect(list).not.toHaveClass('sm:grid-cols-2', 'xl:grid-cols-2');
    }
    expect(screen.getAllByText('Service Agreement')).toHaveLength(2);
    expect(screen.queryByText('Service Agreement Template')).not.toBeInTheDocument();
    expect(screen.queryByText('Service Agreement · 0 fields · v33')).not.toBeInTheDocument();
    expect(container.querySelector('section[aria-label="Documents in this batch"]')).toBeInTheDocument();
  });

  it('leaves retired A4 templates out of the catalogue', () => {
    const legacy = template('template-d', 'Legacy Letter', { engine: 'A4' });
    render(<BatchTemplatePicker {...pickerProps({ templates: [engagement, legacy] })} />);

    expect(screen.getByRole('button', { name: /^Engagement Letter/i })).toBeInTheDocument();
    expect(screen.queryByText('Legacy Letter')).not.toBeInTheDocument();
  });

  it('opens the selected template editor from the far-right actions menu', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<BatchTemplatePicker {...pickerProps({ templates: [engagement] })} />);

    await user.click(screen.getByRole('button', { name: 'Actions for Engagement Letter' }));
    expect(screen.getByRole('menuitem', { name: 'Open template' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Open template' }));
    expect(openSpy).toHaveBeenCalledWith(
      '/template-partials/editor?id=template-a&tab=templates',
      '_blank',
      'noopener,noreferrer',
    );

    openSpy.mockRestore();
  });

  it('adds a template from its whole card, marks the selection and adds it again on a second click', async () => {
    const user = userEvent.setup();
    const props = pickerProps();
    const first = render(<BatchTemplatePicker {...props} />);

    await user.click(catalogueCard('Engagement Letter'));
    expect(props.onAdd).toHaveBeenCalledWith(engagement);
    first.unmount();

    const selectedProps = pickerProps({ selected: [item(engagement)] });
    const { unmount } = render(<BatchTemplatePicker {...selectedProps} />);
    // Selected templates stay in the catalogue so the mapping is obvious.
    expect(catalogueCard('Engagement Letter')).toHaveAttribute('aria-pressed', 'true');
    expect(catalogueCard('Service Agreement')).toHaveAttribute('aria-pressed', 'false');
    // A selected template can be added again, for example a second resolution.
    await user.click(catalogueCard('Engagement Letter'));
    expect(selectedProps.onAdd).toHaveBeenCalledWith(engagement);
    expect(selectedProps.onRemove).not.toHaveBeenCalled();
    unmount();
  });

  it('enforces the document maximum using the configured limit', async () => {
    const user = userEvent.setup();
    const selected = Array.from({ length: 19 }, (_, index) =>
      item(template(`template-${index}`, `Template ${index}`)));
    const props = pickerProps({
      selected,
      maxDocuments: 20,
    });
    const first = render(<BatchTemplatePicker {...props} />);

    expect(screen.getByText('19 of 20')).toBeInTheDocument();
    expect(screen.queryByText(/maximum of 20 documents reached/i)).not.toBeInTheDocument();
    await user.click(catalogueCard('Service Agreement'));
    expect(props.onAdd).toHaveBeenCalledWith(serviceAgreement);
    first.unmount();

    const atLimit = pickerProps({
      selected: [...selected, item(serviceAgreement)],
      maxDocuments: 20,
      templates: [kyc],
    });
    const second = render(<BatchTemplatePicker {...atLimit} />);
    expect(screen.getByText(/maximum of 20 documents reached/i)).toBeInTheDocument();
    expect(catalogueCard('KYC Checklist')).toBeDisabled();
    second.unmount();
  });

  it('supports keyboard reorder, drag reorder, and removing the last document', async () => {
    const user = userEvent.setup();
    const selected = [item(engagement), item(serviceAgreement)];
    const props = pickerProps({ selected, onMove: vi.fn() });
    const { unmount } = render(<BatchTemplatePicker {...props} />);

    await user.click(screen.getByRole('button', { name: 'Move Service Agreement up' }));
    expect(props.onReorder).toHaveBeenCalledWith('template-b', -1);

    await user.click(screen.getByRole('button', { name: 'Remove Engagement Letter' }));
    expect(props.onRemove).toHaveBeenCalledWith('template-a');
    // The last remaining document is removable; the empty state explains what to do.
    expect(screen.getByRole('button', { name: 'Remove Service Agreement' })).not.toBeDisabled();
    unmount();

    const single = pickerProps({ selected: [item(engagement)] });
    render(<BatchTemplatePicker {...single} />);
    await user.click(screen.getByRole('button', { name: 'Remove Engagement Letter' }));
    expect(single.onRemove).toHaveBeenCalledWith('template-a');
  });

  it('confirms before discarding a document that already has draft data', async () => {
    const user = userEvent.setup();
    const dirty = item(engagement);
    dirty.configuration.itemValues = { 'custom.reference': 'REF-1' };
    const props = pickerProps({ selected: [dirty] });
    render(<BatchTemplatePicker {...props} />);

    await user.click(screen.getByRole('button', { name: 'Remove Engagement Letter' }));
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /remove document/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove document/i }));
    expect(props.onRemove).toHaveBeenCalledWith('template-a');
  });

  it('groups templates under collapsible category headers, expanded, without category subtext', async () => {
    const user = userEvent.setup();
    render(<BatchTemplatePicker {...pickerProps()} />);

    const catalogue = screen.getByRole('region', { name: 'Template catalogue' });
    const headers = within(catalogue).getAllByRole('button', { expanded: true });
    expect(headers.map((header) => header.textContent)).toEqual([
      expect.stringContaining('CONTRACT'),
      expect.stringContaining('LETTER'),
      expect.stringContaining('OTHER'),
    ]);
    const letters = within(catalogue).getByRole('region', { name: 'LETTER' });
    expect(within(letters).getByRole('button', { name: /^Engagement Letter/ })).toBeInTheDocument();
    expect(within(letters).queryByText('LETTER')).not.toBeInTheDocument();

    await user.click(headers[1]);
    expect(headers[1]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/left-click a template to add it, right-click to remove one/i)).toBeInTheDocument();
  });

  it('shows minus, quantity and plus once added, and removes with minus or right-click', async () => {
    const user = userEvent.setup();
    const first = item(engagement);
    const second = { ...item(engagement), key: 'template-a~1' };
    const props = pickerProps({ selected: [first, second] });
    render(<BatchTemplatePicker {...props} />);

    const quantity = screen.getByRole('group', { name: 'Engagement Letter quantity' });
    expect(quantity).toHaveTextContent('2');
    expect(screen.queryByText(/add again/i)).not.toBeInTheDocument();

    await user.click(within(quantity).getByRole('button', { name: 'Add another Engagement Letter' }));
    expect(props.onAdd).toHaveBeenCalledWith(engagement);

    await user.click(within(quantity).getByRole('button', { name: 'Remove one Engagement Letter' }));
    expect(props.onRemove).toHaveBeenLastCalledWith('template-a~1');

    await user.pointer({ keys: '[MouseRight]', target: catalogueCard('Engagement Letter') });
    expect(props.onRemove).toHaveBeenCalledTimes(2);
    // Right-click on a template that isn't added does nothing.
    await user.pointer({ keys: '[MouseRight]', target: catalogueCard('KYC Checklist') });
    expect(props.onRemove).toHaveBeenCalledTimes(2);
  });

  it('shows a no-match state and an empty batch state', () => {
    render(<BatchTemplatePicker {...pickerProps({
      templates: [],
      disabled: true,
    })} />);
    expect(screen.getByText(/no templates match/i)).toBeInTheDocument();
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
  });
});

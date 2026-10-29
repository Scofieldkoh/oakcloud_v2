import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OakDocRepeaterPanel } from '@/components/documents/oakdoc/oakdoc-repeater-panel';
import type { OakDocRepeaterSections } from '@/lib/document-editor/oakdoc-custom-fields';

vi.mock('@/components/ui/contact-search-select', () => ({
  ContactSearchSelect: ({ label, onChange }: {
    label?: string;
    onChange: (id: string, contact: { id: string; fullName: string } | null) => void;
  }) => (
    <button type="button" onClick={() => onChange('c2', { id: 'c2', fullName: 'Bea Tan' })}>
      {label}: add Bea Tan
    </button>
  ),
}));

function panel(overrides: Partial<Parameters<typeof OakDocRepeaterPanel>[0]> = {}) {
  const props = {
    repeaterTags: [] as string[],
    fieldTags: [] as string[],
    onAdd: vi.fn(),
    onRemoveAtCaret: vi.fn(),
    onAssignField: vi.fn(),
    ...overrides,
  };
  renderOpen(<OakDocRepeaterPanel {...props} />);
  return props;
}

/** Renders the panel and opens it; it starts collapsed. */
function renderOpen(ui: React.ReactElement) {
  render(ui);
  fireEvent.click(screen.getByRole('button', { name: /^Repeating sections/ }));
}

describe('OakDocRepeaterPanel', () => {
  it('shows the New section hint behind an information icon', async () => {
    const user = userEvent.setup();
    panel();
    expect(screen.queryByText(/Put the caret in the paragraph/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About New section' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Put the caret in the paragraph or table row to repeat');
  });

  it('starts collapsed', () => {
    render(<OakDocRepeaterPanel repeaterTags={['repeat.directors']} fieldTags={[]} onAdd={vi.fn()} onRemoveAtCaret={vi.fn()} onAssignField={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Repeating sections/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Directors sections' })).not.toBeInTheDocument();
  });

  it('inserts an Officers section for any role, or limited to the ticked roles', async () => {
    const user = userEvent.setup();
    const props = panel();

    await user.click(screen.getByRole('button', { name: 'Officers' }));
    await user.click(screen.getByRole('button', { name: 'Add Officers section' }));
    expect(props.onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'repeat.officers', label: 'Officers' }));

    // Adding opens the new section; open the Officers kind again for a limited one.
    await user.click(screen.getAllByRole('button', { name: 'Officers' }).at(-1)!);
    const roles = screen.getByRole('group', { name: 'Officer roles' });
    await user.click(within(roles).getByRole('button', { name: 'CEO' }));
    await user.click(within(roles).getByRole('button', { name: 'Secretary' }));
    expect(within(roles).getByRole('button', { name: 'Secretary' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('repeat.officers.secretary+ceo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Officers (Secretary, CEO) section' }));
    expect(props.onAdd).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'officers',
      tag: 'repeat.officers.secretary+ceo',
      label: 'Officers (Secretary, CEO)',
    }));
  });

  it('shows the officers repeaters in the document with their roles', () => {
    panel({ repeaterTags: ['repeat.officers', 'repeat.officers.secretary'] });
    const sections = screen.getByRole('list', { name: 'Officers sections' });
    expect(within(sections).getByText('Officers (any role)')).toBeInTheDocument();
    expect(within(sections).getByText('Officers (Secretary)')).toBeInTheDocument();
  });

  it('switches lettering (a), (b) on a section in the document', async () => {
    const user = userEvent.setup();
    const onLetteredChange = vi.fn();
    panel({ repeaterTags: ['repeat.officers.secretary'], letteredTags: [], onLetteredChange });
    const sections = screen.getByRole('list', { name: 'Officers sections' });
    await user.click(within(sections).getByRole('button', { name: 'Officers (Secretary)' }));
    const toggle = within(sections).getByRole('switch', { name: 'Letter each one (a), (b)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(onLetteredChange).toHaveBeenCalledWith('repeat.officers.secretary', true);
  });

  it('switches a section to one document per person, on templates only', async () => {
    const user = userEvent.setup();
    const onSectionsChange = vi.fn();
    const sections: OakDocRepeaterSections = { names: {}, shortlists: {}, perPersonTag: 'repeat.officers.secretary' };
    panel({ repeaterTags: ['repeat.directors', 'repeat.officers.secretary', 'repeat.signers'], sections, onSectionsChange, allowPerPerson: true });
    const directors = screen.getByRole('list', { name: 'Directors sections' });
    await user.click(within(directors).getByRole('button', { name: 'Directors' }));
    const toggle = within(directors).getByRole('switch', { name: 'Separate document for each person' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    // One section per template: switching it on here moves it from the secretary section.
    expect(onSectionsChange).toHaveBeenLastCalledWith({ ...sections, perPersonTag: 'repeat.directors' });
    expect(screen.getByText(/Officers \(Secretary\) · one document each/)).toBeInTheDocument();
    const signers = screen.getByRole('list', { name: 'Signers sections' });
    await user.click(within(signers).getByRole('button', { name: 'Signers' }));
    expect(within(signers).queryByRole('switch', { name: 'Separate document for each person' })).not.toBeInTheDocument();
  });

  it('offers no per-person switch in partials', async () => {
    const user = userEvent.setup();
    panel({ repeaterTags: ['repeat.directors'], sections: { names: {}, shortlists: {} }, onSectionsChange: vi.fn() });
    const directors = screen.getByRole('list', { name: 'Directors sections' });
    await user.click(within(directors).getByRole('button', { name: 'Directors' }));
    expect(within(directors).queryByRole('switch', { name: 'Separate document for each person' })).not.toBeInTheDocument();
  });

  it('shows a lettered section switched on', async () => {
    const user = userEvent.setup();
    panel({ repeaterTags: ['repeat.directors'], letteredTags: ['repeat.directors'], onLetteredChange: vi.fn() });
    const sections = screen.getByRole('list', { name: 'Directors sections' });
    await user.click(within(sections).getByRole('button', { name: 'Directors' }));
    expect(within(sections).getByRole('switch', { name: 'Letter each one (a), (b)' })).toHaveAttribute('aria-checked', 'true');
  });

  it('opens a section in the document to add its fields', async () => {
    const user = userEvent.setup();
    const props = panel({ repeaterTags: ['repeat.directors'], fieldTags: ['director.name'] });
    const sections = screen.getByRole('list', { name: 'Directors sections' });
    await user.click(within(sections).getByRole('button', { name: 'Directors' }));
    await user.click(within(sections).getByRole('button', { name: 'Director Role' }));
    await user.click(within(sections).getByRole('button', { name: 'Add Director Role' }));
    expect(props.onAssignField).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'director.role' }));
  });

  it('edits the contacts repeater shortlist', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [sections, setSections] = useState<OakDocRepeaterSections>({
        names: {},
        shortlists: { 'repeat.contacts': [{ id: 'c1', name: 'Alex Lim' }] },
      });
      return (
        <OakDocRepeaterPanel
          repeaterTags={['repeat.contacts']}
          fieldTags={[]}
          onAdd={vi.fn()}
          onRemoveAtCaret={vi.fn()}
          onAssignField={vi.fn()}
          sections={sections}
          onSectionsChange={setSections}
        />
      );
    }
    renderOpen(<Harness />);

    await user.click(within(screen.getByRole('list', { name: 'Contacts sections' })).getByRole('button', { name: 'Contacts' }));
    expect(screen.getByText('Configure offers 1 shortlisted contact.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Shortlist' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /add Bea Tan/ }));
    expect(within(dialog).getByRole('list', { name: 'Contact shortlist' })).toHaveTextContent('Alex LimBea Tan');
    await user.click(within(dialog).getByRole('button', { name: 'Remove Alex Lim' }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Configure offers 1 shortlisted contact.')).toBeInTheDocument();
  });

  it('does not offer a shortlist without the contacts repeater or an editor for it', async () => {
    const user = userEvent.setup();
    panel({ repeaterTags: ['repeat.contacts'] });
    await user.click(within(screen.getByRole('list', { name: 'Contacts sections' })).getByRole('button', { name: 'Contacts' }));
    expect(screen.queryByRole('button', { name: 'Shortlist' })).not.toBeInTheDocument();
  });

  describe('named sections', () => {
    function Harness({ tags, initial, onAdd, onChange }: {
      tags: string[];
      initial?: OakDocRepeaterSections;
      onAdd?: (definition: unknown) => void;
      onChange?: (sections: OakDocRepeaterSections) => void;
    }) {
      const [sections, setSections] = useState<OakDocRepeaterSections>(initial ?? { names: {}, shortlists: {} });
      return (
        <OakDocRepeaterPanel
          repeaterTags={tags}
          fieldTags={[]}
          onAdd={onAdd ?? vi.fn()}
          onRemoveAtCaret={vi.fn()}
          onAssignField={vi.fn()}
          sections={sections}
          onSectionsChange={(next) => {
            setSections(next);
            onChange?.(next);
          }}
        />
      );
    }

    it('inserts a named Contacts section as its own list', async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();
      const onChange = vi.fn();
      renderOpen(<Harness tags={[]} onAdd={onAdd} onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Contacts' }));
      await user.type(screen.getByLabelText('List name on Configure'), 'Corporate secretary to be appointed');
      await user.click(screen.getByRole('button', { name: 'Add Contacts (Corporate secretary to be appointed) section' }));
      expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'contacts',
        tag: 'repeat.contacts.corporate-secretary-to-be-appointed',
        label: 'Contacts (Corporate secretary to be appointed)',
      }));
      expect(onChange).toHaveBeenLastCalledWith({
        names: { 'repeat.contacts.corporate-secretary-to-be-appointed': 'Corporate secretary to be appointed' },
        shortlists: {},
      });
      // The name box is cleared for the next section.
      await user.click(screen.getByRole('button', { name: 'Contacts' }));
      expect(screen.getByLabelText('List name on Configure')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Add Contacts section' })).toBeInTheDocument();
    });

    it('shortlists the contacts of a new Contacts section before it is added', async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();
      const onChange = vi.fn();
      renderOpen(<Harness tags={[]} onAdd={onAdd} onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Contacts' }));
      expect(screen.getByText('Empty: Configure searches every contact. Add contacts to offer only them.')).toBeInTheDocument();
      await user.type(screen.getByLabelText('List name on Configure'), 'Auditor');
      await user.click(screen.getByRole('button', { name: /add Bea Tan/ }));
      expect(screen.getByRole('list', { name: 'Contact shortlist' })).toHaveTextContent('Bea Tan');
      expect(screen.getByText('Configure offers only these 1 contact.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add Contacts (Auditor) section' }));
      expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'repeat.contacts.auditor' }));
      expect(onChange).toHaveBeenLastCalledWith({
        names: { 'repeat.contacts.auditor': 'Auditor' },
        shortlists: { 'repeat.contacts.auditor': [{ id: 'c2', name: 'Bea Tan' }] },
      });
    });

    it('names any other section as a label, keeping its tag', async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();
      const onChange = vi.fn();
      renderOpen(<Harness tags={[]} onAdd={onAdd} onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Directors' }));
      await user.type(screen.getByLabelText('Name on Configure'), 'Signers for the resolution(s)');
      await user.click(screen.getByRole('button', { name: 'Add Directors section' }));
      expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'repeat.directors' }));
      expect(onChange).toHaveBeenLastCalledWith({
        names: { 'repeat.directors': 'Signers for the resolution(s)' },
        shortlists: {},
      });
    });

    it('renames a section in the document', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderOpen(
        <Harness
          tags={['repeat.directors', 'repeat.contacts.corp-sec']}
          initial={{ names: { 'repeat.directors': 'Signers', 'repeat.contacts.corp-sec': 'Corp sec' }, shortlists: {} }}
          onChange={onChange}
        />,
      );

      expect(screen.getByText('Corp sec · Contacts list')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Signers · Directors' }));
      const name = screen.getByRole('textbox', { name: 'Name on Configure' });
      await user.clear(name);
      await user.type(name, 'Approving directors');
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        names: { 'repeat.directors': 'Approving directors', 'repeat.contacts.corp-sec': 'Corp sec' },
      }));
    });

    it('needs letters or numbers in a Contacts list name', async () => {
      const user = userEvent.setup();
      renderOpen(<Harness tags={[]} />);
      await user.click(screen.getByRole('button', { name: 'Contacts' }));
      await user.type(screen.getByLabelText('List name on Configure'), '!!!');
      expect(screen.getByText('A Contacts list name needs letters or numbers.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Contacts section' })).toBeDisabled();
    });

    it("edits each contacts list's own shortlist", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderOpen(
        <Harness
          tags={['repeat.contacts', 'repeat.contacts.corp-sec']}
          initial={{
            names: { 'repeat.contacts.corp-sec': 'Corp sec' },
            shortlists: { 'repeat.contacts': [{ id: 'c1', name: 'Alex Lim' }] },
          }}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Corp sec · Contacts list' }));
      await user.click(screen.getByRole('button', { name: 'Shortlist for Corp sec' }));
      const dialog = screen.getByRole('dialog', { name: 'Corp sec shortlist' });
      await user.click(within(dialog).getByRole('button', { name: /add Bea Tan/ }));
      expect(onChange).toHaveBeenLastCalledWith({
        names: { 'repeat.contacts.corp-sec': 'Corp sec' },
        shortlists: {
          'repeat.contacts': [{ id: 'c1', name: 'Alex Lim' }],
          'repeat.contacts.corp-sec': [{ id: 'c2', name: 'Bea Tan' }],
        },
      });
    });
  });
});

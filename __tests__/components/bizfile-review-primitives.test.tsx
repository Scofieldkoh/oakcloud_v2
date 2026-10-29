import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ReviewCheckbox,
  ReviewField,
  ReviewSelect,
  ReviewTextarea,
} from '@/components/companies/bizfile-review/bizfile-review-fields';
import { RepeatingRecordEditor } from '@/components/companies/bizfile-review/repeating-record-editor';

describe('BizFile review fields', () => {
  it('connects labels, hints, and issues to native controls', () => {
    render(
      <>
        <ReviewField id="name" label="Name" hint="Registered name" error={{ path: 'entityDetails.name', message: 'Required', section: 'entity' }} />
        <ReviewSelect id="status" label="Status" error="Choose a status"><option>Active</option></ReviewSelect>
        <ReviewTextarea id="notes" label="Notes" hint="Optional notes" />
        <ReviewCheckbox id="confirmed" label="Confirmed" error="Confirmation required" />
      </>,
    );

    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', 'name-hint name-error');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toHaveAttribute('id', 'name-error');
    expect(screen.getByLabelText('Status')).toHaveAttribute('aria-describedby', 'status-error');
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-describedby', 'notes-hint');
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Confirmed')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('RepeatingRecordEditor', () => {
  interface Officer { id: string; name: string; details: { role: string } }

  const createOfficer = (): Officer => ({ id: 'new', name: '', details: { role: '' } });
  const duplicateOfficer = (item: Officer): Officer => ({ ...item, id: `${item.id}-copy`, details: { ...item.details } });
  const commonProps = {
    title: 'Officers',
    createItem: createOfficer,
    duplicateItem: duplicateOfficer,
    getItemKey: (item: Officer) => item.id,
    getItemLabel: (item: Officer) => item.name || 'New officer',
  };

  it('adds, duplicates independently, removes, and restores records', () => {
    const onChange = vi.fn();
    const alice: Officer = { id: 'alice', name: 'Alice', details: { role: 'Director' } };
    const items = [alice];
    const { rerender } = render(
      <RepeatingRecordEditor {...commonProps} items={items} onChange={onChange}
        renderItem={(item) => <input aria-label="Officer name" value={item.name} readOnly />} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Officers' }));
    expect(onChange).toHaveBeenLastCalledWith([alice, createOfficer()]);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Alice' }));
    const duplicatedItems = onChange.mock.lastCall?.[0] as Officer[];
    expect(duplicatedItems).toEqual([alice, { ...alice, id: 'alice-copy' }]);
    expect(duplicatedItems[1]).not.toBe(alice);
    expect(duplicatedItems[1].details).not.toBe(alice.details);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    rerender(<RepeatingRecordEditor {...commonProps} items={[]} onChange={onChange}
      renderItem={() => null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo remove Alice' }));
    expect(onChange).toHaveBeenLastCalledWith([alice]);
  });

  it.each([
    ['added', (buttonName: string) => buttonName === 'Add Officers'],
    ['duplicated', (buttonName: string) => buttonName === 'Duplicate Alice'],
  ])('focuses the first enabled, tabbable control in a newly %s row', async (_operation, matchesButton) => {
    const item: Officer = { id: 'alice', name: 'Alice', details: { role: 'Director' } };
    const onChange = vi.fn();
    const editor = (items: Officer[]) => <RepeatingRecordEditor {...commonProps} items={items} onChange={onChange}
      renderItem={(row) => <><input aria-label={`Disabled ${row.id}`} disabled /><button tabIndex={-1}>Skip {row.id}</button><input aria-label={`Edit ${row.id}`} /></>} />;
    const { rerender } = render(editor([item]));

    const buttonName = matchesButton('Add Officers') ? 'Add Officers' : 'Duplicate Alice';
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
    const nextItems = onChange.mock.lastCall?.[0] as Officer[];
    rerender(editor(nextItems));
    await vi.waitFor(() => expect(screen.getByLabelText(`Edit ${nextItems[1].id}`)).toHaveFocus());
  });

  it('updates a row without mutating the original item', () => {
    const item: Officer = { id: 'alice', name: 'Alice', details: { role: 'Director' } };
    const onChange = vi.fn();
    render(<RepeatingRecordEditor {...commonProps} items={[item]} onChange={onChange}
      renderItem={(row, _index, update) => <input aria-label="Edit Alice" value={row.name}
        onChange={(event) => update({ ...row, name: event.target.value })} />} />);

    fireEvent.change(screen.getByLabelText('Edit Alice'), { target: { value: 'Alicia' } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...item, name: 'Alicia' }]);
    expect(item.name).toBe('Alice');
  });

  it('restores a middle row at its original position without resetting surrounding row state', () => {
    function StatefulRow({ item }: { item: Officer }) {
      const [note, setNote] = useState('');
      return <input aria-label={`Note ${item.name}`} value={note} onChange={(event) => setNote(event.target.value)} />;
    }
    const officers: Officer[] = [
      { id: 'alice', name: 'Alice', details: { role: 'Director' } },
      { id: 'bob', name: 'Bob', details: { role: 'Secretary' } },
      { id: 'carol', name: 'Carol', details: { role: 'Member' } },
    ];
    let current = officers;
    const onChange = vi.fn((next: Officer[]) => { current = next; });
    const editor = () => <RepeatingRecordEditor {...commonProps} items={current} onChange={onChange}
      renderItem={(item) => <StatefulRow item={item} />} />;
    const { rerender } = render(editor());
    fireEvent.change(screen.getByLabelText('Note Alice'), { target: { value: 'keep-alice' } });
    fireEvent.change(screen.getByLabelText('Note Carol'), { target: { value: 'keep-carol' } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    rerender(editor());
    expect(screen.getByLabelText('Note Alice')).toHaveValue('keep-alice');
    expect(screen.getByLabelText('Note Carol')).toHaveValue('keep-carol');
    fireEvent.click(screen.getByRole('button', { name: 'Undo remove Bob' }));
    rerender(editor());

    expect(current.map((item) => item.name)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(screen.getAllByRole('textbox').map((control) => control.getAttribute('aria-label'))).toEqual(['Note Alice', 'Note Bob', 'Note Carol']);
    expect(screen.getByLabelText('Note Alice')).toHaveValue('keep-alice');
    expect(screen.getByLabelText('Note Carol')).toHaveValue('keep-carol');
  });

  it('focuses Undo after remove and the restored row control after undo', async () => {
    const alice: Officer = { id: 'alice', name: 'Alice', details: { role: 'Director' } };
    let current = [alice];
    const onChange = vi.fn((next: Officer[]) => { current = next; });
    const editor = () => <RepeatingRecordEditor {...commonProps} items={current} onChange={onChange}
      renderItem={(item) => <input aria-label={`Edit ${item.name}`} />} />;
    const { rerender } = render(editor());
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' })); rerender(editor());
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Undo remove Alice' })).toHaveFocus());
    fireEvent.click(document.activeElement as HTMLElement); rerender(editor());
    await vi.waitFor(() => expect(screen.getByLabelText('Edit Alice')).toHaveFocus());
  });
});

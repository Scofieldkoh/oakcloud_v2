import { describe, expect, it } from 'vitest';
import { OakDocEditorSession } from '@/components/documents/oakdoc/oakdoc-editor-session';

describe('OakDoc editor session acknowledgement (C02)', () => {
  it('clears dirty only when nothing changed after the saved snapshot', () => {
    const session = new OakDocEditorSession(3);
    session.markChanged();
    const snapshot = session.snapshot();
    expect(snapshot).toMatchObject({ localRevision: 1, baseRevision: 3 });

    session.markChanged(); // typing continues while the save is in flight
    expect(session.acknowledge(snapshot, 4)).toBe('dirty');
    expect(session.dirty).toBe(true);
    expect(session.currentBaseRevision).toBe(4);

    const second = session.snapshot();
    expect(second.baseRevision).toBe(4);
    expect(session.acknowledge(second, 5)).toBe('clean');
    expect(session.dirty).toBe(false);
  });

  it('ignores a late response from a previous entity session', () => {
    const session = new OakDocEditorSession(1);
    session.markChanged();
    const oldSnapshot = session.snapshot();
    session.reset(9); // switched to item B
    session.markChanged();

    expect(session.acknowledge(oldSnapshot, 2)).toBe('stale');
    expect(session.dirty).toBe(true);
    expect(session.currentBaseRevision).toBe(9);
  });

  it('never lets an older acknowledgement regress a newer one', () => {
    const session = new OakDocEditorSession(1);
    session.markChanged();
    const first = session.snapshot();
    session.markChanged();
    const second = session.snapshot();
    expect(session.acknowledge(second, 3)).toBe('clean');
    expect(session.acknowledge(first, 2)).toBe('clean');
    expect(session.dirty).toBe(false);
  });

  it('keeps one writer identity per mounted instance across sessions', () => {
    const session = new OakDocEditorSession(0);
    const before = session.snapshot();
    session.reset(0);
    const after = session.snapshot();
    expect(after.writerInstanceId).toBe(before.writerInstanceId);
    expect(after.sessionKey).not.toBe(before.sessionKey);
  });
});

import { describe, expect, it } from 'vitest';
import {
  mergeGroup,
  moveGroup,
  moveSignerToAdjacentGroup,
  splitSignerIntoOwnGroup,
} from '@/components/esigning/prepare/step-upload-helpers';
import {
  getEnvelopeSearchMatchContext,
  isStatusDuplicatedByTab,
} from '@/components/esigning/list/esigning-list-config';
import type { EsigningEnvelopeListItem } from '@/types/esigning';

describe('mixed routing signer group edits', () => {
  const groups = [['a', 'b'], ['c'], ['d']];

  it('swaps a group with its neighbour and ignores moves past either end', () => {
    expect(moveGroup(groups, 1, -1)).toEqual([['c'], ['a', 'b'], ['d']]);
    expect(moveGroup(groups, 0, -1)).toBe(groups);
    expect(moveGroup(groups, 2, 1)).toBe(groups);
  });

  it('merges a removed group into the previous one, or the next one for the first group', () => {
    expect(mergeGroup(groups, 2)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(mergeGroup(groups, 0)).toEqual([['c', 'a', 'b'], ['d']]);
    expect(mergeGroup([['a']], 0)).toEqual([['a']]);
  });

  it('moves a signer to the adjacent group and drops groups left empty', () => {
    expect(moveSignerToAdjacentGroup(groups, 1, 'c', -1)).toEqual([['a', 'b', 'c'], ['d']]);
    expect(moveSignerToAdjacentGroup(groups, 0, 'a', 1)).toEqual([['b'], ['c', 'a'], ['d']]);
  });

  it('splits a signer into a new group right after its own, but never empties a group', () => {
    expect(splitSignerIntoOwnGroup(groups, 0, 'a')).toEqual([['b'], ['a'], ['c'], ['d']]);
    expect(splitSignerIntoOwnGroup(groups, 1, 'c')).toBe(groups);
  });

  it('never changes the groups it is given', () => {
    const snapshot = JSON.stringify(groups);
    mergeGroup(groups, 0);
    moveSignerToAdjacentGroup(groups, 0, 'a', 1);
    splitSignerIntoOwnGroup(groups, 0, 'a');
    expect(JSON.stringify(groups)).toBe(snapshot);
  });
});

describe('envelope list helpers', () => {
  const envelope = {
    title: 'Board resolution',
    companyName: 'Acme Pte. Ltd.',
    documents: [{ fileName: 'resolution.pdf', originalFileName: 'Resolution FY2026.docx' }],
    recipients: [{ name: 'Tan Wei Ming', email: 'weiming@example.com' }],
  } as unknown as EsigningEnvelopeListItem;

  it('explains which field matched the search', () => {
    expect(getEnvelopeSearchMatchContext(envelope, '')).toBeNull();
    expect(getEnvelopeSearchMatchContext(envelope, 'board')).toBe('Matched envelope: Board resolution');
    expect(getEnvelopeSearchMatchContext(envelope, 'acme')).toBe('Matched company: Acme Pte. Ltd.');
    expect(getEnvelopeSearchMatchContext(envelope, 'fy2026')).toBe('Matched document: Resolution FY2026.docx');
    expect(getEnvelopeSearchMatchContext(envelope, 'wei ming')).toBe('Matched recipient: Tan Wei Ming');
    expect(getEnvelopeSearchMatchContext(envelope, 'example.com')).toBe('Matched email: weiming@example.com');
  });

  it('treats a status filter as duplicated only when the tab holds exactly that status', () => {
    expect(isStatusDuplicatedByTab('COMPLETED', 'completed')).toBe(true);
    expect(isStatusDuplicatedByTab('SENT', 'waiting')).toBe(false);
    expect(isStatusDuplicatedByTab('SENT', 'all')).toBe(false);
  });
});

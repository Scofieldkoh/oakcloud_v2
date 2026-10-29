import { describe, expect, it } from 'vitest';
import {
  oakDocFieldBlockAction,
  oakDocFieldRanges,
} from '@/lib/document-editor/oakdoc-field-blocks';

describe('OakDoc field blocks', () => {
  const runs = [
    { start: 14, end: 30, text: '{{company.name}}' },
    { start: 0, end: 9, text: 'RESOLVED ' },
    { start: 9, end: 14, text: 'that ' },
    { start: 30, end: 35, text: ' ends' },
    // The same run painted again where the paragraph continues on a new page.
    { start: 14, end: 30, text: '{{company.name}}' },
  ];
  const ranges = oakDocFieldRanges(runs);

  it('finds field tokens in a paragraph, including ones split across runs', () => {
    expect(ranges).toEqual([{ start: 14, end: 30 }]);
    expect(oakDocFieldRanges([
      { start: 0, end: 4, text: 'A {{' },
      { start: 4, end: 11, text: 'custom.' },
      { start: 11, end: 16, text: 'fee}}' },
    ])).toEqual([{ start: 2, end: 16 }]);
  });

  it('blocks typing inside a field but not at its edges or with shortcuts', () => {
    const at = (offset: number, key = 'a', modifier = false) =>
      oakDocFieldBlockAction({ key, modifier, offset, ranges });
    expect(at(20)).toEqual({ kind: 'block' });
    expect(at(20, 'Enter')).toEqual({ kind: 'block' });
    expect(at(20, 'c', true)).toBeNull();
    expect(at(20, 'ArrowLeft')).toBeNull();
    expect(at(14)).toBeNull();
    expect(at(30)).toBeNull();
  });

  it('removes the whole field on Backspace after it or Delete before it', () => {
    const key = (name: string, offset: number) =>
      oakDocFieldBlockAction({ key: name, modifier: false, offset, ranges });
    const whole = { kind: 'remove', range: { start: 14, end: 30 } };
    expect(key('Backspace', 30)).toEqual(whole);
    expect(key('Backspace', 20)).toEqual(whole);
    expect(key('Backspace', 14)).toBeNull();
    expect(key('Delete', 14)).toEqual(whole);
    expect(key('Delete', 30)).toBeNull();
  });
});

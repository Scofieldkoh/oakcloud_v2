import { describe, expect, it } from 'vitest';
import {
  formatResponseFieldValue,
  isResponseAnswerField,
} from '@/lib/form-response-display';

describe('form response display helpers', () => {
  it('formats time plus timezone answers as readable text', () => {
    expect(
      formatResponseFieldValue(
        { type: 'SHORT_TEXT', inputType: 'time_timezone' },
        { time: '09:30', timezone: 'Asia/Singapore' }
      )
    ).toBe('09:30 Asia/Singapore');
  });

  it('does not show information blocks as response answer fields', () => {
    expect(isResponseAnswerField({ type: 'PARAGRAPH' })).toBe(false);
    expect(isResponseAnswerField({ type: 'HTML' })).toBe(false);
    expect(isResponseAnswerField({ type: 'SHORT_TEXT' })).toBe(true);
  });
});

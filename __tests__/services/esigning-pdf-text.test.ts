// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import {
  ESIGNING_PDF_SUPPORTED_RANGES,
  findUnsupportedEsigningPdfCharacters,
  getUnsupportedEsigningPdfTextMessage,
  isEsigningPdfCodePointSupported,
  normalizeEsigningPdfText,
} from '@/lib/esigning-pdf-text';
import { esigningValidationErrorResponse } from '@/lib/esigning-validation-response';
import {
  esigningRecipientInputSchema,
  saveEsigningFieldValuesSchema,
  updateEsigningRecipientSchema,
} from '@/lib/validations/esigning';

const FIELD_ID = '8f14e45f-ceea-4d6a-9f3b-1b2c3d4e5f60';

function parseFieldValue(value: string) {
  return saveEsigningFieldValuesSchema.safeParse({ values: [{ fieldDefinitionId: FIELD_ID, value }] });
}

function loadBundledCodePoints(): Set<number> {
  const codePoints = new Set<number>();
  for (const fileName of ['NotoSans-Regular-Subset.ttf', 'NotoSansSC-Regular-Subset.ttf']) {
    const bytes = readFileSync(path.join(process.cwd(), 'assets', 'fonts', 'esigning', fileName));
    for (const codePoint of fontkit.create(bytes).characterSet) codePoints.add(codePoint);
  }
  return codePoints;
}

describe('e-signing PDF text support ranges', () => {
  it('matches what the bundled font files can draw', () => {
    const fontCodePoints = loadBundledCodePoints();
    // Control, format, unassigned, surrogate, private-use and line/paragraph separator characters are never
    // accepted as text; no-break space is normalised to a plain space before it is drawn.
    const neverText = /[\p{Cc}\p{Cf}\p{Cn}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
    const expected = [...fontCodePoints]
      .filter((codePoint) => codePoint !== 0x00a0 && !neverText.test(String.fromCodePoint(codePoint)))
      .sort((a, b) => a - b);

    const toRanges = (codePoints: number[]) => {
      const ranges: string[] = [];
      for (let index = 0; index < codePoints.length; ) {
        let end = index;
        while (codePoints[end + 1] === codePoints[end] + 1) end += 1;
        const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
        ranges.push(`  [${hex(codePoints[index])}, ${hex(codePoints[end])}],`);
        index = end + 1;
      }
      return ranges.join('\n');
    };

    const actual: number[] = [];
    for (const [first, last] of ESIGNING_PDF_SUPPORTED_RANGES) {
      for (let codePoint = first; codePoint <= last; codePoint += 1) actual.push(codePoint);
    }

    // On failure the diff shows the ranges to paste into ESIGNING_PDF_SUPPORTED_RANGES.
    expect(toRanges(actual)).toBe(toRanges(expected));
    expect(expected.every((codePoint) => isEsigningPdfCodePointSupported(codePoint))).toBe(true);
  });

  it('keeps the ranges sorted and non-overlapping', () => {
    ESIGNING_PDF_SUPPORTED_RANGES.forEach(([first, last], index) => {
      expect(first).toBeLessThanOrEqual(last);
      if (index > 0) expect(first).toBeGreaterThan(ESIGNING_PDF_SUPPORTED_RANGES[index - 1][1] + 1);
    });
  });
});

describe('normalizeEsigningPdfText', () => {
  it('composes decomposed Vietnamese (NFD) into single code points', () => {
    expect(normalizeEsigningPdfText('Nguye\u0302\u0303n Va\u0306n A')).toBe('Nguyễn Văn A');
  });

  it('drops invisible paste artefacts and simplifies whitespace', () => {
    expect(normalizeEsigningPdfText('Tan\u200B Wei\u00AD\uFEFF Ming')).toBe('Tan Wei Ming');
    expect(normalizeEsigningPdfText('a\u00A0b\tc\r\nd')).toBe('a b c\nd');
  });
});

describe('findUnsupportedEsigningPdfCharacters', () => {
  it.each([
    'John Tan',
    'Tan Wei Ming 陈伟明',
    'Nguyễn Văn A',
    'INR ₹1,50,000.00',
    'José Müller-Øster, Łódź',
    'Привет Ελλάδα',
    '山田太郎 タロウ たろう',
    '“Quoted” – dash … 100% (50) 5×3 €10 £5 ¥100',
    'multi\nline',
  ])('accepts %j', (text) => {
    expect(findUnsupportedEsigningPdfCharacters(text)).toEqual([]);
  });

  it.each([
    ['an emoji', 'Happy 😀', ['😀']],
    ['Hangul', '김민수', ['김', '민', '수']],
    ['Tamil', 'தமிழ்', ['த', 'ம', 'ி', 'ழ', '்']],
    ['Arabic', 'مرحبا', ['م', 'ر', 'ح', 'ب', 'ا']],
    ['a control character', 'a\u0007b', ['\u0007']],
    ['a dingbat', 'ok ✓ done ★', ['✓', '★']],
  ])('rejects %s', (_label, text, expected) => {
    expect(findUnsupportedEsigningPdfCharacters(text)).toEqual(expected);
  });

  it('reports each unsupported character once, with a message that names it', () => {
    const message = getUnsupportedEsigningPdfTextMessage('😀😀 hi 🎉', 'The "Name" field');
    expect(message).toContain('The "Name" field contains characters that cannot be printed on the signed document');
    expect(message).toContain('"😀" (U+1F600)');
    expect(message).toContain('"🎉" (U+1F389)');
    expect(message?.match(/U\+1F600/g)).toHaveLength(1);
    expect(getUnsupportedEsigningPdfTextMessage('Tan Wei Ming 陈伟明')).toBeNull();
  });
});

describe('field value validation', () => {
  it.each([
    ['John Tan'],
    ['Tan Wei Ming 陈伟明'],
    ['Nguyễn Văn A'],
    ['Nguye\u0302\u0303n Va\u0306n A'],
    ['₹ 2,500'],
  ])('accepts %j and stores the NFC form', (value) => {
    const parsed = parseFieldValue(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.values[0].value).toBe(value.normalize('NFC'));
  });

  it('rejects unsupported characters with a clear, user-facing message', () => {
    const parsed = parseFieldValue('Smile 😀');
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(
        /^This field contains a character that cannot be printed on the signed document: "😀" \(U\+1F600\)\./
      );
      expect(parsed.error.issues[0].path).toEqual(['values', 0, 'value']);
    }
  });

  it('still treats an empty value as clearing the field', () => {
    const parsed = parseFieldValue('   ');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.values[0].value).toBeNull();
  });

  it('applies the same rule to recipient names (they prefill NAME fields)', () => {
    const base = { type: 'SIGNER', email: 'wei@example.com', accessMode: 'EMAIL_LINK' } as const;
    expect(esigningRecipientInputSchema.safeParse({ ...base, name: 'Tan Wei Ming 陈伟明' }).success).toBe(true);
    const rejected = esigningRecipientInputSchema.safeParse({ ...base, name: 'Wei 😀' });
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues[0].message).toContain('The recipient name contains a character');
    expect(updateEsigningRecipientSchema.safeParse({ name: 'Nguyễn Văn A' }).success).toBe(true);
    expect(updateEsigningRecipientSchema.safeParse({ name: '😀' }).success).toBe(false);
  });
});

describe('esigningValidationErrorResponse', () => {
  it('returns the unsupported-text message as the error so clients can show it', async () => {
    const parsed = parseFieldValue('Smile 😀');
    if (parsed.success) throw new Error('expected a validation failure');

    const response = esigningValidationErrorResponse(parsed.error);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('UNSUPPORTED_PDF_CHARACTERS');
    expect(body.error).toContain('cannot be printed on the signed document');
    expect(body.error).toContain('U+1F600');
  });

  it('keeps the generic payload error for other validation failures', async () => {
    const parsed = saveEsigningFieldValuesSchema.safeParse({ values: [{ fieldDefinitionId: 'not-a-uuid' }] });
    if (parsed.success) throw new Error('expected a validation failure');

    const response = esigningValidationErrorResponse(parsed.error);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid payload' });
  });
});

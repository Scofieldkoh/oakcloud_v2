import { describe, expect, it } from 'vitest';
import {
  getEsigningUploadAccept,
  isAllowedEsigningUploadFile,
} from '@/components/esigning/esigning-upload-files';

function file(name: string, type: string) {
  return { name, type };
}

describe('esigning-upload-files', () => {
  it('allows PDF uploads regardless of Word conversion availability', () => {
    expect(isAllowedEsigningUploadFile(file('agreement.pdf', ''), { wordUploadEnabled: false })).toBe(true);
    expect(isAllowedEsigningUploadFile(file('agreement.pdf', 'application/pdf'), { wordUploadEnabled: true })).toBe(true);
  });

  it('allows Word uploads only when conversion is available', () => {
    expect(isAllowedEsigningUploadFile(file('agreement.docx', ''), { wordUploadEnabled: false })).toBe(false);
    expect(
      isAllowedEsigningUploadFile(
        file('agreement.doc', 'application/msword'),
        { wordUploadEnabled: true }
      )
    ).toBe(true);
  });

  it('narrows the file picker accept list when Word conversion is unavailable', () => {
    expect(getEsigningUploadAccept(false)).toBe('application/pdf,.pdf');
    expect(getEsigningUploadAccept(true)).toContain('.docx');
  });
});

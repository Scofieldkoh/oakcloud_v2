import { useEffect, useState } from 'react';

export const ESIGNING_PDF_UPLOAD_ACCEPT = 'application/pdf,.pdf';
export const ESIGNING_WORD_UPLOAD_ACCEPT =
  'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.doc,.docx';

const PDF_MIME_TYPES = new Set(['application/pdf']);
const WORD_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

type UploadFileLike = Pick<File, 'name' | 'type'>;

export function getEsigningUploadAccept(wordUploadEnabled: boolean): string {
  return wordUploadEnabled ? ESIGNING_WORD_UPLOAD_ACCEPT : ESIGNING_PDF_UPLOAD_ACCEPT;
}

export function isEsigningPdfFile(file: UploadFileLike): boolean {
  return PDF_MIME_TYPES.has(file.type.toLowerCase()) || file.name.toLowerCase().endsWith('.pdf');
}

export function isEsigningWordFile(file: UploadFileLike): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    WORD_MIME_TYPES.has(file.type.toLowerCase()) ||
    lowerName.endsWith('.docx') ||
    lowerName.endsWith('.doc')
  );
}

export function isAllowedEsigningUploadFile(
  file: UploadFileLike,
  options: { wordUploadEnabled: boolean }
): boolean {
  return isEsigningPdfFile(file) || (options.wordUploadEnabled && isEsigningWordFile(file));
}

export function useEsigningWordUploadAvailability(activeTenantId?: string | null): boolean {
  const [wordUploadEnabled, setWordUploadEnabled] = useState(false);

  useEffect(() => {
    if (!activeTenantId) {
      setWordUploadEnabled(false);
      return;
    }

    let cancelled = false;
    const queryParams = new URLSearchParams({ tenantId: activeTenantId });

    fetch(`/api/esigning/document-conversion?${queryParams.toString()}`)
      .then(async (response) => {
        if (!response.ok) {
          return false;
        }

        const body = await response.json() as { wordUploadEnabled?: unknown };
        return body.wordUploadEnabled === true;
      })
      .then((enabled) => {
        if (!cancelled) {
          setWordUploadEnabled(enabled);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWordUploadEnabled(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTenantId]);

  return wordUploadEnabled;
}

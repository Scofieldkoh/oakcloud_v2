export type EsigningDocumentFilenameSource = {
  fileName: string;
  originalFileName?: string | null;
};

/** Returns the exact name supplied by the user, with a legacy fallback. */
export function getEsigningDocumentOriginalFileName(
  document: EsigningDocumentFilenameSource,
): string {
  return document.originalFileName && document.originalFileName.length > 0
    ? document.originalFileName
    : document.fileName;
}

/** Returns a PDF-safe name for a PDF stream while retaining the original base name. */
export function getEsigningDocumentPdfFileName(
  document: EsigningDocumentFilenameSource,
): string {
  const originalFileName = getEsigningDocumentOriginalFileName(document);
  const baseName = originalFileName.replace(/\.[^./\\]+$/u, '');
  return `${baseName || 'document'}.pdf`;
}

export function getEsigningDocumentVariantFileName(
  document: EsigningDocumentFilenameSource,
  variant: 'signed' | 'certificate',
): string {
  return getEsigningDocumentPdfFileName(document).replace(
    /\.pdf$/iu,
    `-${variant}.pdf`,
  );
}

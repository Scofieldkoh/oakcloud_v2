// Extracts the text of every page of a PDF with pdf.js, the way a viewer would. Used to prove that
// text drawn with an embedded font really maps back to the characters that were typed.
export async function extractPdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join('')
      );
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

/**
 * The TrueType font programs embedded in a PDF (the `FontFile2` streams), decoded. Text extraction
 * only proves the ToUnicode map; these let a test check the glyph outlines a viewer would draw.
 */
export async function extractEmbeddedFontPrograms(bytes: Uint8Array): Promise<Uint8Array[]> {
  const { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  const programs: Uint8Array[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const fontFile = object.get(PDFName.of('FontFile2'));
    const stream = fontFile ? pdf.context.lookup(fontFile) : undefined;
    if (stream instanceof PDFRawStream) {
      programs.push(decodePDFRawStream(stream).decode());
    }
  }
  return programs;
}

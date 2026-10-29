export function generatedDocumentPdfFileName(
  title: string,
  date: Date = new Date(),
): string {
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const dateStamp = date.toISOString().split('T')[0];
  return `${safeTitle}-${dateStamp}.pdf`;
}

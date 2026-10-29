import { PDFDocument, type PDFPage, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { buildEsigningVerificationUrl } from '@/lib/esigning-session';
import { ESIGNING_RECIPIENT_COLORS } from '@/lib/validations/esigning';
import { generateCertificateQrMatrix } from '@/lib/qr-matrix';
import { buildEsigningEventLabel, summarizeEsigningUserAgent } from '@/services/esigning-evidence';

const MM = 72 / 25.4;
const mm = (value: number) => value * MM;
const PW = mm(210);
const PH = mm(297);
const STRUCT_RAIL = mm(9);
const TEXT_RAIL = mm(12);
const STRUCT_WIDTH = PW - STRUCT_RAIL * 2;
const TEXT_WIDTH = PW - TEXT_RAIL * 2;
const HEADER_H = mm(36);
const SUMMARY_H = mm(21);
const CONTENT_BOTTOM = mm(286);

const C = {
  green: rgb(19 / 255, 129 / 255, 104 / 255),
  navy: rgb(24 / 255, 34 / 255, 53 / 255),
  secondary: rgb(102 / 255, 114 / 255, 138 / 255),
  muted: rgb(138 / 255, 148 / 255, 166 / 255),
  rule: rgb(221 / 255, 226 / 255, 232 / 255),
  ruleStrong: rgb(184 / 255, 194 / 255, 207 / 255),
  rowAlt: rgb(247 / 255, 248 / 255, 249 / 255),
  recipientBg: rgb(244 / 255, 248 / 255, 247 / 255),
  timeline: rgb(196 / 255, 205 / 255, 217 / 255),
  white: rgb(1, 1, 1),
  black: rgb(0, 0, 0),
};

type Recipient = {
  id: string;
  name: string;
  email?: string | null;
  type?: string | null;
  status: string;
  colorTag?: string | null;
  viewedAt?: Date | null;
  consentedAt?: Date | null;
  signedAt?: Date | null;
  consentIp?: string | null;
  consentUserAgent?: string | null;
  signedIp?: string | null;
  signedUserAgent?: string | null;
};

type AuditEvent = {
  action: string;
  recipientId?: string | null;
  createdAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
};

type EnvelopeDocument = {
  fileName: string;
  originalFileName?: string | null;
  generatedDocumentId?: string | null;
};

export type CertificatePdfRenderInput = {
  envelope: {
    title: string;
    status: string;
    certificateId: string;
    completedAt?: Date | null;
    company?: { name: string } | null;
    tenant?: { name: string } | null;
    recipients: Recipient[];
    events: AuditEvent[];
    documents: EnvelopeDocument[];
  };
  document?: unknown;
};

type RichSpan = { text: string; font: PDFFont; color: ReturnType<typeof rgb> };
type RichToken = RichSpan & { width: number };
type SectionKind = 'recipient' | 'history' | 'document' | 'verification';
type RecipientActivityAction = 'VIEWED' | 'CONSENTED' | 'SIGNED';

function safe(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u2022]/g, '?');
}

function widthOf(text: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(safe(text), size);
}

function yFromTop(top: number): number {
  return PH - top;
}

function rectY(top: number, height: number): number {
  return PH - top - height;
}

function textTopY(top: number, font: PDFFont, size: number): number {
  return PH - top - font.heightAtSize(size);
}

function centeredY(top: number, height: number, font: PDFFont, size: number): number {
  return rectY(top, height) + (height - font.heightAtSize(size)) / 2 + 0.7;
}

function drawTextTop(page: PDFPage, text: string, x: number, top: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>): void {
  page.drawText(safe(text), { x, y: textTopY(top, font, size), size, font, color });
}

function drawRightTop(page: PDFPage, text: string, right: number, top: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>): void {
  const value = safe(text);
  drawTextTop(page, value, right - widthOf(value, font, size), top, size, font, color);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const value = safe(text).trim();
  if (!value) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of value.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (widthOf(candidate, font, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    let remaining = word;
    while (remaining && widthOf(remaining, font, size) > maxWidth) {
      let cut = 1;
      while (cut < remaining.length && widthOf(remaining.slice(0, cut + 1), font, size) <= maxWidth) cut += 1;
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    current = remaining;
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrapped(page: PDFPage, lines: string[], x: number, top: number, size: number, lineHeight: number, font: PDFFont, color: ReturnType<typeof rgb>): void {
  lines.forEach((line, index) => drawTextTop(page, line, x, top + index * lineHeight, size, font, color));
}

function wrapRich(spans: RichSpan[], size: number, maxWidth: number): RichToken[][] {
  const lines: RichToken[][] = [[]];
  let lineWidth = 0;
  for (const span of spans) {
    for (const part of safe(span.text).split(/(\s+)/).filter(Boolean)) {
      const text = /^\s+$/.test(part) ? ' ' : part;
      const isSpace = text === ' ';
      const tokenWidth = widthOf(text, span.font, size);
      let line = lines[lines.length - 1];
      if (isSpace && line.length === 0) continue;
      if (!isSpace && line.length > 0 && lineWidth + tokenWidth > maxWidth) {
        lines.push([]);
        lineWidth = 0;
        line = lines[lines.length - 1];
      }
      if (tokenWidth <= maxWidth) {
        if (!(isSpace && line.length === 0)) {
          line.push({ ...span, text, width: tokenWidth });
          lineWidth += tokenWidth;
        }
        continue;
      }
      let remaining = text;
      while (remaining) {
        let cut = 1;
        while (cut < remaining.length && widthOf(remaining.slice(0, cut + 1), span.font, size) <= maxWidth) cut += 1;
        if (lines[lines.length - 1].length) lines.push([]);
        const piece = remaining.slice(0, cut);
        const pieceWidth = widthOf(piece, span.font, size);
        lines[lines.length - 1].push({ ...span, text: piece, width: pieceWidth });
        lineWidth = pieceWidth;
        remaining = remaining.slice(cut);
        if (remaining) {
          lines.push([]);
          lineWidth = 0;
        }
      }
    }
  }
  return lines.filter((line) => line.length);
}

function drawRich(page: PDFPage, lines: RichToken[][], x: number, top: number, size: number, lineHeight: number): void {
  lines.forEach((line, lineIndex) => {
    let cursorX = x;
    line.forEach((token) => {
      drawTextTop(page, token.text, cursorX, top + lineIndex * lineHeight, size, token.font, token.color);
      cursorX += token.width;
    });
  });
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

function metadataString(metadata: unknown, key: string): string | null {
  const raw = metadataRecord(metadata)[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

const SGT_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Singapore',
});

function formatDate(date: Date): string {
  const parts = SGT_FORMATTER.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${Number(part('day'))} ${part('month').slice(0, 3)} ${part('year')}, ${part('hour')}:${part('minute')}`;
}

function summarizeEvidence(ip: string | null | undefined, userAgent: string | null | undefined): { ip: string; device: string } {
  return { ip: ip || '-', device: summarizeEsigningUserAgent(userAgent) || '-' };
}

function pdfColorFromHex(value: string | null | undefined, fallback: ReturnType<typeof rgb>): ReturnType<typeof rgb> {
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  );
}

export function getLatestCertificateRecipientActivity(
  events: AuditEvent[],
  recipientId: string,
  action: RecipientActivityAction,
): AuditEvent | null {
  let latest: AuditEvent | null = null;
  for (const event of events) {
    if (event.recipientId !== recipientId || event.action !== action) continue;
    if (!latest || event.createdAt.getTime() > latest.createdAt.getTime()) {
      latest = event;
    }
  }
  return latest;
}

export function formatCertificatePageNumber(pageIndex: number, totalPages: number): string {
  return `${pageIndex + 1} / ${totalPages}`;
}

function eventEvidence(event: AuditEvent | null): { ip: string | null; device: string | null } {
  if (!event) return { ip: null, device: null };
  const ip = event.ipAddress ?? metadataString(event.metadata, 'ipAddress');
  const userAgent = event.userAgent ?? metadataString(event.metadata, 'userAgent');
  const device = metadataString(event.metadata, 'device') ?? summarizeEsigningUserAgent(userAgent) ?? null;
  return { ip, device };
}

function drawSectionIcon(page: PDFPage, kind: SectionKind, x: number, top: number): void {
  const s = mm(6.25);
  const left = x;
  const bottom = rectY(top, s);
  const cx = left + s / 2;
  const cy = bottom + s / 2;
  const stroke = 1.15;
  if (kind === 'recipient') {
    page.drawCircle({ x: left + s * 0.35, y: bottom + s * 0.7, size: s * 0.14, borderColor: C.navy, borderWidth: stroke });
    page.drawLine({ start: { x: left + s * 0.13, y: bottom + s * 0.28 }, end: { x: left + s * 0.13, y: bottom + s * 0.4 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: left + s * 0.13, y: bottom + s * 0.4 }, end: { x: left + s * 0.28, y: bottom + s * 0.48 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: left + s * 0.28, y: bottom + s * 0.48 }, end: { x: left + s * 0.5, y: bottom + s * 0.48 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: left + s * 0.58, y: bottom + s * 0.29 }, end: { x: left + s * 0.7, y: bottom + s * 0.17 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: left + s * 0.7, y: bottom + s * 0.17 }, end: { x: left + s * 0.92, y: bottom + s * 0.43 }, color: C.navy, thickness: stroke });
    return;
  }
  if (kind === 'history') {
    page.drawCircle({ x: cx, y: cy, size: s * 0.34, borderColor: C.navy, borderWidth: stroke });
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx, y: cy + s * 0.2 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx - s * 0.16, y: cy + s * 0.06 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: left + s * 0.04, y: cy + s * 0.12 }, end: { x: left + s * 0.16, y: cy + s * 0.27 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: left + s * 0.04, y: cy + s * 0.12 }, end: { x: left + s * 0.2, y: cy + s * 0.1 }, color: C.navy, thickness: stroke });
    return;
  }
  if (kind === 'document') {
    const x1 = left + s * 0.2;
    const x2 = left + s * 0.8;
    const y1 = bottom + s * 0.12;
    const y2 = bottom + s * 0.88;
    const fold = s * 0.22;
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x1, y: y2 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x1, y: y2 }, end: { x: x2 - fold, y: y2 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x2 - fold, y: y2 }, end: { x: x2, y: y2 - fold }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x2, y: y2 - fold }, end: { x: x2, y: y1 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x2, y: y1 }, end: { x: x1, y: y1 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x2 - fold, y: y2 }, end: { x: x2 - fold, y: y2 - fold }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x2 - fold, y: y2 - fold }, end: { x: x2, y: y2 - fold }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x1 + s * 0.12, y: bottom + s * 0.48 }, end: { x: x2 - s * 0.12, y: bottom + s * 0.48 }, color: C.navy, thickness: stroke });
    page.drawLine({ start: { x: x1 + s * 0.12, y: bottom + s * 0.32 }, end: { x: x2 - s * 0.12, y: bottom + s * 0.32 }, color: C.navy, thickness: stroke });
    return;
  }
  const points = [
    [cx, bottom + s * 0.92], [left + s * 0.2, bottom + s * 0.78], [left + s * 0.2, bottom + s * 0.45],
    [cx, bottom + s * 0.08], [left + s * 0.8, bottom + s * 0.45], [left + s * 0.8, bottom + s * 0.78], [cx, bottom + s * 0.92],
  ];
  for (let i = 0; i < points.length - 1; i += 1) page.drawLine({ start: { x: points[i][0], y: points[i][1] }, end: { x: points[i + 1][0], y: points[i + 1][1] }, color: C.navy, thickness: stroke });
  page.drawLine({ start: { x: left + s * 0.35, y: bottom + s * 0.5 }, end: { x: left + s * 0.47, y: bottom + s * 0.38 }, color: C.navy, thickness: stroke });
  page.drawLine({ start: { x: left + s * 0.47, y: bottom + s * 0.38 }, end: { x: left + s * 0.7, y: bottom + s * 0.64 }, color: C.navy, thickness: stroke });
}

function drawSectionHeading(page: PDFPage, kind: SectionKind, title: string, top: number, semibold: PDFFont): number {
  const h = mm(6.25);
  drawSectionIcon(page, kind, STRUCT_RAIL, top);
  page.drawText(title.toUpperCase(), { x: STRUCT_RAIL + h + mm(3), y: centeredY(top, h, semibold, 10.75), size: 10.75, font: semibold, color: C.navy });
  return h;
}

function drawQr(page: PDFPage, url: string, x: number, top: number, size: number): void {
  const matrix = generateCertificateQrMatrix(url);
  const quiet = 4;
  const moduleSize = size / (matrix.size + quiet * 2);
  const bottom = rectY(top, size);
  page.drawRectangle({ x, y: bottom, width: size, height: size, color: C.white });
  matrix.modules.forEach((row, rowIndex) => row.forEach((dark, colIndex) => {
    if (!dark) return;
    page.drawRectangle({
      x: x + (colIndex + quiet) * moduleSize,
      y: bottom + (matrix.size - 1 - rowIndex + quiet) * moduleSize,
      width: moduleSize + 0.02,
      height: moduleSize + 0.02,
      color: C.black,
    });
  }));
}

function auditDetails(event: AuditEvent, recipient: Recipient | undefined, recipientCount: number): string {
  const metadata = metadataRecord(event.metadata);
  if (event.action === 'CREATED') return 'Envelope created';
  if (event.action === 'SENT') {
    const activeIds = Array.isArray(metadata.activeRecipientIds) ? metadata.activeRecipientIds : [];
    const count = activeIds.length || recipientCount;
    return `Invitation email sent to ${count} recipient${count === 1 ? '' : 's'}`;
  }
  if (event.action === 'VIEWED') {
    const evidence = eventEvidence(event);
    const parts = [evidence.ip ? `IP ${evidence.ip}` : null, evidence.device].filter(Boolean);
    return parts.length ? parts.join('  •  ') : '-';
  }
  if (event.action === 'CONSENTED' && recipient) {
    const evidence = summarizeEvidence(recipient.consentIp, recipient.consentUserAgent);
    return evidence.ip === '-' && evidence.device === '-' ? '-' : `IP ${evidence.ip}  •  ${evidence.device}`;
  }
  if (event.action === 'SIGNED' && recipient) {
    const evidence = summarizeEvidence(recipient.signedIp, recipient.signedUserAgent);
    return evidence.ip === '-' && evidence.device === '-' ? '-' : `IP ${evidence.ip}  •  ${evidence.device}`;
  }
  if (event.action === 'COMPLETED') return 'Envelope successfully completed';
  if (event.action === 'REMINDER_SENT') return 'Signing reminder sent';
  if (event.action === 'CORRECTED') return 'Recipient details corrected';
  if (event.action === 'DECLINED') return metadataString(event.metadata, 'reason') ?? 'Recipient declined to sign';
  if (event.action === 'VOIDED') return metadataString(event.metadata, 'reason') ?? 'Envelope voided';
  if (event.action === 'EXPIRED') return 'Envelope expired';
  if (event.action === 'PDF_GENERATION_FAILED') return metadataString(event.metadata, 'message') ?? 'Signed PDF generation failed';
  return '-';
}

export async function renderEsigningCertificatePdf(input: CertificatePdfRenderInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const medium = regular;
  const semibold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let cursorTop = 0;

  const envelope = input.envelope;
  const certificateId = envelope.certificateId;
  const verificationUrl = buildEsigningVerificationUrl(certificateId);
  const visibleVerificationUrl = verificationUrl.replace(/^https?:\/\//i, '');
  const recipients = envelope.recipients;
  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  const recipientColorById = new Map(
    recipients.map((recipient, index) => {
      const fallbackColor = ESIGNING_RECIPIENT_COLORS[index % ESIGNING_RECIPIENT_COLORS.length];
      return [recipient.id, pdfColorFromHex(recipient.colorTag ?? fallbackColor, C.green)] as const;
    }),
  );
  const events = [...envelope.events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const documents = envelope.documents ?? [];
  const signers = recipients.filter((recipient) => recipient.type !== 'CC');
  const signerTotal = signers.length || recipients.length;
  const signedCount = signers.filter((recipient) => recipient.signedAt).length;

  const startPage = (firstPage: boolean): void => {
    page = pdf.addPage([PW, PH]);
    pages.push(page);
    if (firstPage) {
      page.drawRectangle({ x: 0, y: PH - HEADER_H, width: PW, height: HEADER_H, color: C.green });
      drawTextTop(page, 'CERTIFICATE OF COMPLETION', TEXT_RAIL, mm(10.8), 22.5, semibold, C.white);
      const idW = mm(44);
      const idH = mm(7);
      const idX = PW - TEXT_RAIL - idW;
      drawRightTop(page, 'CERTIFICATE ID', PW - TEXT_RAIL, mm(16), 6.75, medium, C.white);
      page.drawRectangle({ x: idX, y: rectY(mm(21), idH), width: idW, height: idH, borderColor: C.white, borderWidth: 0.5, borderOpacity: 0.8 });
      const idSize = 8.75;
      const idWidth = widthOf(certificateId, regular, idSize);
      page.drawText(safe(certificateId), { x: idX + Math.max(mm(2.5), (idW - idWidth) / 2), y: centeredY(mm(21), idH, regular, idSize), size: idSize, font: regular, color: C.white });
      const companyName = envelope.company?.name ?? envelope.tenant?.name ?? '';
      if (companyName) {
        const companyLines = wrapText(companyName, regular, 12, idX - TEXT_RAIL - mm(5));
        drawWrapped(page, companyLines.slice(0, 2), TEXT_RAIL, mm(22), 12, 13.5, regular, C.white);
      }

      const summaryTop = HEADER_H;
      const summaryBottom = HEADER_H + SUMMARY_H;
      page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(summaryBottom) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(summaryBottom) }, color: C.ruleStrong, thickness: 0.65 });
      const proportions = [0.24, 0.28, 0.27, 0.21];
      const fields = [
        ['STATUS', envelope.status.replace(/_/g, ' '), envelope.status === 'COMPLETED' ? C.green : C.navy, envelope.status === 'COMPLETED' ? semibold : medium] as const,
        ['COMPLETED (SGT)', envelope.completedAt ? formatDate(envelope.completedAt) : '-', C.navy, regular] as const,
        ['RECIPIENTS SIGNED', `${signedCount} of ${signerTotal}`, C.navy, regular] as const,
        ['AUDIT EVENTS', String(events.length), C.navy, regular] as const,
      ];
      let x = TEXT_RAIL;
      fields.forEach(([label, value, color, font], index) => {
        const cellW = TEXT_WIDTH * proportions[index];
        drawTextTop(page, label, x, summaryTop + mm(6.1), 6.75, medium, C.secondary);
        drawTextTop(page, value, x, summaryTop + mm(11.6), 10.25, font, color);
        x += cellW;
        if (index < fields.length - 1) {
          const sepX = x - mm(3);
          page.drawLine({ start: { x: sepX, y: yFromTop(summaryTop + mm(15.5)) }, end: { x: sepX, y: yFromTop(summaryTop + mm(5.5)) }, color: C.rule, thickness: 0.5 });
        }
      });
      cursorTop = summaryBottom + mm(6.5);
      return;
    }

    page.drawRectangle({ x: 0, y: PH - 2, width: PW, height: 2, color: C.green });
    drawTextTop(page, 'CERTIFICATE OF COMPLETION', STRUCT_RAIL, mm(7), 7.5, medium, C.secondary);
    drawRightTop(page, certificateId, PW - STRUCT_RAIL, mm(7), 7.5, regular, C.secondary);
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(mm(15)) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(mm(15)) }, color: C.rule, thickness: 0.5 });
    cursorTop = mm(20.5);
  };

  const ensureSpace = (height: number): boolean => {
    if (cursorTop + height <= CONTENT_BOTTOM) return false;
    startPage(false);
    return true;
  };

  startPage(true);
  cursorTop += drawSectionHeading(page, 'recipient', 'Recipient Evidence', cursorTop, semibold) + mm(3.25);

  const drawRecipient = (recipient: Recipient, recipientIndex: number): void => {
    const innerX = STRUCT_RAIL + mm(3.2);
    const innerRight = PW - STRUCT_RAIL - mm(3.5);
    const seqW = mm(10);
    const identityUsable = innerRight - innerX - seqW - mm(2);
    const recipientColor = recipientColorById.get(recipient.id) ?? C.green;
    const identitySpans: RichSpan[] = [
      { text: recipient.name, font: semibold, color: recipientColor },
      ...(recipient.email
        ? [{ text: ` (${recipient.email})`, font: regular, color: C.secondary } satisfies RichSpan]
        : []),
    ];
    const identityLines = wrapRich(identitySpans, 9.25, identityUsable);
    const identityH = Math.max(mm(10.5), identityLines.length * 10 + mm(4.5));
    const headingH = mm(8.25);

    const viewedEvent = getLatestCertificateRecipientActivity(events, recipient.id, 'VIEWED');
    const consentedEvent = getLatestCertificateRecipientActivity(events, recipient.id, 'CONSENTED');
    const signedEvent = getLatestCertificateRecipientActivity(events, recipient.id, 'SIGNED');
    const viewedEvidence = eventEvidence(viewedEvent);
    const consentedEvidence = eventEvidence(consentedEvent);
    const signedEvidence = eventEvidence(signedEvent);
    const consentFallback = summarizeEvidence(recipient.consentIp, recipient.consentUserAgent);
    const signedFallback = summarizeEvidence(recipient.signedIp, recipient.signedUserAgent);
    const viewedAt = viewedEvent?.createdAt ?? recipient.viewedAt ?? null;
    const consentedAt = consentedEvent?.createdAt ?? recipient.consentedAt ?? null;
    const signedAt = signedEvent?.createdAt ?? recipient.signedAt ?? null;

    const rows = [
      {
        event: 'Viewed',
        date: viewedAt ? formatDate(viewedAt) : '-',
        ip: viewedAt ? viewedEvidence.ip || '-' : '-',
        device: viewedAt ? viewedEvidence.device || '-' : '-',
        active: Boolean(viewedAt),
      },
      {
        event: 'Consented',
        date: consentedAt ? formatDate(consentedAt) : '-',
        ip: consentedAt ? consentedEvidence.ip || consentFallback.ip : '-',
        device: consentedAt ? consentedEvidence.device || consentFallback.device : '-',
        active: Boolean(consentedAt),
      },
      {
        event: 'Signed',
        date: signedAt ? formatDate(signedAt) : '-',
        ip: signedAt ? signedEvidence.ip || signedFallback.ip : '-',
        device: signedAt ? signedEvidence.device || signedFallback.device : '-',
        active: Boolean(signedAt),
      },
    ];
    const col = [STRUCT_WIDTH * 0.27, STRUCT_WIDTH * 0.25, STRUCT_WIDTH * 0.23, STRUCT_WIDTH * 0.25];
    const cellInset = mm(3);
    const eventInset = mm(7.8);
    const layouts = rows.map((row) => {
      const eventLines = wrapText(row.event, regular, 8.4, col[0] - eventInset - mm(2));
      const dateLines = wrapText(row.date, regular, 8.1, col[1] - cellInset * 2);
      const ipLines = wrapText(row.ip, regular, 8.1, col[2] - cellInset * 2);
      const deviceLines = wrapText(row.device, regular, 8.1, col[3] - cellInset * 2);
      const lineCount = Math.max(1, eventLines.length, dateLines.length, ipLines.length, deviceLines.length);
      return { ...row, eventLines, dateLines, ipLines, deviceLines, height: Math.max(mm(9.25), lineCount * 9.2 + mm(4)) };
    });
    const blockH = identityH + headingH + layouts.reduce((sum, row) => sum + row.height, 0);
    if (ensureSpace(blockH)) cursorTop += drawSectionHeading(page, 'recipient', 'Recipient Evidence', cursorTop, semibold) + mm(3.25);

    page.drawRectangle({ x: STRUCT_RAIL, y: rectY(cursorTop, identityH), width: STRUCT_WIDTH, height: identityH, color: C.recipientBg });
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop) }, color: C.rule, thickness: 0.35 });
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop + identityH) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop + identityH) }, color: C.rule, thickness: 0.35 });
    drawRich(page, identityLines, innerX, cursorTop + (identityH - identityLines.length * 10) / 2, 9.25, 10);
    const sequence = `#${recipientIndex + 1}`;
    page.drawText(sequence, { x: innerRight - widthOf(sequence, regular, 8.25), y: centeredY(cursorTop, identityH, regular, 8.25), size: 8.25, font: regular, color: C.secondary });
    cursorTop += identityH;

    const headings = ['EVENT', 'DATE & TIME (SGT)', 'IP ADDRESS', 'DEVICE'];
    let hx = STRUCT_RAIL;
    headings.forEach((heading, index) => {
      const contentX = hx + (index === 0 ? eventInset : cellInset);
      page.drawText(heading, { x: contentX, y: centeredY(cursorTop, headingH, medium, 6.75), size: 6.75, font: medium, color: C.secondary });
      hx += col[index];
    });
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop + headingH) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop + headingH) }, color: C.rule, thickness: 0.45 });
    cursorTop += headingH;

    layouts.forEach((row, index) => {
      if (index % 2 === 1) page.drawRectangle({ x: STRUCT_RAIL, y: rectY(cursorTop, row.height), width: STRUCT_WIDTH, height: row.height, color: C.rowAlt });
      const centerY = rectY(cursorTop, row.height) + row.height / 2;
      const dotR = mm(1.3);
      if (row.active) page.drawCircle({ x: STRUCT_RAIL + mm(5), y: centerY, size: dotR, color: C.green });
      else page.drawCircle({ x: STRUCT_RAIL + mm(5), y: centerY, size: dotR, borderColor: C.muted, borderWidth: 0.6 });
      drawWrapped(page, row.eventLines, STRUCT_RAIL + eventInset, cursorTop + (row.height - row.eventLines.length * 9.2) / 2, 8.4, 9.2, regular, C.navy);
      drawWrapped(page, row.dateLines, STRUCT_RAIL + col[0] + cellInset, cursorTop + (row.height - row.dateLines.length * 9.2) / 2, 8.1, 9.2, regular, C.secondary);
      drawWrapped(page, row.ipLines, STRUCT_RAIL + col[0] + col[1] + cellInset, cursorTop + (row.height - row.ipLines.length * 9.2) / 2, 8.1, 9.2, regular, C.secondary);
      drawWrapped(page, row.deviceLines, STRUCT_RAIL + col[0] + col[1] + col[2] + cellInset, cursorTop + (row.height - row.deviceLines.length * 9.2) / 2, 8.1, 9.2, regular, C.secondary);
      page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop + row.height) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop + row.height) }, color: C.rule, thickness: 0.38 });
      cursorTop += row.height;
    });
  };

  recipients.forEach((recipient, index) => {
    if (index > 0) cursorTop += mm(6);
    drawRecipient(recipient, index);
  });

  cursorTop += mm(12);
  ensureSpace(mm(19));
  cursorTop += drawSectionHeading(page, 'history', 'Audit Trail', cursorTop, semibold) + mm(3.5);

  const auditCol = [STRUCT_WIDTH * 0.07, STRUCT_WIDTH * 0.4, STRUCT_WIDTH * 0.34, STRUCT_WIDTH * 0.19];
  const numberX = STRUCT_RAIL;
  const timelineX = STRUCT_RAIL + auditCol[0] * 0.72;
  const eventX = STRUCT_RAIL + auditCol[0] + mm(2.5);
  const detailsX = STRUCT_RAIL + auditCol[0] + auditCol[1] + mm(2.5);
  const dateRight = PW - STRUCT_RAIL - mm(2.5);
  const auditHeaderH = mm(8.5);
  const drawAuditHeader = (): void => {
    drawTextTop(page, '#', numberX + mm(2), cursorTop + mm(2.2), 6.75, medium, C.secondary);
    drawTextTop(page, 'EVENT', eventX, cursorTop + mm(2.2), 6.75, medium, C.secondary);
    drawTextTop(page, 'DETAILS', detailsX, cursorTop + mm(2.2), 6.75, medium, C.secondary);
    drawRightTop(page, 'DATE & TIME (SGT)', dateRight, cursorTop + mm(2.2), 6.75, medium, C.secondary);
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop + auditHeaderH) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop + auditHeaderH) }, color: C.rule, thickness: 0.5 });
    cursorTop += auditHeaderH;
  };
  drawAuditHeader();
  let previousTimelineY: number | null = null;
  let previousTimelinePage = page;

  events.forEach((event, eventIndex) => {
    const recipient = event.recipientId ? recipientById.get(event.recipientId) : undefined;
    const label = safe(buildEsigningEventLabel({ action: event.action, recipientName: recipient?.name ?? null }));
    const recipientName = safe(recipient?.name ?? '');
    const nameIndex = recipientName ? label.lastIndexOf(recipientName) : -1;
    const spans: RichSpan[] = recipientName && nameIndex >= 0 ? [
      { text: label.slice(0, nameIndex), font: regular, color: C.navy },
      { text: recipientName, font: medium, color: recipient ? recipientColorById.get(recipient.id) ?? C.green : C.green },
      { text: label.slice(nameIndex + recipientName.length), font: regular, color: C.navy },
    ] : [{ text: label, font: regular, color: C.navy }];
    const eventLines = wrapRich(spans, 8.15, auditCol[1] - mm(5));
    const detailLines = wrapText(auditDetails(event, recipient, recipients.length), regular, 8, auditCol[2] - mm(5));
    const lineCount = Math.max(1, eventLines.length, detailLines.length);
    const rowH = Math.max(mm(9.25), lineCount * 9.4 + mm(4));

    if (cursorTop + rowH > CONTENT_BOTTOM) {
      startPage(false);
      drawAuditHeader();
      previousTimelineY = null;
      previousTimelinePage = page;
    }
    if (eventIndex % 2 === 1) page.drawRectangle({ x: STRUCT_RAIL, y: rectY(cursorTop, rowH), width: STRUCT_WIDTH, height: rowH, color: C.rowAlt });
    const centerY = rectY(cursorTop, rowH) + rowH / 2;
    if (previousTimelineY !== null && previousTimelinePage === page) page.drawLine({ start: { x: timelineX, y: previousTimelineY }, end: { x: timelineX, y: centerY }, color: C.timeline, thickness: 0.5 });
    page.drawCircle({ x: timelineX, y: centerY, size: mm(1.05), color: C.timeline });
    previousTimelineY = centerY;
    previousTimelinePage = page;
    page.drawText(String(eventIndex + 1), { x: numberX + mm(2), y: centeredY(cursorTop, rowH, regular, 8), size: 8, font: regular, color: C.navy });
    drawRich(page, eventLines, eventX, cursorTop + (rowH - eventLines.length * 9.4) / 2, 8.15, 9.4);
    drawWrapped(page, detailLines, detailsX, cursorTop + (rowH - detailLines.length * 9.4) / 2, 8, 9.4, regular, C.secondary);
    const timestamp = formatDate(event.createdAt);
    page.drawText(timestamp, { x: dateRight - widthOf(timestamp, regular, 8), y: centeredY(cursorTop, rowH, regular, 8), size: 8, font: regular, color: C.secondary });
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop + rowH) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop + rowH) }, color: C.rule, thickness: 0.35 });
    cursorTop += rowH;
  });

  cursorTop += mm(12);
  ensureSpace(mm(19));
  cursorTop += drawSectionHeading(page, 'document', 'Document List', cursorTop, semibold) + mm(3.5);

  const documentInset = mm(3);
  const documentHeaderH = mm(8.5);
  const drawDocumentHeader = (): void => {
    drawTextTop(page, 'FILE NAME', STRUCT_RAIL + documentInset, cursorTop + mm(2.2), 6.75, medium, C.secondary);
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop + documentHeaderH) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop + documentHeaderH) }, color: C.rule, thickness: 0.5 });
    cursorTop += documentHeaderH;
  };
  drawDocumentHeader();

  documents.forEach((document, index) => {
    const fileName = document.originalFileName?.trim() || document.fileName;
    const fileLines = wrapText(fileName, regular, 8.25, STRUCT_WIDTH - documentInset * 2);
    const rowH = Math.max(mm(9.25), Math.max(1, fileLines.length) * 9.4 + mm(4));

    if (cursorTop + rowH > CONTENT_BOTTOM) {
      startPage(false);
      cursorTop += drawSectionHeading(page, 'document', 'Document List', cursorTop, semibold) + mm(3.5);
      drawDocumentHeader();
    }
    if (index % 2 === 1) page.drawRectangle({ x: STRUCT_RAIL, y: rectY(cursorTop, rowH), width: STRUCT_WIDTH, height: rowH, color: C.rowAlt });
    drawWrapped(page, fileLines, STRUCT_RAIL + documentInset, cursorTop + (rowH - fileLines.length * 9.4) / 2, 8.25, 9.4, regular, C.navy);
    page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(cursorTop + rowH) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(cursorTop + rowH) }, color: C.rule, thickness: 0.35 });
    cursorTop += rowH;
  });

  const qrSize = mm(18);
  let dividerTop = pages.length === 1 && cursorTop <= mm(240) ? mm(249) : cursorTop + mm(9);
  if (dividerTop + mm(31) > PH - mm(8)) {
    startPage(false);
    dividerTop = cursorTop + mm(9);
  }
  page.drawLine({ start: { x: STRUCT_RAIL, y: yFromTop(dividerTop) }, end: { x: PW - STRUCT_RAIL, y: yFromTop(dividerTop) }, color: C.ruleStrong, thickness: 0.6 });
  const verificationTop = dividerTop + mm(6.5);
  drawSectionHeading(page, 'verification', 'Verification', verificationTop, semibold);
  const copyTop = verificationTop + mm(9.4);
  drawTextTop(page, 'This certificate is the tamper-evident audit record of the signing process.', STRUCT_RAIL, copyTop, 8.15, regular, C.secondary);
  drawTextTop(page, visibleVerificationUrl, STRUCT_RAIL, copyTop + mm(5.4), 8.4, medium, C.green);
  const qrX = PW - STRUCT_RAIL - qrSize;
  drawQr(page, verificationUrl, qrX, verificationTop - mm(0.5), qrSize);
  const qrLabel = 'SCAN TO VERIFY';
  const qrLabelSize = 5.75;
  drawTextTop(page, qrLabel, qrX + (qrSize - widthOf(qrLabel, medium, qrLabelSize)) / 2, verificationTop + qrSize + mm(1.6), qrLabelSize, medium, C.secondary);

  const totalPages = pages.length;
  pages.forEach((certificatePage, pageIndex) => {
    const pageNumber = formatCertificatePageNumber(pageIndex, totalPages);
    const pageNumberSize = 6.25;
    certificatePage.drawText(pageNumber, {
      x: (PW - widthOf(pageNumber, regular, pageNumberSize)) / 2,
      y: mm(4),
      size: pageNumberSize,
      font: regular,
      color: C.muted,
    });
  });

  pdf.setTitle(safe(`Certificate of Completion - ${envelope.title}`));
  pdf.setSubject(safe(`Signing audit record for certificate ${certificateId}`));
  pdf.setCreator('OakCloud e-Sign');
  pdf.setCreationDate(envelope.completedAt ?? new Date());
  pdf.setModificationDate(envelope.completedAt ?? new Date());
  if (envelope.company?.name) pdf.setAuthor(safe(envelope.company.name));
  return Buffer.from(await pdf.save());
}

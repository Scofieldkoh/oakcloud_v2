import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { ValidationError } from '@/lib/errors';
import { OAKDOC_ERROR_REASONS } from '@/types/oakdoc';

/**
 * C05 package trust boundary.
 *
 * Every untrusted DOCX (template import, edited draft save, migration input,
 * conversion input) passes this bounded inspection before any transform.
 * Editor-core limits do not protect Oakcloud's own ZIP/XML transforms.
 */
export const OAKDOC_PACKAGE_LIMITS = {
  masterCompressedBytes: 10 * 1024 * 1024,
  draftCompressedBytes: 50 * 1024 * 1024,
  expandedTotalBytes: 100 * 1024 * 1024,
  xmlPartBytes: 20 * 1024 * 1024,
  entryCount: 5_000,
  expansionRatio: 100,
  /** Ratio is only meaningful once the archive expands beyond this size. */
  ratioFloorBytes: 1024 * 1024,
  xmlDepth: 256,
  xmlElements: 2_000_000,
} as const;

export type OakDocPackageKind = 'master' | 'draft';

export interface OakDocPackageInspection {
  sha256: string;
  compressedBytes: number;
  expandedBytes: number;
  entryCount: number;
  parts: string[];
  externalHyperlinkCount: number;
}

const WORD_MAIN_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const FORBIDDEN_ENTRY = /(^|\/)(vbaProject|vbaData)[^/]*$|\.(exe|dll|bat|cmd|com|scr|js|vbs|ps1|msi|jar|sh)$/i;
const XML_ENTRY = /\.(xml|rels)$/i;
const SAFE_HYPERLINK_SCHEME = /^(https?:|mailto:)/i;
const HYPERLINK_RELATIONSHIP_TYPE = /\/hyperlink$/;

export class OakDocPackageError extends ValidationError {
  constructor(message: string, public readonly check: string) {
    super(message, { reason: OAKDOC_ERROR_REASONS.PACKAGE_REJECTED, check });
    this.name = 'OakDocPackageError';
  }
}

function reject(check: string, message: string): never {
  throw new OakDocPackageError(message, check);
}

function assertSafeEntryName(name: string, seen: Set<string>): void {
  if (
    !name
    || name.includes('\\')
    || name.includes('\u0000')
    || name.startsWith('/')
    || name.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    reject('entry-path', 'The Word document contains an unsafe file path');
  }
  const folded = name.toLowerCase();
  if (seen.has(folded)) reject('entry-duplicate', 'The Word document contains duplicate parts');
  seen.add(folded);
  if (FORBIDDEN_ENTRY.test(name)) {
    reject('entry-executable', 'Macro-enabled or executable content is not supported in OakDoc');
  }
}

function assertBoundedXml(name: string, xml: string): void {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    reject('xml-dtd', 'The Word document contains XML declarations that are not allowed');
  }
  let depth = 0;
  let maxDepth = 0;
  let elements = 0;
  const tag = /<(\/?)([^\s>/!?]+)[^>]*?(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml)) !== null) {
    if (match[1]) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    elements += 1;
    if (!match[3]) depth += 1;
    if (depth > maxDepth) maxDepth = depth;
    if (maxDepth > OAKDOC_PACKAGE_LIMITS.xmlDepth || elements > OAKDOC_PACKAGE_LIMITS.xmlElements) {
      reject('xml-bounds', `The Word document part ${name} is too deeply nested or too large to process`);
    }
  }
}

function inspectRelationships(xml: string): number {
  let hyperlinks = 0;
  const relationship = /<Relationship\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = relationship.exec(xml)) !== null) {
    const attributes = match[1];
    if (!/TargetMode\s*=\s*"External"/i.test(attributes)) continue;
    const type = /Type\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? '';
    const target = (/Target\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? '').trim();
    if (!HYPERLINK_RELATIONSHIP_TYPE.test(type)) {
      reject('external-relationship', 'The Word document links to external content that OakDoc will not load');
    }
    if (!SAFE_HYPERLINK_SCHEME.test(target)) {
      reject('hyperlink-scheme', 'The Word document contains a hyperlink with an unsupported address type');
    }
    hyperlinks += 1;
  }
  return hyperlinks;
}

/**
 * Inspect one untrusted DOCX package. Throws `OakDocPackageError` (400 with a
 * safe `check` code) on the first violation; never returns partial success.
 */
export function inspectOakDocPackage(
  bytes: Uint8Array,
  kind: OakDocPackageKind,
): OakDocPackageInspection {
  const compressedLimit = kind === 'master'
    ? OAKDOC_PACKAGE_LIMITS.masterCompressedBytes
    : OAKDOC_PACKAGE_LIMITS.draftCompressedBytes;
  if (bytes.byteLength === 0) reject('empty', 'The Word document is empty');
  if (bytes.byteLength > compressedLimit) {
    reject('compressed-size', `The Word document exceeds the ${compressedLimit / (1024 * 1024)} MB limit`);
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    reject('encrypted', 'Password-protected or legacy Word files are not supported. Save as an unprotected .docx');
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) reject('not-zip', 'The file is not a valid DOCX package');

  const seen = new Set<string>();
  let entryCount = 0;
  let expandedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        entryCount += 1;
        if (entryCount > OAKDOC_PACKAGE_LIMITS.entryCount) {
          reject('entry-count', 'The Word document contains too many parts');
        }
        assertSafeEntryName(entry.name, seen);
        expandedBytes += entry.originalSize;
        if (expandedBytes > OAKDOC_PACKAGE_LIMITS.expandedTotalBytes) {
          reject('expanded-size', 'The Word document expands beyond the safe processing limit');
        }
        if (XML_ENTRY.test(entry.name) && entry.originalSize > OAKDOC_PACKAGE_LIMITS.xmlPartBytes) {
          reject('xml-part-size', 'A Word document part exceeds the safe processing limit');
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof OakDocPackageError) throw error;
    reject('unreadable', 'The file is not a readable DOCX package');
  }

  if (
    expandedBytes > OAKDOC_PACKAGE_LIMITS.ratioFloorBytes
    && expandedBytes / bytes.byteLength > OAKDOC_PACKAGE_LIMITS.expansionRatio
  ) {
    reject('expansion-ratio', 'The Word document expands beyond the safe compression ratio');
  }

  const contentTypes = files['[Content_Types].xml'];
  if (!contentTypes || !files['word/document.xml']) {
    reject('missing-main-part', 'The file does not contain a Word document');
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  if (!decoder.decode(contentTypes).includes(WORD_MAIN_CONTENT_TYPE)) {
    reject('content-type', 'The file is not a standard Word .docx document');
  }

  let externalHyperlinkCount = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!XML_ENTRY.test(name)) continue;
    const xml = decoder.decode(data);
    assertBoundedXml(name, xml);
    if (name.endsWith('.rels')) externalHyperlinkCount += inspectRelationships(xml);
  }

  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    compressedBytes: bytes.byteLength,
    expandedBytes,
    entryCount,
    parts: Object.keys(files).sort(),
    externalHyperlinkCount,
  };
}

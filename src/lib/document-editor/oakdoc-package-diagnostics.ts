import { strFromU8, unzipSync } from 'fflate';

const DEFAULT_OAKDOC_TAG_PREFIXES = [
  'company.',
  'selectedDirector.',
  'selectedShareholder.',
  'system.',
  'repeat.',
  'director.',
  'shareholder.',
  'oakdoc.condition.',
] as const;

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'emf', 'wmf', 'svg',
]);

export type OakDocDiagnosticSeverity = 'error' | 'warning';

export interface OakDocDiagnosticIssue {
  code: string;
  severity: OakDocDiagnosticSeverity;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface OakDocRequiredControl {
  tag: string;
  minCount?: number;
  maxCount?: number;
}

export interface OakDocRequiredTableCell {
  tableIndex: number;
  rowIndex: number;
  cellIndex: number;
  label?: string;
}

export interface OakDocPackageDiagnosticOptions {
  knownOakDocTags?: readonly string[];
  oakDocTagPrefixes?: readonly string[];
  requiredControls?: readonly OakDocRequiredControl[];
  requiredTextBlocks?: readonly string[];
  requiredTableCells?: readonly OakDocRequiredTableCell[];
}

export interface OakDocPackageDiagnosticResult {
  passed: boolean;
  issues: OakDocDiagnosticIssue[];
  unresolvedOakDocControls: string[];
  unresolvedLegacyPlaceholders: string[];
  controlCounts: Record<string, number>;
  relationshipCount: number;
  imageRelationshipCount: number;
  mediaCount: number;
  sectionCount: number;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlText(bytes: Uint8Array): string {
  return strFromU8(bytes);
}

function attributeValue(source: string, name: string): string {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  );
  const match = source.match(pattern);
  return decodeXmlEntities(match?.[1] ?? match?.[2] ?? '');
}

function normalizePackagePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function relationshipSourcePath(relsPath: string): string {
  if (relsPath === '_rels/.rels') return '';
  const match = relsPath.match(/^(.*)\/_rels\/([^/]+)\.rels$/);
  if (!match) return '';
  return normalizePackagePath(`${match[1]}/${match[2]}`);
}

function resolveRelationshipTarget(relsPath: string, target: string): string {
  if (target.startsWith('/')) return normalizePackagePath(target.slice(1));
  const source = relationshipSourcePath(relsPath);
  const sourceDir = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  return normalizePackagePath(sourceDir ? `${sourceDir}/${target}` : target);
}

export function extractDocxSemanticText(docxBytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(docxBytes);
  } catch {
    return '';
  }

  const partNames = Object.keys(files)
    .filter((name) =>
      name === 'word/document.xml'
      || /^word\/(?:header|footer)\d+\.xml$/i.test(name)
      || /^word\/(?:footnotes|endnotes|comments)\.xml$/i.test(name))
    .sort((left, right) => {
      if (left === 'word/document.xml') return -1;
      if (right === 'word/document.xml') return 1;
      return left.localeCompare(right);
    });

  return partNames.map((name) => {
    const xml = xmlText(files[name]);
    const withBoundaries = xml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:br\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<\/w:tr>/gi, '\n');
    const tokens: string[] = [];
    const expression = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|([\t\n])/gi;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(withBoundaries)) !== null) {
      tokens.push(match[1] !== undefined ? decodeXmlEntities(match[1]) : match[2]);
    }
    return tokens.join('');
  }).join('\n');
}

function findLegacyPlaceholders(text: string): string[] {
  const matches = text.match(/\{\{[^{}\n]{1,200}\}\}/g) ?? [];
  return Array.from(new Set(matches.map((value) => value.trim()))).sort();
}

function contentControlCounts(documentXml: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const expression = /<w:tag\b([^>]*)\/?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(documentXml)) !== null) {
    const tag = attributeValue(match[1], 'w:val') || attributeValue(match[1], 'val');
    if (!tag) continue;
    counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

function managedControlTags(
  counts: Record<string, number>,
  options: OakDocPackageDiagnosticOptions,
): string[] {
  const known = new Set(options.knownOakDocTags ?? []);
  const prefixes = options.oakDocTagPrefixes ?? DEFAULT_OAKDOC_TAG_PREFIXES;
  return Object.keys(counts)
    .filter((tag) => known.has(tag) || prefixes.some((prefix) => tag.startsWith(prefix)))
    .sort();
}

function extractCellText(cellXml: string): string {
  return Array.from(cellXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi))
    .map((match) => decodeXmlEntities(match[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableCells(documentXml: string): Array<Array<Array<string>>> {
  return Array.from(documentXml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/gi))
    .map((tableMatch) =>
      Array.from(tableMatch[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi))
        .map((rowMatch) =>
          Array.from(rowMatch[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi))
            .map((cellMatch) => extractCellText(cellMatch[1])),
        ));
}

function sectionParents(documentXml: string): Array<{ parent: string | null; offset: number }> {
  const stack: string[] = [];
  const sections: Array<{ parent: string | null; offset: number }> = [];
  const expression = /<\/?([A-Za-z0-9_.:-]+)\b[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(documentXml)) !== null) {
    const raw = match[0];
    const name = match[1];
    const closing = raw.startsWith('</');
    const selfClosing = /\/\s*>$/.test(raw);

    if (closing) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index);
      continue;
    }

    if (name === 'w:sectPr') {
      sections.push({ parent: stack.at(-1) ?? null, offset: match.index });
    }
    if (!selfClosing) stack.push(name);
  }
  return sections;
}

function addIssue(
  issues: OakDocDiagnosticIssue[],
  code: string,
  severity: OakDocDiagnosticSeverity,
  message: string,
  details?: OakDocDiagnosticIssue['details'],
): void {
  issues.push({ code, severity, message, ...(details ? { details } : {}) });
}

export function diagnoseOakDocPackage(
  docxBytes: Uint8Array,
  options: OakDocPackageDiagnosticOptions = {},
): OakDocPackageDiagnosticResult {
  const issues: OakDocDiagnosticIssue[] = [];
  let files: Record<string, Uint8Array>;

  try {
    files = unzipSync(docxBytes);
  } catch {
    addIssue(issues, 'DOCX_UNREADABLE', 'error', 'The DOCX package cannot be opened.');
    return {
      passed: false,
      issues,
      unresolvedOakDocControls: [],
      unresolvedLegacyPlaceholders: [],
      controlCounts: {},
      relationshipCount: 0,
      imageRelationshipCount: 0,
      mediaCount: 0,
      sectionCount: 0,
    };
  }

  const documentBytes = files['word/document.xml'];
  if (!documentBytes) {
    addIssue(
      issues,
      'MISSING_DOCUMENT_XML',
      'error',
      'The DOCX package does not contain word/document.xml.',
    );
    return {
      passed: false,
      issues,
      unresolvedOakDocControls: [],
      unresolvedLegacyPlaceholders: findLegacyPlaceholders(extractDocxSemanticText(docxBytes)),
      controlCounts: {},
      relationshipCount: 0,
      imageRelationshipCount: 0,
      mediaCount: Object.keys(files).filter((name) => name.startsWith('word/media/')).length,
      sectionCount: 0,
    };
  }

  const documentXml = xmlText(documentBytes);
  const semanticText = extractDocxSemanticText(docxBytes);
  const unresolvedLegacyPlaceholders = findLegacyPlaceholders(semanticText);
  unresolvedLegacyPlaceholders.forEach((placeholder) => {
    addIssue(
      issues,
      'UNRESOLVED_LEGACY_PLACEHOLDER',
      'error',
      `Unresolved legacy placeholder remains in DOCX: ${placeholder}`,
      { placeholder },
    );
  });

  const controlCounts = contentControlCounts(documentXml);
  const unresolvedOakDocControls = managedControlTags(controlCounts, options);
  unresolvedOakDocControls.forEach((tag) => {
    addIssue(
      issues,
      'UNRESOLVED_OAKDOC_CONTROL',
      'error',
      `Unresolved OakDoc content control remains: ${tag}`,
      { tag, count: controlCounts[tag] },
    );
  });

  for (const requirement of options.requiredControls ?? []) {
    const count = controlCounts[requirement.tag] ?? 0;
    const minCount = requirement.minCount ?? 1;
    const maxCount = requirement.maxCount ?? 1;
    if (count < minCount) {
      addIssue(
        issues,
        'MISSING_REQUIRED_CONTROL',
        'error',
        `Required control "${requirement.tag}" is missing.`,
        { tag: requirement.tag, count, minCount },
      );
    }
    if (count > maxCount) {
      addIssue(
        issues,
        'DUPLICATE_REQUIRED_CONTROL',
        'error',
        `Required control "${requirement.tag}" appears ${count} times.`,
        { tag: requirement.tag, count, maxCount },
      );
    }
  }

  const normalizedSemanticText = semanticText
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-SG');
  for (const block of options.requiredTextBlocks ?? []) {
    const normalizedBlock = block
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('en-SG');
    if (normalizedBlock && !normalizedSemanticText.includes(normalizedBlock)) {
      addIssue(
        issues,
        'MISSING_REQUIRED_STRUCTURAL_BLOCK',
        'error',
        `Required structural text block is missing: ${block}`,
        { block },
      );
    }
  }

  const tables = tableCells(documentXml);
  for (const requiredCell of options.requiredTableCells ?? []) {
    const value = tables[requiredCell.tableIndex]?.[requiredCell.rowIndex]?.[requiredCell.cellIndex];
    if (value === undefined) {
      addIssue(
        issues,
        'MISSING_REQUIRED_TABLE_CELL',
        'error',
        `Required table cell is missing${requiredCell.label ? `: ${requiredCell.label}` : '.'}`,
        {
          tableIndex: requiredCell.tableIndex,
          rowIndex: requiredCell.rowIndex,
          cellIndex: requiredCell.cellIndex,
        },
      );
    } else if (!value.trim()) {
      addIssue(
        issues,
        'SUSPICIOUS_EMPTY_REQUIRED_TABLE_CELL',
        'error',
        `Required table cell is empty${requiredCell.label ? `: ${requiredCell.label}` : '.'}`,
        {
          tableIndex: requiredCell.tableIndex,
          rowIndex: requiredCell.rowIndex,
          cellIndex: requiredCell.cellIndex,
        },
      );
    }
  }

  let relationshipCount = 0;
  let imageRelationshipCount = 0;
  const referencedMedia = new Set<string>();

  for (const relsPath of Object.keys(files).filter((name) => name.endsWith('.rels'))) {
    const relsXml = xmlText(files[relsPath]);
    const expression = /<Relationship\b([^>]*)\/?\s*>/gi;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(relsXml)) !== null) {
      relationshipCount += 1;
      const targetMode = attributeValue(match[1], 'TargetMode');
      const target = attributeValue(match[1], 'Target');
      const type = attributeValue(match[1], 'Type');
      const id = attributeValue(match[1], 'Id');
      if (!target || targetMode.toLowerCase() === 'external') continue;

      const resolvedTarget = resolveRelationshipTarget(relsPath, target);
      if (!files[resolvedTarget]) {
        addIssue(
          issues,
          'BROKEN_RELATIONSHIP',
          'error',
          `Relationship ${id || '(unnamed)'} points to a missing package part.`,
          { relsPath, id, target: resolvedTarget },
        );
      }

      if (type.toLowerCase().endsWith('/image')) {
        imageRelationshipCount += 1;
        referencedMedia.add(resolvedTarget);
        const media = files[resolvedTarget];
        if (media && media.byteLength === 0) {
          addIssue(
            issues,
            'INVALID_REFERENCED_MEDIA',
            'error',
            'An image relationship points to an empty media file.',
            { target: resolvedTarget },
          );
        }
        const extension = resolvedTarget.includes('.')
          ? resolvedTarget.slice(resolvedTarget.lastIndexOf('.') + 1).toLowerCase()
          : '';
        if (media && extension && !IMAGE_EXTENSIONS.has(extension)) {
          addIssue(
            issues,
            'SUSPICIOUS_REFERENCED_MEDIA',
            'warning',
            'An image relationship points to an unexpected media extension.',
            { target: resolvedTarget },
          );
        }
      }
    }
  }

  const mediaParts = Object.keys(files).filter((name) => name.startsWith('word/media/'));
  for (const mediaPath of mediaParts) {
    if (files[mediaPath].byteLength === 0) {
      addIssue(
        issues,
        'INVALID_MEDIA',
        'error',
        'The DOCX package contains an empty media file.',
        { target: mediaPath },
      );
    }
    if (!referencedMedia.has(mediaPath)) {
      addIssue(
        issues,
        'ORPHANED_MEDIA',
        'warning',
        'The DOCX package contains media that is not referenced by an image relationship.',
        { target: mediaPath },
      );
    }
  }

  const sections = sectionParents(documentXml);
  if (sections.length === 0) {
    addIssue(
      issues,
      'MISSING_SECTION_PROPERTIES',
      'warning',
      'The document contains no section properties.',
    );
  }
  const bodySections = sections.filter((section) => section.parent === 'w:body');
  if (bodySections.length > 1) {
    addIssue(
      issues,
      'MULTIPLE_BODY_SECTION_PROPERTIES',
      'error',
      'The document contains multiple body-level section property blocks.',
      { count: bodySections.length },
    );
  }
  for (const section of sections) {
    if (section.parent !== 'w:body' && section.parent !== 'w:pPr') {
      addIssue(
        issues,
        'ORPHANED_SECTION_PROPERTIES',
        'error',
        'A section property block is attached to an unexpected XML parent.',
        { parent: section.parent ?? '' },
      );
    }
  }
  for (const bodySection of bodySections) {
    const openingEnd = documentXml.indexOf('>', bodySection.offset);
    const opening = openingEnd >= 0
      ? documentXml.slice(bodySection.offset, openingEnd + 1)
      : '';
    const selfClosing = /\/\s*>$/.test(opening);
    const closing = selfClosing
      ? openingEnd
      : documentXml.indexOf('</w:sectPr>', bodySection.offset);
    const afterSection = selfClosing
      ? closing + 1
      : closing + '</w:sectPr>'.length;
    const bodyEnd = documentXml.indexOf('</w:body>', afterSection);
    if (closing >= 0 && bodyEnd >= 0) {
      const tail = documentXml.slice(afterSection, bodyEnd);
      if (/<w:(?:p|tbl|sdt)\b/i.test(tail)) {
        addIssue(
          issues,
          'ORPHANED_BODY_SECTION_STRUCTURE',
          'error',
          'Body-level section properties are not the final document-body structure.',
        );
      }
    }
  }

  return {
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues,
    unresolvedOakDocControls,
    unresolvedLegacyPlaceholders,
    controlCounts,
    relationshipCount,
    imageRelationshipCount,
    mediaCount: mediaParts.length,
    sectionCount: sections.length,
  };
}

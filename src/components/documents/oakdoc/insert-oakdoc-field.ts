import type { DocxEditorRef, EditorCommand } from '@docx-editor.dev/react';
import type { RunFormatting } from '@docx-editor.dev/core';
import { OAKDOC_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';
import { oakDocFieldTitle } from '@/lib/document-editor/oakdoc-field-case';
import {
  normalizeOakDocFields,
  type OakDocFieldDefinition,
} from '@/lib/document-editor/oakdoc-fields';

export interface OakDocFieldInsertion {
  /** Bytes to remount when the field was seeded or deleted fields were pruned; null when the editor already shows the result. */
  bytes: Uint8Array | null;
  /** The editor's bytes after the insert, for refreshing field summaries. */
  afterBytes: Uint8Array;
  message: string;
}

async function editorBytes(handle: DocxEditorRef): Promise<Uint8Array> {
  const buffer = await handle.save();
  if (!buffer) throw new Error('OakDoc did not return a DOCX file.');
  return new Uint8Array(buffer);
}

type CaretFont = Pick<RunFormatting, 'fontFamily' | 'fontSizePt'> | null;

/**
 * Gives the empty field at the caret the font and size the text at the
 * caret had. A field beside text already takes that text's font; one in an
 * empty paragraph otherwise falls back to the document default, ignoring the
 * font the paragraph mark carries.
 */
function matchCaretFont(handle: DocxEditorRef, font: CaretFont) {
  const inside = handle.getEditor()?.query({ type: 'selectionFormatting' });
  if (!font || !inside) return;
  if (font.fontFamily && inside.fontFamily !== font.fontFamily) {
    handle.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: font.fontFamily });
  }
  if (font.fontSizePt && inside.fontSizePt !== font.fontSizePt) {
    // Word sizes are in half points.
    handle.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: Math.round(font.fontSizePt * 2) });
  }
}

/**
 * Wrap the selection in (or insert at the caret) a Word content control for
 * an Oakcloud field. Shared by the template editor and the Word partial
 * editor so both create identical fields. The document is only remounted
 * when the editor could not fill the new field itself or a deleted field
 * had to be pruned.
 */
export async function insertOakDocField(
  handle: DocxEditorRef | null,
  field: OakDocFieldDefinition,
): Promise<OakDocFieldInsertion> {
  const editor = handle?.getEditor();
  if (!handle || !editor) throw new Error('OakDoc is not ready.');

  const beforeBytes = await editorBytes(handle);
  const command = {
    type: 'insertContentControl',
    subtype: 'plainText',
    tag: field.tag,
    title: oakDocFieldTitle(field.label, field.textCase, field.dateFormat),
  } as EditorCommand;

  const allowed = editor.can(command);
  if (!allowed.ok) {
    throw new Error(allowed.reason || 'The current selection cannot be made into a field.');
  }
  const atCaret = editor.snapshot().selectionCollapsed;
  const caretFont = atCaret ? editor.query({ type: 'selectionFormatting' }) : null;
  const result = handle.exec(command);
  if (!result.ok) {
    throw new Error(result.reason || 'OakDoc could not create the Word content control.');
  }
  // At a caret the new control is empty with the caret inside it; typing its
  // token in place fills it without reloading the document, so the caret and
  // scroll position stay where the author was working.
  if (atCaret) {
    matchCaretFont(handle, caretFont);
    handle.exec({ type: 'insertText', text: `{{${field.tag}}}` } as unknown as EditorCommand);
  }

  const afterBytes = await editorBytes(handle);
  const normalized = normalizeOakDocFields({
    beforeBytes,
    afterBytes,
    insertedField: field,
    knownTags: OAKDOC_FIELD_TAGS,
  });
  const cleanupMessage = normalized.removed > 0
    ? ` Removed ${normalized.removed} deleted field${normalized.removed === 1 ? '' : 's'}.`
    : '';
  if (normalized.seeded > 0 || normalized.removed > 0) {
    return {
      bytes: normalized.bytes,
      afterBytes: normalized.bytes,
      message: `Created ${field.label} field. Empty fields display {{${field.tag}}} until resolved.${cleanupMessage}`,
    };
  }
  return {
    bytes: null,
    afterBytes,
    message: atCaret
      ? `Added ${field.label} field.`
      : `Created ${field.label} field around the selected text.`,
  };
}

'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OakDocDocumentHost } from '@/components/documents/oakdoc/oakdoc-document-host';
import { OakDocFieldPanel } from '@/components/documents/oakdoc/oakdoc-field-panel';
import {
  readOakDocCustomFields,
  readOakDocPartialCustomFields,
  readOakDocRepeaterSections,
  writeOakDocCustomFields,
  writeOakDocRepeaterSections,
  type OakDocCustomField,
  type OakDocRepeaterSections,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { oakDocNamedKeysIn } from '@/lib/document-editor/oakdoc-named-sections';
import { pruneDeletedOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { OAKDOC_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';
import { partialKeys, saveWordPartial } from '@/hooks/use-template-partials';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import type { OakDocSnapshotIdentity } from '@/types/oakdoc';

/** Drops field controls a cut or delete left empty, as template saves do. */
function pruneEmptyFields(bytes: Uint8Array) {
  return pruneDeletedOakDocFields(bytes, OAKDOC_FIELD_TAGS);
}

export interface WordPartialEditorProps {
  partialId: string;
  /** Changes when a new version is uploaded, so the editor reloads it. */
  loadKey: number;
  title: string;
  fileName: string;
  version: number;
  readOnly: boolean;
  /** The partial's stored placeholders, holding its custom fields. */
  placeholders?: unknown;
  onDirtyChange?: (dirty: boolean) => void;
}

async function loadPartialDocx(partialId: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(`/api/template-partials/${encodeURIComponent(partialId)}/oakdoc`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? 'Could not load the Word partial');
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * In-app editor for a Word partial over the shared OakDoc host. Each save
 * uploads a new partial version; templates keep their pinned version until
 * they are updated.
 */
export function WordPartialEditor({
  partialId,
  loadKey,
  title,
  fileName,
  version,
  readOnly,
  placeholders,
  onDirtyChange,
}: WordPartialEditorProps) {
  const queryClient = useQueryClient();
  const [storedPlaceholders, setStoredPlaceholders] = useState<unknown>(placeholders ?? []);
  const [customFields, setCustomFields] = useState<OakDocCustomField[]>(
    () => readOakDocCustomFields(placeholders),
  );
  const [repeaterSections, setRepeaterSections] = useState<OakDocRepeaterSections>(
    () => readOakDocRepeaterSections(placeholders),
  );
  const load = useCallback(
    (signal: AbortSignal) => loadPartialDocx(partialId, signal),
    [partialId],
  );

  const persist = useCallback(async (bytes: Uint8Array, snapshot: OakDocSnapshotIdentity) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const saved = await saveWordPartial({
      id: partialId,
      expectedRevision: snapshot.baseRevision,
      file: new File([copy.buffer], fileName, { type: OAKDOC_MIME_TYPE }),
      placeholders: writeOakDocRepeaterSections(
        writeOakDocCustomFields(storedPlaceholders, customFields),
        repeaterSections,
        // A name or shortlist outlives its section (or picker) only until the next save.
        oakDocNamedKeysIn(bytes),
      ),
    });
    setStoredPlaceholders(saved.placeholders ?? []);
    await queryClient.invalidateQueries({ queryKey: partialKeys.all });
    return { revision: saved.version };
  }, [customFields, fileName, partialId, queryClient, repeaterSections, storedPlaceholders]);

  return (
    <OakDocDocumentHost
      entityKey={`partial:${partialId}:${loadKey}`}
      baseRevision={version}
      title={title}
      readOnly={readOnly}
      description={readOnly ? 'read-only Word partial' : 'Word partial'}
      loadingLabel="Loading Word partial…"
      load={load}
      persist={persist}
      cleanup={pruneEmptyFields}
      fieldBlocks
      onDirtyChange={onDirtyChange}
      renderSidebar={({
        insertField,
        markChanged,
        fieldTags,
        addRepeater,
        removeRepeaterAtCaret,
        setRepeaterLettering,
        repeaters,
        disabled,
      }) => (
        <OakDocFieldPanel
          presentTags={fieldTags}
          onInsert={(field) => void insertField(field)}
          disabled={disabled}
          customFields={customFields}
          partialCustomFields={readOakDocPartialCustomFields(storedPlaceholders)}
          onCustomFieldsChange={(next) => {
            setCustomFields(next);
            markChanged();
          }}
          ownerLabel="partial"
          repeaterTags={repeaters.tags}
          repeaterCount={repeaters.count}
          letteredRepeaterTags={repeaters.letteredTags}
          onAddRepeater={(definition) => void addRepeater(definition)}
          onRemoveRepeaterAtCaret={() => void removeRepeaterAtCaret()}
          onRepeaterLetteringChange={(tag, lettered) => void setRepeaterLettering(tag, lettered)}
          sections={repeaterSections}
          onSectionsChange={(next) => {
            setRepeaterSections(next);
            markChanged();
          }}
        />
      )}
    />
  );
}

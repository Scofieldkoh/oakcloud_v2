'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAssistantPreferences } from '@/hooks/use-business-assistant';
import { ArtifactView, humanize } from '@/components/ui/structured-data-view';
import { getAssistantPreferenceDefinition } from '@/lib/business-assistant-preferences';

export function AssistantPreferencesPanel({ workspaceId }: { workspaceId: string }) {
  const { memories, learning, action } = useAssistantPreferences(workspaceId, true);
  const ids = useRef(new Map<string, string>());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  function requestId(key: string) { const id = ids.current.get(key) ?? crypto.randomUUID(); ids.current.set(key, id); return id; }
  return <section aria-label="Assistant preferences and improvements" className="space-y-6 p-4 sm:p-6">
    <div><h2 className="text-base font-semibold">Preferences & improvements</h2>
      <p className="mt-1 text-sm text-text-secondary">Review what Olaf remembers and the evidence behind proposed improvements.</p></div>
    {(memories.error || learning.error || action.error) && <p role="alert" className="text-sm text-status-error">{(memories.error ?? learning.error ?? action.error)?.message}</p>}
    <section className="space-y-3"><h3 className="text-sm font-semibold">Remembered preferences</h3>
      {memories.isLoading && <p role="status" className="text-sm text-text-secondary">Loading preferences…</p>}
      {memories.data?.length === 0 && <p className="text-sm text-text-secondary">No saved preferences. You can ask Olaf to remember a preference in the conversation.</p>}
      {memories.data?.map((memory) => <article key={memory.id} className="space-y-3 rounded-lg border border-border-primary p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-medium">{humanize(memory.key)}</h4><span className="text-xs text-text-secondary">{humanize(memory.scope)} · {humanize(memory.state)} · Version {memory.version}</span></div>
        <ArtifactView value={memory.value} />
        <p className="text-xs text-text-secondary">{memory.capabilityId ? `Applies to ${humanize(memory.capabilityId)}` : 'General preference'} · {memory.evidenceCount} evidence {memory.evidenceCount === 1 ? 'record' : 'records'}</p>
        {memory.expiresAt && <p className="text-xs text-text-secondary">Expires {new Date(memory.expiresAt).toLocaleString()}</p>}
        <details><summary className="cursor-pointer text-xs text-text-secondary">Why this was suggested</summary><div className="mt-2"><ArtifactView value={memory.provenance} /></div></details>
        {editing?.id === memory.id && <form onSubmit={(event) => {
          event.preventDefault(); if (!editing.value.trim()) return;
          action.mutate({ kind: 'memories', id: memory.id, body: { action: 'REVISE', expectedVersion: memory.version, value: editing.value,
            clientRequestId: requestId(`${memory.id}:${memory.version}:REVISE:${editing.value}`) } }, { onSuccess: () => setEditing(null) });
        }} className="space-y-2"><label className="block text-xs" htmlFor={`edit-${memory.id}`}>Revised preference</label>
          <select id={`edit-${memory.id}`} value={editing.value} onChange={(event) => setEditing({ id: memory.id, value: event.target.value })}
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2">
            {getAssistantPreferenceDefinition(memory.key)?.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Button type="submit" disabled={!editing.value.trim()} isLoading={action.isPending}>Save revision</Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        </form>}
        <div className="flex flex-wrap gap-2">{memory.allowedActions.map((name) => <Button key={name} size="xs" variant={name === 'DELETE' ? 'ghost' : 'secondary'} disabled={action.isPending || name === 'REVISE' && (typeof memory.value !== 'string' || !getAssistantPreferenceDefinition(memory.key))}
          onClick={() => {
            if (name === 'REVISE') { setEditing({ id: memory.id, value: String(memory.value) }); return; }
            action.mutate({ kind: 'memories', id: memory.id, body: { action: name, expectedVersion: memory.version, clientRequestId: requestId(`${memory.id}:${memory.version}:${name}`) } });
          }}>{name === 'CONFIRM' ? 'Remember this' : humanize(name)}</Button>)}</div>
      </article>)}
    </section>
    <section className="space-y-3"><h3 className="text-sm font-semibold">Proposed improvements</h3>
      {learning.isLoading && <p role="status" className="text-sm text-text-secondary">Loading improvements…</p>}
      {learning.data?.length === 0 && <p className="text-sm text-text-secondary">No improvements awaiting review.</p>}
      {learning.data?.map((change) => <article key={change.id} className="space-y-3 rounded-lg border border-border-primary p-4 text-sm">
        <h4 className="font-medium">{humanize(change.targetKey)}</h4>
        <p className="text-xs text-text-secondary">{humanize(change.state)} · {change.baselineVersion} → {change.candidateVersion} · {humanize(change.risk)} risk</p>
        <details><summary className="cursor-pointer text-xs">Evidence</summary><div className="mt-2"><ArtifactView value={change.evidence} /></div></details>
        {change.evaluation != null && <details open><summary className="cursor-pointer text-xs">Evaluation results</summary><div className="mt-2"><ArtifactView value={change.evaluation} /></div></details>}
        {change.rollbackTarget && <p className="text-xs text-text-secondary">Rollback version: {change.rollbackTarget}</p>}
        <div className="flex flex-wrap gap-2">{change.allowedActions.map((name) => <Button key={name} size="xs" variant="secondary" disabled={action.isPending}
          onClick={() => action.mutate({ kind: 'learning-changes', id: change.id, body: { action: name, expectedVersion: change.expectedVersion,
            clientRequestId: requestId(`${change.id}:${change.expectedVersion}:${name}`) } })}>{humanize(name)}</Button>)}</div>
      </article>)}
    </section>
  </section>;
}

import type { ReactNode } from 'react';

export function humanize(value: string): string {
  const text = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Plain React text only: structured source content never becomes HTML or a link. */
export function ArtifactView({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined) return <span className="text-text-muted">No value</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{String(value)}</span>;
  if (depth > 12) return <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value)) return value.length ? <ol className="space-y-2 pl-4 list-decimal">{value.map((item, index) =>
    <li key={index}><ArtifactView value={item} depth={depth + 1} /></li>)}</ol> : <span className="text-text-muted">None</span>;
  return <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(100px,1fr)_minmax(0,3fr)]">
    {Object.entries(value).map(([key, item]) => <div className="contents" key={key}>
      <dt className="text-text-secondary break-words">{humanize(key)}</dt>
      <dd className="min-w-0"><ArtifactView value={item} depth={depth + 1} /></dd>
    </div>)}
  </dl>;
}

import Link from 'next/link';
import { ExternalLink, PenLine } from 'lucide-react';

export interface GeneratedDocumentEnvelopeSummary {
  id: string;
  title: string;
  status: 'DRAFT' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'VOIDED' | 'DECLINED' | 'EXPIRED';
  completedAt: string | null;
}

function formatCompletionDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatEnvelopeStatus(status: GeneratedDocumentEnvelopeSummary['status']): string {
  return status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export function GeneratedDocumentEnvelopeHistory({
  envelopes,
}: {
  envelopes: GeneratedDocumentEnvelopeSummary[];
}) {
  return (
    <section
      aria-labelledby="generated-document-envelopes-heading"
      className="rounded-lg border border-border-primary bg-background-secondary p-4"
    >
      <h2
        id="generated-document-envelopes-heading"
        className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary"
      >
        <PenLine className="h-4 w-4 text-text-muted" aria-hidden="true" />
        E-signing envelopes
      </h2>

      {envelopes.length === 0 ? (
        <p className="text-xs text-text-muted">No envelopes linked to this document.</p>
      ) : (
        <ul className="divide-y divide-border-secondary">
          {envelopes.map((envelope) => (
            <li key={envelope.id}>
              <Link
                href={`/esigning/${envelope.id}`}
                className="group flex items-center gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary transition-colors group-hover:text-accent-primary">
                    {envelope.title}
                  </p>
                  <p className="text-xs text-text-muted">
                    {envelope.completedAt
                      ? `Completed ${formatCompletionDate(envelope.completedAt)}`
                      : `Not completed · ${formatEnvelopeStatus(envelope.status)}`}
                  </p>
                </div>
                <ExternalLink
                  className="h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-colors group-hover:text-accent-primary"
                  aria-hidden="true"
                />
                <span className="sr-only">View envelope details</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

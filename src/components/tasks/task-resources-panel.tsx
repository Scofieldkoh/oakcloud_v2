'use client';

import { useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  PenLine,
} from 'lucide-react';
import { useEsigningRecipientManualLink } from '@/hooks/use-esigning';
import { copyTextToClipboard } from '@/lib/clipboard';
import { Button } from '@/components/ui/button';
import type {
  TaskEsigningEnvelopeResource,
  TaskEsigningSignerResource,
  TaskGeneratedDocumentResource,
  TaskResource,
  TaskResourceStage,
  TaskResourcesResponse,
} from '@/services/tasks/types';

interface TaskResourcesPanelProps {
  data?: TaskResourcesResponse;
  activeStageId?: string;
  isLoading: boolean;
  error?: Error | null;
  onRetry: () => void;
}

function statusLabel(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function stateClass(state: TaskResource['state']) {
  if (state === 'available') return 'text-emerald-700 dark:text-emerald-300';
  if (state === 'pending') return 'text-amber-700 dark:text-amber-300';
  return 'text-text-secondary';
}

function stateLabel(state: TaskResource['state']) {
  if (state === 'available') return 'Available';
  if (state === 'pending') return 'Pending';
  return 'Unavailable';
}

function LinkIcon() {
  return <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />;
}

function ResourceState({ resource }: { resource: TaskResource }) {
  return (
    <span className={`text-xs font-medium ${stateClass(resource.state)}`}>
      {stateLabel(resource.state)}
    </span>
  );
}

function TaskResourceSummary({ task }: { task: TaskResourcesResponse['task'] }) {
  return (
    <section className="rounded-lg border border-border-primary bg-background-secondary p-3">
      <h3 className="text-sm font-semibold text-text-primary">Task information</h3>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs font-medium text-text-secondary">Task</dt>
          <dd className="mt-0.5 text-text-primary">{task.title}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-secondary">Pipeline</dt>
          <dd className="mt-0.5 text-text-primary">{task.pipelineName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-secondary">Linked company</dt>
          <dd className="mt-0.5">
            {task.company ? (
              <a
                href={task.company.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center gap-1 text-oak-primary hover:underline sm:min-h-0"
              >
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                {task.company.name}
                <LinkIcon />
              </a>
            ) : (
              <span className="text-text-secondary">Not linked</span>
            )}
          </dd>
        </div>
        {task.company ? (
          <div>
            <dt className="text-xs font-medium text-text-secondary">UEN</dt>
            <dd className="mt-0.5 text-text-primary">{task.company.uen}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs font-medium text-text-secondary">Due date</dt>
          <dd className="mt-0.5 text-text-primary">{formatDate(task.dueDate)}</dd>
        </div>
        {task.owner ? (
          <div>
            <dt className="text-xs font-medium text-text-secondary">Owner</dt>
            <dd className="mt-0.5 text-text-primary">{task.owner.name}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function UnavailableResource({ resource }: { resource: TaskResource }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-background-tertiary p-2.5 text-xs text-text-secondary">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium text-text-primary">{resource.label}</div>
        <div className="mt-0.5">{resource.reason || 'This resource is not available.'}</div>
      </div>
    </div>
  );
}

function PendingResource({ resource }: { resource: TaskResource }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium">{resource.label}</div>
        <div className="mt-0.5">{resource.reason || 'This resource is pending.'}</div>
      </div>
    </div>
  );
}

function GeneratedDocumentCard({ resource }: { resource: TaskGeneratedDocumentResource }) {
  return (
    <div className="rounded-md border border-border-primary p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-oak-primary" aria-hidden="true" />
          <div className="min-w-0">
            {resource.href ? (
              <a
                href={resource.href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-oak-primary hover:underline"
              >
                {resource.title || resource.label}
              </a>
            ) : (
              <span className="font-medium text-text-primary">{resource.title || resource.label}</span>
            )}
            {resource.status ? (
              <span className="text-xs font-normal text-text-secondary"> ({statusLabel(resource.status)})</span>
            ) : null}
          </div>
        </div>
        <ResourceState resource={resource} />
      </div>
    </div>
  );
}

function TaskSignerResourceRow({
  envelopeId,
  canGenerateSignerLink,
  signer,
}: {
  envelopeId: string;
  canGenerateSignerLink: boolean;
  signer: TaskEsigningSignerResource;
}) {
  const manualLink = useEsigningRecipientManualLink(envelopeId, signer.id);
  const [signingUrl, setSigningUrl] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const requestLink = async () => {
    setCopyError(null);
    try {
      const result = await manualLink.mutateAsync();
      setSigningUrl(result.signingUrl);
      const copied = await copyTextToClipboard(result.signingUrl);
      if (!copied) setCopyError('Signing link created, but it could not be copied.');
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'Could not create the signing link.');
    }
  };

  const canRequest = canGenerateSignerLink && signer.linkState === 'available';

  return (
    <div className="border-t border-border-primary pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-text-primary">{signer.name}</div>
          <div className="mt-0.5 break-all text-xs text-text-secondary">{signer.email}</div>
          <div className="mt-0.5 text-xs text-text-muted">{statusLabel(signer.status)}</div>
        </div>
        {canRequest ? (
          <Button
            variant="secondary"
            size="xs"
            leftIcon={<Copy />}
            onClick={() => void requestLink()}
            isLoading={manualLink.isPending}
            aria-label={`Get signing link for ${signer.name}`}
            className="shrink-0"
          >
            Get signing link
          </Button>
        ) : null}
      </div>
      {signer.linkState === 'waiting' ? (
        <p className="mt-1 text-xs text-text-secondary">The signer link will be available when signing starts.</p>
      ) : null}
      {signer.linkState === 'finished' ? (
        <p className="mt-1 text-xs text-text-secondary">Signing is complete for this signer.</p>
      ) : null}
      {signingUrl ? (
        <a
          href={signingUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open signing link for ${signer.name}`}
          className="mt-2 inline-flex min-h-10 items-center gap-1 text-xs text-oak-primary hover:underline sm:min-h-0"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Open signing link
          <LinkIcon />
        </a>
      ) : null}
      {copyError ? <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{copyError}</p> : null}
    </div>
  );
}

function EsigningEnvelopeCard({ resource }: { resource: TaskEsigningEnvelopeResource }) {
  return (
    <div className="rounded-md border border-border-primary p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-oak-primary" aria-hidden="true" />
          <div className="min-w-0">
            <div className="font-medium text-text-primary">{resource.title || resource.label}</div>
            {resource.href ? (
              <a
                href={resource.href}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex min-h-10 items-center gap-1 text-xs text-oak-primary hover:underline sm:min-h-0"
              >
                View signing request
                <LinkIcon />
              </a>
            ) : null}
          </div>
        </div>
        <ResourceState resource={resource} />
      </div>
      <div className="mt-2 text-xs text-text-secondary">
        {resource.completedSignatures} of {resource.requiredSignatures} signers completed
        {resource.expiresAt ? ` · Expires ${formatDate(resource.expiresAt)}` : ''}
      </div>
      {resource.pdfGenerationStatus === 'PENDING' || resource.pdfGenerationStatus === 'PROCESSING' ? (
        <p className="mt-2 rounded-md bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          Signed PDFs are processing
        </p>
      ) : null}
      {resource.documents.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs font-medium text-text-secondary">Documents</div>
          {resource.documents.map((document) => (
            <div key={document.id} className="flex flex-col gap-1 text-xs">
              <a
                href={document.originalPdfHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center gap-1 break-all text-oak-primary hover:underline sm:min-h-0"
                aria-label={document.fileName}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {document.fileName}
                <LinkIcon />
              </a>
              {document.signedPdfHref ? (
                <a
                  href={document.signedPdfHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center gap-1 break-all pl-5 text-oak-primary hover:underline sm:min-h-0"
                  aria-label={`Signed PDF: ${document.fileName}`}
                >
                  Signed PDF
                  <LinkIcon />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {resource.signers.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-text-secondary">Signers</div>
          {resource.signers.map((signer) => (
            <TaskSignerResourceRow
              key={signer.id}
              envelopeId={resource.id!}
              canGenerateSignerLink={resource.canGenerateSignerLink}
              signer={signer}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TaskResourceCard({ resource }: { resource: TaskResource }) {
  if (resource.state === 'pending') return <PendingResource resource={resource} />;
  if (resource.state === 'unavailable') return <UnavailableResource resource={resource} />;
  if (resource.kind === 'generatedDocument') return <GeneratedDocumentCard resource={resource} />;
  if (resource.kind === 'esigningEnvelope') return <EsigningEnvelopeCard resource={resource} />;
  return (
    <div className="rounded-md border border-border-primary p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-oak-primary" aria-hidden="true" />
          <div className="min-w-0">
            {resource.href ? (
              <a
                href={resource.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open company profile for ${resource.name || resource.label}`}
                className="font-medium text-oak-primary hover:underline"
              >
                {resource.name || resource.label}
              </a>
            ) : <span className="font-medium text-text-primary">{resource.name || resource.label}</span>}
            {resource.uen ? <div className="mt-0.5 text-xs text-text-secondary">UEN {resource.uen}</div> : null}
          </div>
        </div>
        <ResourceState resource={resource} />
      </div>
    </div>
  );
}

function TaskResourceStageSection({
  stage,
  isActive,
}: {
  stage: TaskResourceStage;
  isActive: boolean;
}) {
  return (
    <section
      data-testid={`task-resource-stage-${stage.id}`}
      data-active={isActive ? 'true' : 'false'}
      className={`rounded-lg border p-3 ${isActive ? 'border-oak-primary/40 bg-oak-primary/5' : 'border-border-primary bg-background-secondary'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            aria-label={`Resources for ${stage.name}`}
            className="text-sm font-semibold text-text-primary"
          >
            {stage.name}
          </h3>
        </div>
        <span className="shrink-0 text-xs font-medium text-text-secondary">{statusLabel(stage.status)}</span>
      </div>
      {stage.blockers.length > 0 ? (
        <div className="mt-2 space-y-1">
          {stage.blockers.map((blocker) => (
            <div key={blocker.code} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{blocker.message}</span>
            </div>
          ))}
        </div>
      ) : null}
      {stage.checklist.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs text-text-secondary">
          {stage.checklist.map((item) => (
            <div key={item.id} className="flex items-start gap-1.5">
              <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 ${item.isCompleted ? 'text-emerald-600' : 'text-text-muted'}`} aria-hidden="true" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {stage.resources.length > 0
          ? stage.resources.map((resource) => <TaskResourceCard key={`${resource.kind}-${resource.id ?? stage.id}`} resource={resource} />)
          : <p className="text-xs text-text-secondary">No linked resources for this stage.</p>}
      </div>
    </section>
  );
}

export function TaskResourcesPanel({
  data,
  activeStageId,
  isLoading,
  error,
  onRetry,
}: TaskResourcesPanelProps) {
  if (isLoading) {
    return <section data-testid="task-resources-panel" aria-busy="true" className="text-sm text-text-secondary">Loading task resources…</section>;
  }
  if (error) {
    return (
      <section data-testid="task-resources-panel" className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Task resources</h2>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
      </section>
    );
  }
  if (!data) {
    return <section data-testid="task-resources-panel" className="text-sm text-text-secondary">No task resources available.</section>;
  }
  return (
    <section data-testid="task-resources-panel" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-primary">Task resources</h2>
        {data.hasPendingResources ? <span className="text-xs text-amber-700 dark:text-amber-300">Updating</span> : null}
      </div>
      <TaskResourceSummary task={data.task} />
      <div className="space-y-3">
        {data.stages.map((stage) => (
          <TaskResourceStageSection
            key={stage.id}
            stage={stage}
            isActive={stage.id === activeStageId}
          />
        ))}
      </div>
    </section>
  );
}

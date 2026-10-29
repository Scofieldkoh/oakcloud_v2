# Background E-signing Preparation Design

## Goal

Prepare task-owned E-signing drafts before users enter the E-signing workspace. When a generated document becomes eligible and every intervening task stage is cleared, Oakcloud creates or reuses one draft envelope, exports the finalized document to PDF, and attaches it in the background.

## Scope

This design applies to task pipelines containing Document Generation and E-signing stages. It covers:

- Selecting the nearest preceding Document Generation stage for each E-signing stage.
- Waiting for intervening stages to be completed or skipped.
- Durable background preparation with immediate triggering and scheduled retries.
- Reusing a single task-owned draft envelope.
- Detaching and reattaching the generated PDF when the source is unfinalized and finalized again.
- Preserving envelope-level configuration and recipients.
- Preparation-aware task navigation and retry UI.

It does not automatically configure recipients, place signature fields, or send an envelope.

## Eligibility and Stage Gate

An E-signing stage uses the nearest preceding Document Generation stage. Search stops at that stage; earlier generated documents are not candidates.

Preparation becomes eligible when:

1. The selected Document Generation stage has a linked `GeneratedDocument`.
2. That generated document is `FINALIZED`.
3. Every stage strictly between the selected Document Generation stage and the E-signing stage is either `COMPLETED` or `SKIPPED`.

`NOT_STARTED`, `WAITING`, `IN_PROGRESS`, and `FAILED` intervening stages keep preparation waiting. The E-signing stage itself does not need to be started.

Examples:

- `Document Generation → E-signing`: document finalization opens the gate.
- `Document Generation → Review → E-signing`: document finalization makes the source eligible, but Review completion or skipping opens the gate.
- `Generate A → Review → E-sign A → Generate B → E-sign B`: each E-signing stage uses its nearest preceding generated document.

## Ownership Model

Each E-signing task stage owns one durable preparation record. The record identifies:

- Tenant, task, and E-signing task stage.
- Nearest preceding Document Generation task stage.
- Current generated-document source.
- Task-owned E-signing envelope, once created.
- Imported E-signing envelope document, once attached.
- Queue status, lease, attempt count, retry time, and last error.

The E-signing task stage is unique in the preparation table. Repeated lifecycle events converge on the same record, envelope, and imported document.

The imported `EsigningEnvelopeDocument` stores its source `GeneratedDocument` identifier. This distinguishes the automatically managed attachment from manually uploaded envelope documents and makes detach and replacement precise.

## Preparation States

The preparation state machine is:

- `WAITING`: the source document or intervening-stage gate is not ready.
- `QUEUED`: reconciliation is required.
- `PROCESSING`: a worker holds an active lease.
- `READY`: the correct finalized source PDF is attached to the task-owned draft envelope.
- `FAILED_RETRYABLE`: a transient export, storage, or database error occurred.
- `FAILED_PERMANENT`: the pipeline relationship or authoritative records are invalid and automatic retry cannot resolve the failure.

Retryable failures use bounded exponential backoff. A user-initiated retry resets the retry time and queues the same record. Workers recover `PROCESSING` records whose leases have expired.

## Event Flow

Relevant lifecycle operations queue reevaluation after their user-facing transaction succeeds:

- Generated-document finalization.
- Generated-document unfinalization.
- Intervening-stage completion, skip, or reopen.
- Task-stage outcome reconciliation.
- Task detail recovery when it discovers missing preparation state.

The event callback performs only an idempotent queue upsert and requests immediate processing. It does not export the PDF or delay the user-facing operation. The scheduler provides durable fallback processing when the immediate trigger fails, the process restarts, or a transient dependency is unavailable.

## Worker Reconciliation

For each claimed preparation, the worker recalculates the desired state from authoritative task, stage, outcome, generated-document, and envelope records.

### Gate closed

The worker sets the preparation to `WAITING`. It does not create a new envelope or attach a document.

### Gate open and source finalized

The worker:

1. Creates the task-owned draft envelope if none exists, attributing it to the user whose action first made preparation eligible.
2. Reuses the existing task-owned draft envelope on every later run.
3. Links that envelope as the E-signing stage outcome.
4. Exports the current finalized generated document to PDF.
5. Creates or replaces the automatically managed envelope document.
6. Sets the preparation to `READY`.

If the envelope already contains the correct managed attachment, the worker performs no export or storage mutation.

### Source unfinalized

If the envelope remains `DRAFT`, the worker removes only the automatically managed envelope document. Existing document foreign-key behavior removes its document-bound signature fields. The worker preserves:

- Recipients.
- Message.
- Signing order.
- Expiry.
- Reminder settings.
- Manually uploaded envelope documents and their fields.

The same envelope remains linked to the E-signing task stage, and the preparation returns to `WAITING`.

### Source finalized again

When the same generated document is finalized again, the worker exports and attaches the latest PDF to the same draft envelope. It does not restore removed signature fields because their coordinates belonged to the previous PDF.

### Immutable envelope boundary

Automatic attachment changes are allowed only while the envelope is `DRAFT`. If the task-owned envelope has been sent or otherwise left draft status, generated-document unfinalization is blocked with an explanation that the envelope must be voided first. This preserves the signing document and audit trail.

## Concurrency and Multi-instance Safety

The queue supports many users, tasks, and pipelines concurrently.

- A unique constraint on the E-signing task stage collapses duplicate events.
- Workers claim batches with PostgreSQL row-level locking using `FOR UPDATE SKIP LOCKED`.
- Each claim receives a lease expiry.
- A bounded concurrency limit processes independent preparations in parallel.
- Jobs for different E-signing stages do not block one another after claiming.
- Multiple application instances may run the worker without claiming the same preparation simultaneously.
- An expired lease makes an abandoned job claimable by another worker.
- Every lookup and mutation is tenant-scoped.

Running a single worker instance affects throughput only; it does not change correctness. Additional instances require no data-model change.

## Failure and Compensation

Envelope creation, task-outcome linking, PDF export, storage upload, and attachment persistence are separate failure boundaries.

- Envelope creation and linking are idempotent and may succeed before PDF preparation.
- Storage assets are deleted if database attachment persistence fails.
- A replaced managed attachment is deleted only after the new attachment is safely persisted.
- Transient failures retain the envelope and preparation record for retry.
- Permanent failures retain diagnostic state and do not roll back completed task stages.
- Preparation errors appear on the E-signing stage and in the E-signing workspace with a Retry action.

## Permissions and Attribution

Queue callbacks operate only after the initiating user has passed the existing task or document mutation permission checks. The preparation record stores the initiating user used to attribute the draft envelope and audit records.

Background execution uses tenant-scoped service operations, not a synthetic interactive session. It enforces the same document visibility, company access, E-signing creation, envelope ownership, and tenant boundaries required by foreground creation.

A user opening or retrying preparation must have update access to the task, read access to the generated document, and create/read access to E-signing.

## User Experience

Task navigation becomes preparation-aware:

- `READY`: open the prepared envelope immediately.
- Existing envelope outcome: reopen that authoritative envelope.
- `QUEUED` or `PROCESSING`: show preparation progress and automatically enter the envelope when it becomes available.
- `WAITING`: identify the intervening stage or source-document condition that blocks preparation.
- `FAILED_RETRYABLE`: show the failure and a Retry action.
- `FAILED_PERMANENT`: show the actionable validation failure without offering automatic retry.

The foreground task launch must not create a competing envelope. For older tasks without preparation state, launch recovery creates or queues the missing preparation record and follows the same reconciliation path.

## Scheduler and Throughput

The existing scheduler registers a dedicated E-signing preparation task. It claims a small configurable batch on each run and processes the batch with bounded concurrency. Lifecycle callbacks also request immediate processing so normal users do not wait for the next cron interval.

Configuration controls:

- Scheduler enablement and cron pattern.
- Claim batch size.
- Per-process concurrency.
- Lease timeout.
- Maximum retry attempts and backoff ceiling.

Defaults favor modest application workloads and can be increased without schema changes.

## Testing

Automated coverage includes:

- Direct and intervening-stage pipelines.
- `COMPLETED` and `SKIPPED` gate behavior.
- Blocking states for every other intervening-stage status.
- Nearest-document selection with multiple Document Generation stages.
- Duplicate event idempotency.
- Concurrent claims and multi-worker `SKIP LOCKED` behavior.
- Lease expiry and abandoned-job recovery.
- Draft envelope creation, reuse, and authoritative task linking.
- Detach on unfinalize and reattach on refinalize.
- Recipient and envelope-setting preservation.
- Document-bound field removal.
- Preservation of manually uploaded envelope documents.
- Blocking unfinalization after the envelope leaves `DRAFT`.
- Retryable and permanent failure handling.
- Storage compensation during partial failure.
- Preparation-aware navigation, polling, and retry.
- Legacy task recovery.
- Tenant and permission isolation.

## Documentation

Implementation updates `docs/ARCHITECTURE.md` with the queue, lifecycle triggers, immutable-envelope boundary, and multi-instance worker contract. Scheduler setup documentation describes the new task configuration.

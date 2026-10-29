# Service Agreement Third-Round Fixes Design

**Date:** 2026-08-01

**Scope:** Close the actionable findings from the third-round review of Stage 2 Service Agreement generation without changing the approved four-step workflow or beginning Stage 3 activation work.

## Goals

- Make the persisted authorised-representative snapshot authoritative after its initial capture.
- Make Review resumable only after a preview has been generated and persisted.
- Keep generation-session metadata and the one-to-one relational agreement consistent across template-composition changes.
- Confirm every agreement-boundary action that removes service assignments or fee lines.
- Complete the inactive content bundle's generated-PDF release gate when a usable development tenant and export path are available.

## Representative Snapshot Authority

Creating an agreement, changing its primary company, or deliberately choosing a different authorised contact captures a fresh snapshot from the current company-contact relation. Subsequent saves with the same primary company and contact preserve the existing snapshot without querying the current relation. Consequently, later contact edits, unlinking, deactivation, or deletion cannot rewrite or block the draft.

The wizard treats a saved agreement snapshot as satisfying Service Agreement contact requirements. It may load current contacts so the user can deliberately choose a replacement, but a missing current option must not clear the saved representative ID or block Save, Preview, or Generate. Standard templates retain their existing current-party checks.

## Review Persistence

Moving from Agreement details to Review uses three ordered operations:

1. Save the relational agreement and generation session while retaining `currentStep: 2`; reconcile the returned agreement, item, and fee identities into client state.
2. Generate the preview from the saved draft/agreement identifiers.
3. Save `currentStep: 3` and the generated preview in one session update, then enter Review.

If any operation fails, the wizard remains on Agreement details, displays the error, and never leaves a resumable step-3 session without content. A resumed legacy or interrupted step-3 agreement with missing preview content is moved back to Agreement details rather than rendering a blank editor.

## Composition-Transition Consistency

Selecting a standard template while a Service Agreement is present asks for confirmation but does not destroy the client-side agreement immediately. The discard intent remains pending until a successful session save or standard generation transaction removes the DRAFT relation and persists standard-template metadata. Cancelling the switch or switching back to a Service Agreement before persistence restores/retains the agreement and clears the pending discard.

Server update and generation paths query the attached agreement independently of the target template composition. They enforce these invariants:

- A standard template cannot retain an attached Service Agreement.
- Removal requires explicit discard intent and only applies to a DRAFT agreement.
- A Service Agreement template cannot hide an attached agreement by persisting a null `serviceAgreementId`.
- Document generation cannot convert an existing Service Agreement draft to standard content without performing the confirmed discard transaction.

## Destructive Company Changes

One shared impact calculation counts affected service assignments and fee lines for both additional-entity removal and primary-company replacement/clearing. The wizard confirms before changing state whenever either count is non-zero. Cancellation leaves the selected company, representative, entity list, items, fees, preview, and editor content unchanged.

## Testing

Regression coverage will prove:

- a deleted representative can resume, save, preview, and generate from the snapshot;
- an unchanged representative snapshot is not refreshed during unrelated saves;
- preview failure and second-save failure leave the persisted session on step 2 and display an error;
- successful preview persistence remains clean and resumable;
- Service Agreement to standard to Service Agreement transitions cannot hide or orphan the relation;
- confirmed standard generation discards the DRAFT relation transactionally, while absent confirmation is rejected;
- primary-company replacement has cancel and confirm coverage, alongside additional-entity removal;
- existing canonical hash, saved-entity hydration, seed idempotence, and ignored-PDF-artifact regressions remain green.

## PDF Release Gate

The bundle remains inactive. After code verification, use an available development tenant to seed the inactive content, obtain explicit content approval, generate a two-entity agreement containing both supplied variants with different entity fees, export it to `output/pdf/`, render every page, and inspect the checklist in the Stage 2 plan. If tenant credentials or seeded data are unavailable locally, report this as the sole external release-gate dependency rather than fabricating an artifact.

## Non-Goals

- Activating operational Services or implementing Stage 3.
- Reverse-syncing edited HTML into structured agreement data.
- Refreshing pinned service wording or representative snapshots implicitly.
- Changing standard-template generation behavior except where required to prevent an attached Service Agreement from being orphaned.

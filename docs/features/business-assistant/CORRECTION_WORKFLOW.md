# Business Assistant BizFile Correction Workflow

> **Updated:** 2026-09-10  
> **Status:** Deterministic-field correction UI and retained-source prefetch/transaction hardening implemented; broader P12 review and release gates remain open  
> **Related:** [Business Assistant Specification](./SPECIFICATION.md) · [Implementation Handover](../../plans/2026-09-05-business-assistant-implementation.md) · [API Reference](../../reference/API_REFERENCE.md#business-assistant-endpoints)

## Purpose

The correction workflow lets a user turn factual findings from the latest independent BizFile review into a new canonical proposal without rewriting the original operation, approval, receipt, or review.

A correction is **not** a direct edit. The UI submits only the reviewed expected value from an allowlisted finding. The server prepares a new linked run/item/proposal, and the user must review and approve that proposal through the normal Business Assistant confirmation flow before stored company data can change.

## Entry conditions

The correction panel is shown only for the latest review on a `bizfile.import_and_review` item when the source item is already committed and its lifecycle is one of:

- `NEEDS_REVIEW`
- `PASSED`
- `PASSED_WITH_WARNINGS`

The backend independently enforces the same committed/latest-review requirements together with ownership, fresh workspace/resource authorization, restore/dispatch policy, source evidence, receipt bindings, and current company/source revisions. UI visibility is convenience only; it is not an authorization boundary.

## Supported findings and fields

Only these review finding codes are eligible:

- `SELECTED_FIELD_MISMATCH`
- `PERSISTED_FIELD_MISSING`
- `APPROVED_FIELD_MISMATCH`

Supported deterministic paths are defined once in `src/lib/bizfile-correction-contract.ts` and consumed by both the UI and the server correction preparer. The current UI presents 26 scalar or one-to-one paths across entity details, SSIC activity, financial year/compliance, capital/currency, registered/mailing addresses, and auditor fields.

Collection-row corrections remain intentionally unsupported, including officers, shareholders, charges, share-capital rows, and former-name rows. Those require a separate identity-aware correction contract.

## Selection and request limits

A correction proposal may contain **1 to 20** findings. `BIZFILE_CORRECTION_MAX_ITEMS` in `src/lib/bizfile-correction-contract.ts` is the shared source of truth for both the UI limit and request validation.

When 20 corrections are selected, the remaining unselected checkboxes are disabled until the user deselects one. The reviewed correction value is immutable from this panel: the user selects findings but cannot substitute an arbitrary replacement value for the independent review's `expected` value.

## Request contract

`POST /api/business-assistant/runs/:id/corrections`

```json
{
  "workspaceId": "current-workspace-id",
  "clientRequestId": "stable-idempotency-key",
  "reviewId": "latest-review-id",
  "corrections": [
    {
      "findingId": "factual-finding-id",
      "value": "exact-reviewed-expected-value"
    }
  ]
}
```

The UI generates a stable `clientRequestId` for the same review plus selected-finding set. Repeating the identical request recovers the existing proposal rather than creating another one. Reusing the request ID with different content is rejected as a conflict.

The response contains the linked correction proposal identity:

```json
{
  "correction": {
    "kind": "CORRECTION_PROPOSAL",
    "correctionOfReviewId": "source-review-id",
    "sourceRunId": "source-run-id",
    "runId": "new-run-id",
    "runItemId": "new-run-item-id",
    "proposalId": "new-proposal-id",
    "revision": 1,
    "duplicate": false
  }
}
```

No new operation ID exists at preparation time. The normal `CONFIRM` flow allocates the operation identity only after the new proposal is explicitly approved.

## Authorized source prefetch and transaction boundary

Retained source bytes are verified **before** the serializable correction write transaction. This avoids holding the authorization/canonical-write transaction open across object-storage/network reads while preserving fail-closed revalidation.

The generic correction service supports an optional prefetch-capable handler through `src/services/business-assistant/correction-prefetch.ts`:

1. top-level assistant mutation access is checked;
2. the source run is read under owner/workspace scope to resolve the registered capability;
3. when the handler exposes a prefetch hook, external verification runs before the serializable transaction;
4. prefetched evidence is wrapped with the capability ID, capability version, and contract version;
5. the serializable transaction reacquires the shared business-operation barrier, fresh actor/workspace authorization, restore/pause policy, the source run, latest review/item, and the registered capability;
6. the transaction rejects the evidence if the capability/version/contract changed before preparation.

For BizFile, `prefetchBizFileCorrection` performs fresh document-read and company-update authorization **before any retained byte is downloaded**. It verifies the immutable source receipt evidence, legitimate original/finalized document pointer, source revision, and SHA-256 of each retained storage object. The prefetch returns only an evidence envelope; it grants no write authority.

Inside the transaction, BizFile re-authorizes the document and company and re-reads the current document pointer/version/revision, receipt/source evidence, review bindings, and company aggregate revision. The transactional preparer requires an exact match against the prefetched evidence before it can prepare a new proposal. No `storage.download` call occurs in the transactional correction preparer.

This design intentionally accepts a race between prefetch and transaction only by **failing closed**. A source pointer, revision, version, receipt/hash binding, capability contract, permission, restore state, or company revision change causes preparation to stop rather than silently rebasing an old review.

### Idempotent replay behavior

An advisory preflight lookup checks whether the same `REVISE` `clientRequestId` already has an action record. If so, external prefetch is skipped so an idempotent retry does not depend on storage availability.

That preflight is not authoritative: the transaction still performs the fresh actor/restore/dispatch checks and is solely responsible for deciding whether the request is an identical replay or a body-hash conflict. A preflight race therefore cannot bypass transaction-time validation.

## Server-side integrity checks

The BizFile correction preparer validates, among other things:

- requested finding exists in the selected latest review;
- finding code and factual path are allowlisted;
- submitted value exactly matches the immutable review `expected` value;
- each factual path appears at most once;
- source proposal, approval, prepared-item bindings, receipt and operation identity still match;
- committed source evidence and retained bytes match their SHA-256 binding;
- the source document pointer is still the original or legitimate finalized pointer;
- review coverage/snapshot remains bound to the committed source and company revision;
- current document and company permissions still allow the correction;
- current company baseline has not changed after the source review;
- prefetched source metadata still matches transaction-time source identity/version/revision/hash/pointer state;
- the corrected reviewed data still satisfies the canonical BizFile schema; and
- the requested factual correction still produces a canonical change.

Any stale or mismatched condition blocks preparation rather than silently rebasing the old approval.

## User experience

The correction panel shows the recorded value beside the reviewed correction and explains that creating a proposal does not immediately change company data.

After submission, a newly created proposal reports that a new approval card has been added, while an idempotent replay reports that the existing proposal was recovered. Changing the selection clears stale success/error feedback; structured values render in valid block markup; and each correction checkbox has an explicit accessible label.

After a proposal is created or recovered, the user must use the normal Business Assistant approval card to review and confirm it.

## Implementation map

| Area | File |
|---|---|
| Shared allowlist, finding codes, request limit | `src/lib/bizfile-correction-contract.ts` |
| Eligible finding presentation metadata | `src/components/business-assistant/correction-fields.ts` |
| Correction selection and proposal UI | `src/components/business-assistant/correction-panel.tsx` |
| Review-card entry and lifecycle gating | `src/components/business-assistant/run-card.tsx` |
| Client mutation hook and response validation | `src/hooks/use-business-assistant.ts` |
| Generic correction request validation | `src/lib/validations/business-assistant.ts` |
| Generic proposal orchestration | `src/services/business-assistant/correction.service.ts` |
| Optional evidence-only prefetch adapter | `src/services/business-assistant/correction-prefetch.ts` |
| BizFile prefetch and transactional correction preparation | `src/services/bizfile/application/prepare-correction.ts` |
| Generic correction boundary tests | `__tests__/services/business-assistant-correction.test.ts` |
| BizFile prefetch/rebinding tests | `__tests__/services/bizfile-correction-preparation.test.ts` |
| Correction-field UI contract tests | `__tests__/components/business-assistant-correction-fields.test.ts` |

## Remaining work

The deterministic-field UI and source-prefetch transaction boundary are implemented. This does **not** close all P12 or release work.

Remaining correction/review work includes:

- a full real-storage/real-BizFile correction execution test covering preparation, fresh approval, canonical execution, required effects, read-back, independent review, rollback/recovery, and preservation of the original source operation lifecycle/evidence;
- transaction lock-duration and timeout measurements plus concurrent baseline/source-change tests under the corrected boundary;
- identity-aware collection-row correction contracts;
- full-state/unselected-write review comparison and later-human-edit distinction;
- annotated held-out reviewer-quality evaluation; and
- the later P13-P16 operational, governed-learning, retention, deployment, and release gates.

## Verification record

PR #16 completed the deterministic-field UI and shared client/server correction contract.

PR #17 implements the retained-source prefetch/revalidation boundary and was completed through exactly ten requested review → fix → commit cycles. Before the final documentation-only cycle, its code head passed Node 24 lint, committed assistant-registry freshness, Prisma generation, TypeScript typecheck, Chromium path tests, the focused Business Assistant/BizFile contract suite, and the PostgreSQL recovery/authorization plus BizFile reconciliation/effects suites. The final PR head must still be green before merge.

No provider/mutation release gate is enabled by this work. No capability contract or application version is bumped because the change is an additive internal execution-boundary hardening and does not alter the externally approved correction request/response contract. No production deployment, migration, or live storage mutation is authorized by this document.

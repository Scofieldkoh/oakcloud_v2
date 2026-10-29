# Stage 1 Service Catalog Foundation - Final Implementation Review

**Review date:** 2026-07-30
**Review round:** 3 - verification of all remaining fixes
**Reviewed plans:**

- `docs/superpowers/plans/2026-07-30-service-agreement-roadmap.md`
- `docs/superpowers/plans/2026-07-30-service-catalog-foundation.md`

**Reviewed implementation:** Current working tree on `main` at `e599b05`
**Review constraints:** Existing workspace only; no subagent and no additional worktree
**Disposition:** **Ready to accept as the Stage 1 implementation**

## Executive Summary

All ten findings from the initial review and all three residual findings from
Round 2 are now closed.

The final three fixes were verified at their production integration points:

1. The partial editor validates against the active partial's own placeholder
   definitions. Declared `service.fields.*` values no longer block saving, their
   metadata survives a metadata-only edit, and undeclared service fields remain
   blocking errors.
2. Partial deletion, variant creation, and variant relinking now share a
   retryable serializable transaction protocol. Partial deletion and its audit
   use the same transaction client. A real PostgreSQL suite confirmed the two
   concurrency invariants and audit rollback behavior.
3. Catalog pagination derives and enforces the last valid page after the result
   set shrinks. The empty-state branch no longer traps a user on an
   out-of-range page.

The complete Stage 1 focused set passes with 15 test files and 75 tests. The
separate PostgreSQL lifecycle suite passes all 3 tests. Prisma generation is
idempotent, the production build succeeds, and the whitespace check is clean.

### Open Finding Count

| Priority | Count |
|---|---:|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |

## Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Round 3 focused regression tests | Pass | 4 files and 22 tests passed |
| PostgreSQL lifecycle concurrency suite | Pass | 1 file and 3 tests passed against a uniquely named isolated database |
| Temporary database cleanup | Pass | The isolated review database was force-dropped after the suite |
| Complete Stage 1 focused tests | Pass | 15 files and 75 tests passed with `.worktrees/**` excluded |
| Prisma generation | Pass | `npm.cmd run db:generate` exited 0 |
| Prisma generation idempotence | Pass | SHA-256 digest of `src/generated/prisma` was unchanged across generation |
| Production build and type check | Pass | `npm.cmd run build` exited 0 and generated 134 static pages |
| Tracked whitespace check | Pass | `git diff --check` exited 0 |
| New review/test file whitespace | Pass | No trailing whitespace was found |

The PostgreSQL suite was run with `TEST_DATABASE_URL` pointing to an isolated
temporary database created solely for this review. It was not pointed at the
development database.

## Round 3 Finding Validation

### SCF-REV-002-R2 - Partial Validation Ignores Its Own Service Fields

| Field | Value |
|---|---|
| **Previous priority** | P0 |
| **Round 3 status** | **Resolved** |
| **Primary implementation** | `src/app/(dashboard)/template-partials/editor/page.tsx:1214` |
| **Regression tests** | `__tests__/components/template-editor-partial-service-placeholder.test.tsx:83`, `__tests__/components/template-editor-partial-service-placeholder.test.tsx:139` |

#### Evidence

The validation memo now selects placeholders by editor mode:

```ts
const editorPlaceholders = isPartialMode
  ? partialFormData.customPlaceholders
  : formData.customPlaceholders;
```

It adds service definitions using their raw `service.fields.*` keys, continues
to namespace custom definitions under `custom.*`, and includes
`partialFormData.customPlaceholders` in the memo dependencies.

The production-level editor test loads:

- content containing `{{service.fields.software}}`;
- a matching `textarea` definition with `source`, `path`, `category`, and
  unknown forward-compatible metadata.

The test confirms that the editor reports no validation issue, leaves Save
enabled, submits a metadata-only edit, and preserves the definition. A second
test confirms an undeclared service field still disables Save.

#### Acceptance Criteria

| Criterion | Result |
|---|---|
| Declared service field opens without validation error | Pass |
| Partial can be saved without reclassifying the definition | Pass |
| Type, source, path, category, and unknown metadata survive | Pass |
| Undeclared service field remains a blocking error | Pass |
| Template-mode validation remains composition-aware | Pass |

---

### SCF-REV-004-R2 - Partial Usage Protection Is Race-Prone

| Field | Value |
|---|---|
| **Previous priority** | P1 |
| **Round 3 status** | **Resolved** |
| **Primary implementation** | `src/services/template-partial.service.ts:255`, `src/services/service-catalog/service.ts:419`, `src/services/service-catalog/service.ts:465` |
| **Unit tests** | `__tests__/services/template-partial-service-usage.test.ts`, `__tests__/services/service-catalog.service.test.ts` |
| **PostgreSQL tests** | `__tests__/integration/service-partial-lifecycle.postgres.test.ts:151`, `__tests__/integration/service-partial-lifecycle.postgres.test.ts:192`, `__tests__/integration/service-partial-lifecycle.postgres.test.ts:248` |

#### Evidence

`deleteTemplatePartial()` now performs the partial lookup, template/variant
usage reads, soft delete, and audit insert inside
`runSerializableTransaction()`. The usage helper accepts the transaction
client, and `createAuditLog()` receives that same client.

`createServiceVariant()` now starts a serializable transaction before checking
the family, partial, and unique variant code. Its `requirePartial()` call and
variant insert use the transaction client. Variant relinking already performs
its linked-partial check and update inside the same serializable protocol.

The isolated PostgreSQL suite uses coordinated trigger delays to create real
overlap between requests. All three scenarios passed:

1. Concurrent create and partial delete cannot both commit an invalid state.
2. Concurrent relink and partial delete cannot both commit an invalid state.
3. A forced audit insert failure rolls back the partial soft delete.

The expected PostgreSQL serialization conflicts were surfaced as Prisma P2034
errors and handled by the retry helper. The final database assertions found no
non-deleted variant linked to a deleted partial.

#### Acceptance Criteria

| Criterion | Result |
|---|---|
| Concurrent variant creation and partial deletion preserve the invariant | Pass |
| Concurrent variant relinking and partial deletion preserve the invariant | Pass |
| Audit failure rolls back partial deletion | Pass |
| Sequential usage errors retain referencing variant names | Pass |
| Deletion succeeds after referencing variants are archived | Pass |

---

### SCF-REV-007-R2 - Pagination Can Be Stranded After Data Shrinks

| Field | Value |
|---|---|
| **Previous priority** | P2 |
| **Round 3 status** | **Resolved** |
| **Primary implementation** | `src/components/documents/service-catalog/service-catalog-panel.tsx:91`, `src/components/documents/service-catalog/service-catalog-panel.tsx:103`, `src/components/documents/service-catalog/service-catalog-panel.tsx:242` |
| **Regression test** | `__tests__/components/service-catalog.test.tsx:183` |

#### Evidence

The panel derives:

```ts
const totalPages = Math.max(
  1,
  Math.ceil((catalog.data?.total ?? 0) / limit),
);
```

An effect clamps `page` to `totalPages` after a successful response. The
empty-state branch now requires `total === 0`; an empty out-of-range response
with a non-zero total retains navigation while the effect requests the last
valid page.

The regression test starts with 41 records, navigates to page 3, simulates a
post-archive response of 40 records and no page-3 rows, and confirms the panel
requests page 2 and renders the catalog instead of the terminal empty state.

#### Acceptance Criteria

| Criterion | Result |
|---|---|
| Archiving the final last-page item returns to the last valid page | Pass |
| Search changes reset to page 1 | Pass |
| Status changes reset to page 1 | Pass |
| A genuinely empty catalog retains the intended empty state | Pass |

## Original Finding Final Disposition

| Finding | Original priority | Final status |
|---|---:|---|
| SCF-REV-001 - Agreement composition enforcement | P0 | Resolved |
| SCF-REV-002 - Placeholder round-trip | P0 | Resolved |
| SCF-REV-003 - Nested tenant filtering | P1 | Resolved |
| SCF-REV-004 - Partial deletion while referenced | P1 | Resolved |
| SCF-REV-005 - Test coverage gaps | P1 | Resolved |
| SCF-REV-006 - Read-only wording edit | P2 | Resolved |
| SCF-REV-007 - Catalog pagination | P2 | Resolved |
| SCF-REV-008 - Variant search and inactive filter | P2 | Resolved |
| SCF-REV-009 - Mutation/audit atomicity and version metadata | P2 | Resolved |
| SCF-REV-010 - Generated Prisma whitespace | P2 | Resolved |

## Stage 1 Requirements Coverage

| Stage 1 task | Final assessment |
|---|---|
| 1. Catalog and composition schema | Complete |
| 2. Validation and public types | Complete |
| 3. Tenant-safe services and versioning | Complete |
| 4. Service placeholders and agreement slots | Complete |
| 5. Service catalog APIs | Complete |
| 6. Service catalog UI | Complete |
| 7. Verification and documentation | Complete |

## Non-Blocking Follow-Up

The PostgreSQL concurrency test intentionally skips when `TEST_DATABASE_URL`
is absent. Keep an isolated PostgreSQL database configured in CI so this
high-value regression suite runs continuously rather than only during manual
release verification.

The repository also contains a pre-existing nested `.worktrees` directory that
Vitest can discover when file-name filters overlap. Continue using
`--exclude ".worktrees/**"` for current-tree release commands, or add that path
to the central Vitest exclusion list.

## Acceptance Recommendation

Accept the current working tree as the Stage 1 implementation. Before beginning
Stage 2, commit or otherwise snapshot this reviewed state so the Stage 2 work
has a stable baseline.

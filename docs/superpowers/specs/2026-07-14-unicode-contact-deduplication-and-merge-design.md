# Unicode Contact Deduplication and Merge Design

**Date:** 2026-07-14

**Status:** Approved; revised after implementation-readiness review

## Objective

Prevent avoidable duplicate contacts across every creation path, including Chinese and other non-Latin names, and provide a safe review-and-approval workflow for merging existing duplicate records.

## Current-State Findings

Contact creation is inconsistent across the application:

- Manual contact creation and company-level quick creation call `createContact` directly and do not perform duplicate detection.
- BizFile imports call `findOrCreateContact`, but that function only matches identification type/number or corporate UEN. Name-only officers and shareholders are always created again.
- Document Vault extraction attempts vendor or customer resolution, and document approval creates a corporate contact when resolution fails.
- Vendor and customer resolution normalize comparison names with ASCII-only expressions. Chinese names normalize to an empty string, cannot match aliases or contacts, and can be recreated on later document approvals.
- The database unique constraint covers tenant, identification type, and identification number, but does not protect name-only contacts or corporate UEN creation races.

Document Vault does not create a contact at initial upload. Extraction resolves an existing counterparty when possible, and approval creates the contact when no match was found. BizFile creates or reuses officer and shareholder contacts when the reviewed import is confirmed.

## Chosen Approach

Use a centralized, tenant-scoped contact identity service shared by every contact creation path. It combines deterministic identifier matching, Unicode-safe name matching, confidence scoring, learned aliases, and explicit merge recommendations.

Alternatives considered:

1. Deterministic identifiers and exact names only. This has low false-positive risk but misses safe corporate-name variants and does not produce useful review recommendations.
2. Centralized confidence scoring with strict automatic-reuse rules and approval for ambiguous matches. This is the selected approach because it prevents common duplicates while retaining human control.
3. AI- or embedding-based identity matching. This adds cost, latency, and nondeterministic behavior without enough benefit for the current scope.

## Canonical Name Normalization

The identity service produces a comparison-only `canonicalName`; display values are not rewritten by the normalizer.

Normalization must:

- Apply Unicode NFKC normalization.
- Apply Unicode Default Case Folding through one pinned implementation shared by runtime and backfill code.
- Collapse all Unicode whitespace.
- Remove characters outside Unicode letter, combining-mark, and number categories (`\p{L}`, `\p{M}`, and `\p{N}`).
- Preserve Chinese characters and all other scripts.
- Produce a second corporate comparison form that removes only terminal legal suffix tokens from this initial list: `pte`, `private`, `ltd`, `limited`, `llp`, `llc`, `inc`, `incorporated`, `corp`, `corporation`, `co`, and `company`. Non-Latin legal suffixes are retained unless an alias is approved.
- Keep individual and corporate namespaces separate.

Examples:

- `王小明`, ` 王小明 `, and full-width/spacing variants have the same canonical name.
- Punctuation-only variants of the same corporate name have the same comparison form.
- Simplified and traditional Chinese characters are not automatically converted into one another. An approved alias can make such a pair deterministic later.

## Matching Policy

All matching is tenant-scoped and excludes soft-deleted contacts unless a merge or restoration operation explicitly requests them.

### Automatic Reuse

An existing contact is reused automatically when any of these conditions holds:

1. Identification type and normalized identification number match.
2. Normalized corporate UEN matches.
3. Tenant, contact type, and canonical name match exactly, including name-only contacts.
4. A previously approved vendor, customer, or contact alias resolves deterministically to the contact.
5. A corporate legal-suffix variant passes the strict high-confidence corporate-name rule.

Automatic reuse is prohibited when both records contain conflicting non-empty identification numbers or corporate UEN values.

When multiple existing contacts satisfy the same high-confidence name rule, the service selects the recommended master deterministically using the master-selection policy below for new links. It also returns the complete duplicate group for review; it does not silently merge the existing records.

### Recommendations Only

The following conditions create recommendations but never merge automatically:

- Near or fuzzy name matches.
- Simplified/traditional Chinese variants without an approved alias.
- Exact names with conflicting strong identifiers.
- Other high-similarity records for which the automatic-reuse rule is not satisfied.

Short Chinese names are not automatically matched through fuzzy similarity because a one-character difference can identify a different person. Exact canonical Chinese name matches remain eligible for automatic reuse.

### Scores and Thresholds

The scoring contract is deterministic:

- Matching normalized identification type/number: `1.00`, automatic reuse.
- Matching normalized corporate UEN: `1.00`, automatic reuse.
- Approved alias: `1.00`, automatic reuse.
- Exact tenant/contact-type/canonical-name match: `1.00`, automatic reuse.
- Corporate names differing only by an allowed terminal legal suffix: `0.99`, automatic reuse.
- Other fuzzy names: recommendation only when similarity is at least `0.93`, the canonical name contains at least five Unicode code points, both names use the same script class, and any token guard passes.
- Short CJK names below five code points: exact matching or an approved alias only; fuzzy similarity never triggers automatic reuse.
- Scores below `0.93`: no recommendation.

Identifier conflicts override every name score. Mixed-script confusables and transliterations are not treated as equivalent automatically.

### Legitimate Same-Name Contacts

Exact name-only reuse remains the default, including for individuals, but user-facing creation paths provide an escape hatch:

- Manual and company-level creation show the proposed existing contact and allow `Use existing` or `Create separate contact`.
- BizFile review shows the proposed contact beside each officer or shareholder and allows the reviewer to create a separate contact before confirmation.
- Document Vault counterparties are corporate contacts and reuse exact canonical corporate names automatically on approval.
- `Create separate contact` requires explicit confirmation, records the override reason, and suppresses that pair as a duplicate recommendation until either identity fingerprint changes.
- A later conflicting identifier never enriches or reuses the name-only match; it creates a conflict for review.

### Master Selection

The recommended master is selected in this order:

1. A record with a valid, non-conflicting identification number or corporate UEN.
2. The record with more populated identity fields and contact details.
3. The record with more company, document, and workflow relationships.
4. The oldest record as a stable final tie-breaker.

The reviewer may choose a different master before approval.

## Shared Creation Flow

The centralized identity service is used by:

- Manual contact creation.
- Company-level quick contact creation.
- BizFile officer and shareholder creation in both existing-company and new-company confirmation paths.
- Document Vault vendor creation for accounts-payable documents.
- Document Vault customer creation for accounts-receivable documents.

Each creation request follows this flow:

1. Validate and normalize identifiers and the canonical name.
2. Build lock keys for tenant/contact type/canonical name and every available normalized identifier.
3. Acquire all PostgreSQL transaction-scoped advisory locks in sorted order. The canonical-name lock is always acquired; identifier locks are additional, never alternatives.
4. Recheck matching contacts inside the transaction.
5. Reuse the deterministic match or create one new contact.
6. Enrich the reused or newly created contact from validated source data without overwriting conflicting non-empty values.
7. Return confidence, matching reasons, captured-field results, conflicts, and any reviewable duplicate group.
8. Preserve or learn approved aliases where the existing vendor/customer workflow requires them.

This lock prevents simultaneous document approvals or imports from creating the same canonical contact concurrently.

Because the database unique key covers `(tenantId, identificationType, identificationNumber)` even for soft-deleted rows, identity resolution checks that exact raw identifier outside the active-contact scope before creating. A deleted or inactive contact holding the same identifier is restored and reused in the same transaction; an identifier already assigned to a contact of the other type is returned as a conflict rather than creating a second row.

## Source Data Capture and Enrichment

Every creation path supplies one typed contact identity candidate containing all available fields:

- Contact type, first name, last name, full or corporate name, and alias.
- Identification type and identification number, or corporate UEN/registration number.
- Nationality, date of birth, and full address.
- Email and phone contact details.
- Source type, source record ID, extraction confidence, and the user who confirmed the source.

Identifier normalization is type-specific. All identifiers receive NFKC normalization, trimming, and uppercase comparison. NRIC, FIN, and Singapore UEN comparison additionally removes spaces and hyphens. Passport and `OTHER` identifiers preserve internal punctuation after whitespace normalization. Values containing mask characters, known placeholder phrases, or too few visible alphanumeric characters are not deterministic keys.

Source-specific requirements:

- BizFile passes every available officer/shareholder identifier, identification type, nationality, address, and corporate registration number instead of passing name alone. Masked or placeholder identifiers are retained in source metadata but are not used as deterministic IDs.
- Document extraction adds typed counterparty fields for identification type, identification number or UEN, address, email, and phone. A validated `DocumentRevision.counterpartyIdentity` JSON field persists these draft values plus per-field confidence so the reviewer can correct them and approval can pass them to the identity service.
- Manual and company-level creation pass all entered identity and contact-detail fields through the same service.
- Other future importers must use the typed candidate rather than calling `prisma.contact.create` directly.

Only identifiers that pass format validation and the configured extraction-confidence threshold of `0.90` may become deterministic match keys. Lower-confidence values remain visible for review but do not populate the canonical contact automatically.

When a contact is reused, validated source data fills empty master fields. Existing non-empty values are never silently overwritten. Equal normalized contact details are consolidated; new distinct email or phone values are added. Conflicting identifiers, names, dates of birth, or addresses are returned for review. Every enrichment records its source and changed fields in the audit log.

## Persistence and Backfill

Add a nullable `canonicalName` field to `Contact` and an index covering tenant, contact type, deletion state, and canonical name. New and updated contacts always populate it. Add PostgreSQL `pg_trgm` support and an index for bounded fuzzy recommendation lookup; exact matching continues to use the canonical-name index.

Backfill existing contacts in bounded batches through the application normalizer so the stored value exactly matches runtime behavior for every script. The backfill is idempotent and reports processed, updated, skipped, and failed counts.

Rollout is staged:

1. Add the nullable field and indexes.
2. Deploy writes plus a temporary dual-read fallback that computes canonical names for legacy null rows.
3. Run the resumable backfill and verify that no eligible active contacts remain null.
4. Remove the dual-read fallback and make `canonicalName` required in a later migration.

The migration does not add a unique name constraint because different people or companies can legitimately have the same name and existing duplicates must remain deployable. Existing duplicate groups are resolved through review.

Rejected recommendations are stored as tenant-scoped pair decisions using stable, sorted contact IDs plus a fingerprint for each contact. The fingerprint hashes canonical name, contact type, normalized identifiers, date of birth, address, and normalized contact details. A rejection is suppressed only while both fingerprints remain unchanged.

Recommendation discovery avoids all-pairs scans. Exact groups use indexed canonical names and identifiers. Fuzzy candidates use indexed trigram lookup, contact type, script class, and length bounds, then run the pure scorer on the bounded result set. Results are paginated and computed per tenant.

Add an immutable `ContactMergeOperation` ledger containing an idempotency key, tenant, master contact ID and snapshot, source contact IDs and snapshots, fingerprints, field decisions, moved-record counts, matching reasons, approving user, and timestamp. Source IDs are stored as values rather than foreign keys because approved merged source contacts are hard-deleted.

## Duplicate Review Experience

The Contacts page adds a `Review duplicates` action. It opens a responsive review workflow ordered by descending confidence.

Each group shows:

- Confidence and the reasons for the recommendation.
- Names, aliases, identifiers, addresses, nationality, and birth date.
- Contact details and linked companies.
- Counts of officer, shareholder, charge, note, document, and alias references.
- Identifier conflicts that block approval.
- The recommended master and controls to choose another master.

The reviewer may approve the merge, reject the recommendation, or leave it pending. Conflicting non-empty fields are presented for explicit selection. Non-empty master fields are retained by default; missing master fields are filled from duplicates. A group of two or more duplicate sources is approved as one atomic group merge, not as sequential pair merges.

The interface uses existing Button, Modal, confirmation, responsive card, table, toast, and permission patterns from the design guidelines. Interactive controls meet the existing mobile touch-target and keyboard-accessibility requirements.

## Merge Transaction

Approval recalculates the recommendation and verifies tenant, permission, `updatedAt` snapshots, deletion state, and identifier conflicts immediately before mutation. The request includes a client-generated idempotency key protected by a unique database constraint. Repeating a completed request returns the existing merge result; a competing request with changed membership is rejected as stale.

One database transaction:

1. Applies the approved field selections to the master.
2. Consolidates active `CompanyContact` rows by company and relationship. The oldest active row survives; `isPrimary` and `isPoc` are OR-combined. Soft-deleted relationship rows are discarded with the source.
3. Reassigns `CompanyOfficer`, `CompanyShareholder`, and `CompanyCharge` references. Their denormalized name fields remain unchanged as historical snapshots.
4. Consolidates contact details by tenant, company scope, detail type, and normalized value. Purposes are unioned, `isPoc` is OR-combined, and an existing master primary wins; otherwise the oldest primary wins. Distinct values are retained.
5. Reassigns note tabs without merging content, preserving each note and ordering master notes before source notes.
6. Updates every non-foreign-key pointer, including document revision `vendorId` and `customerId`, and vendor/customer alias `normalizedContactId`. Document revision display names remain historical snapshots.
7. Consolidates aliases by tenant, company scope, and canonical raw name; the highest confidence survives and points to the master.
8. Asserts that no known foreign-key or non-foreign-key reference still points to a source contact.
9. Writes the immutable `ContactMergeOperation` ledger and an audit event using a new `MERGE` audit action inside the same transaction.
10. Hard-deletes all approved source contacts. Existing audit records remain because they store entity IDs as values rather than contact foreign keys.

The merge ledger preserves traceability after hard deletion. Hard deletion is irreversible through the normal restore-contact function, so the confirmation explicitly states that only the selected master will remain.

## Error Handling and Safety

- A merge is atomic. Any validation, relationship, or database error rolls back all changes.
- A stale recommendation is recalculated before approval, and the UI asks for review again if material inputs changed.
- Duplicate submissions are idempotent; concurrent approvals lock the same contacts in sorted ID order.
- Conflicting strong identifiers block approval until the reviewer explicitly selects or clears the correct value.
- Cross-tenant candidates and mutations are rejected.
- A failed review request remains open and displays a recoverable error.
- Creation-path matching failures do not silently bypass identity controls. They return an actionable error and leave the transaction unchanged.
- Exact high-confidence reuse does not imply automatic merging of already duplicated records.
- Hard deletion occurs only after reference assertions, merge-ledger creation, and audit creation succeed in the same transaction.

## API and Service Boundaries

The implementation separates responsibilities:

- A pure Unicode normalization module owns canonicalization.
- A pure scoring module owns match reasons, confidence, conflict detection, and master ranking.
- A contact identity service owns tenant-scoped lookup, advisory locking, reuse, and creation.
- A duplicate recommendation service owns grouped discovery and rejected-pair suppression.
- A merge service owns preview validation, reference inventory, idempotency, ledger creation, and the merge transaction.
- Thin API routes own authentication, permission checks, validation, and response mapping.
- Contact hooks and review components own client state and presentation.

Vendor and customer resolution retain their alias behavior but delegate name normalization and direct-contact scoring to the shared modules.

## Permissions and Auditing

Reading recommendations requires contact read access plus workspace-wide company access. Approving or rejecting recommendations requires contact update access and either workspace-administrator status or explicit all-company access. Company-scoped users cannot view duplicate groups containing hidden relationships or execute merges. Merge operations verify access to every affected tenant-scoped record.

Creation, reuse, enrichment, separate-contact overrides, recommendation rejection, and merge approval produce auditable events using existing audit infrastructure. Add a `MERGE` audit action. Audit metadata records whether a contact was created, reused by identifier, reused by name, resolved by alias, enriched from a source, or merged after approval. Merge audit creation uses the transaction-aware audit API.

## Test Strategy

### Unit Tests

- NFKC and full-width normalization.
- Chinese, Latin, and mixed-script names.
- Unicode whitespace and punctuation variants.
- Corporate legal-suffix variants.
- Simplified/traditional Chinese remaining distinct until aliased.
- Exact name-only automatic reuse.
- Short Chinese fuzzy-match safeguards.
- Identifier conflict detection.
- Deterministic master ranking.
- Rejected-pair invalidation when identity data changes.
- Exact score thresholds and mixed-script safeguards.
- Identifier validation, masked-ID rejection, and extraction-confidence handling.

### Service and Integration Tests

- Manual creation and company quick creation use the identity service.
- Both BizFile confirmation paths reuse Chinese name-only contacts.
- BizFile and Document Vault capture and enrich valid IDs and other available contact data.
- Document Vault extraction resolves without creating, and approval reuses or creates exactly one corporate contact.
- Accounts-payable vendor and accounts-receivable customer paths behave consistently.
- Simultaneous approvals result in one canonical contact.
- Tenant and permission boundaries are enforced.
- Existing vendor/customer aliases remain functional with Unicode names.
- Backfill is batched and idempotent.
- Dual-read rollout behavior and bounded indexed recommendation lookup.
- Explicit separate-contact overrides prevent incorrect same-name reuse.

### Merge Tests

- Every contact relationship is moved or consolidated correctly.
- Document revision IDs and alias pointers are updated.
- Conflicting company relationships do not violate uniqueness.
- Field selections and missing-field enrichment are applied.
- Source records are hard-deleted only after all references move and reference assertions pass.
- Merge ledger snapshots preserve deleted-source traceability.
- Repeated or concurrent approvals are idempotent.
- Audit metadata is complete.
- Any forced failure rolls back the whole merge.
- A stale recommendation cannot be approved without recalculation.

### Component and Browser Tests

- Recommendation list and confidence reasons render correctly.
- Recommended and alternate master selection works.
- Conflicting fields require explicit resolution.
- Approval, rejection, pending state, error recovery, and query invalidation work.
- Keyboard navigation, focus management, and responsive mobile presentation follow the design guidelines.

## Documentation Updates

Update the existing documentation index and relevant contact/database/API references under `docs/` to describe canonical names, creation-path reuse, recommendation review, merge behavior, permissions, and backfill operation. Do not create documentation outside `docs/`.

## Out of Scope

- Fully automatic fuzzy merging.
- Transliteration-based automatic identity matching.
- Automatic simplified/traditional Chinese conversion.
- Cross-tenant contact matching or merging.
- Physical deletion of contacts except source records in an explicitly approved merge.
- AI or embedding-based matching.

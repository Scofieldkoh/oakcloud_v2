# Unicode Contact Deduplication and Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate contacts across manual creation, company quick creation, BizFile, and Document Vault while adding an administrator-approved, auditable hard-delete merge workflow.

**Architecture:** Pure Unicode normalization and scoring modules feed a tenant-scoped identity service that serializes creation with PostgreSQL advisory locks. Recommendation discovery and merge execution remain separate services: discovery is read-oriented and suppresses rejected fingerprints, while merge performs one idempotent transaction that consolidates references, writes immutable snapshots, and hard-deletes approved sources.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.7, Prisma 7/PostgreSQL, Zod, TanStack Query, Vitest, Testing Library, `unicode-case-folding@1.1.1`, PostgreSQL `pg_trgm`.

## Global Constraints

- Preserve Chinese and every other Unicode script through NFKC plus Unicode Default Case Folding.
- Exact canonical name-only matches are automatic reuse candidates; fuzzy names never merge automatically.
- Strong identifier conflicts override every name match.
- All creation paths capture and enrich IDs/UENs and other available contact data.
- Merged source contacts are hard-deleted only inside the approved atomic merge transaction.
- Merge approval requires contact update permission plus workspace-admin or all-company access.
- Do not modify or discard the unrelated BizFile work already present in the working tree; reconcile edits in overlapping files carefully.
- Update documentation only under `docs/`.

---

## File Structure

### New files

- `src/types/contact-identity.ts` — shared candidate, match, decision, recommendation, and merge request/response types.
- `src/lib/contact-identity-normalization.ts` — pure Unicode name, identifier, contact-detail, script, and fingerprint normalization.
- `src/lib/contact-identity-matching.ts` — pure scores, conflict detection, reasons, and master ranking.
- `src/services/contact-identity.service.ts` — advisory locking, deterministic lookup, create/reuse, and source enrichment.
- `src/services/contact-duplicate.service.ts` — indexed group discovery, rejected-fingerprint suppression, and preview data.
- `src/services/contact-merge.service.ts` — merge validation, consolidation, reference assertions, ledger, audit, and hard deletion.
- `src/lib/validations/contact-duplicate.ts` — match-preview, rejection, and merge request schemas.
- `src/app/api/contacts/match-preview/route.ts` — batch preview for manual/BizFile decisions.
- `src/app/api/contacts/duplicates/route.ts` — paginated duplicate recommendations.
- `src/app/api/contacts/duplicates/reject/route.ts` — fingerprint-bound rejection.
- `src/app/api/contacts/merge/route.ts` — idempotent approved group merge.
- `src/components/contacts/contact-match-dialog.tsx` — reuse/create-separate decision dialog.
- `src/components/contacts/contact-duplicate-review-modal.tsx` — recommendation review and merge UI.
- `scripts/backfill-contact-canonical-names.ts` — resumable canonical-name backfill.
- `prisma/migrations/20260714090000_contact_identity_and_merge/migration.sql` — schema, `pg_trgm`, tables, indexes, and audit enum migration.
- Focused tests under `__tests__/lib`, `__tests__/services`, `__tests__/api`, and `__tests__/components` named in each task.

### Existing files with focused changes

- `package.json`, `package-lock.json` — pinned case-folding dependency and backfill script.
- `prisma/schema.prisma` — `canonicalName`, `counterpartyIdentity`, decision/ledger models, `MERGE` action.
- `src/services/contact.service.ts` — delegate creation to identity service and pass audit transactions.
- `src/services/vendor-resolution.service.ts`, `src/services/customer-resolution.service.ts` — shared Unicode scoring and identity-service create/enrich.
- `src/services/bizfile/processor.ts`, `src/services/bizfile/types.ts`, `src/lib/validations/bizfile-review.ts` — candidate data and explicit same-name overrides.
- `src/services/document-extraction.service.ts`, `src/services/document-revision.service.ts` — extract, persist, edit, and approve counterparty identity data.
- Contact and processing API routes, hooks, pages, and components listed in Tasks 4–9.
- `docs/INDEX.md`, `docs/reference/API_REFERENCE.md`, `docs/reference/DATABASE_SCHEMA.md` — operational and API documentation.

---

### Task 1: Unicode Identity Primitives

**Files:**
- Create: `src/types/contact-identity.ts`
- Create: `src/lib/contact-identity-normalization.ts`
- Create: `src/lib/contact-identity-matching.ts`
- Create: `__tests__/lib/contact-identity-normalization.test.ts`
- Create: `__tests__/lib/contact-identity-matching.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `canonicalizeContactName`, `canonicalizeCorporateComparisonName`, `normalizeContactIdentifier`, `isDeterministicIdentifier`, `normalizeContactDetailValue`, `buildContactIdentityFingerprint`, `scoreContactIdentityMatch`, `rankContactMaster`.
- Produces: `ContactIdentityCandidate`, `ContactIdentityRecord`, `ContactMatchResult`, `ContactMatchReason`, `ContactResolutionDecision`.

- [ ] **Step 1: Install the pinned Unicode implementation**

Run: `npm install --save-exact unicode-case-folding@1.1.1`

Expected: `package.json` and `package-lock.json` record exact dependency `1.1.1`; no audit failure stops installation.

- [ ] **Step 2: Write failing normalization tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  canonicalizeContactName,
  canonicalizeCorporateComparisonName,
  normalizeContactIdentifier,
  isDeterministicIdentifier,
} from '@/lib/contact-identity-normalization';

describe('contact identity normalization', () => {
  it('preserves and normalizes Chinese names', () => {
    expect(canonicalizeContactName(' 王\u3000小明 ')).toBe('王小明');
    expect(canonicalizeContactName('ＷＡＮＧ 王')).toBe('wang王');
  });

  it('uses Unicode default case folding', () => {
    expect(canonicalizeContactName('Straße')).toBe('strasse');
  });

  it('removes only terminal corporate suffixes from comparison form', () => {
    expect(canonicalizeCorporateComparisonName('Acme Pte. Ltd.')).toBe('acme');
    expect(canonicalizeCorporateComparisonName('有限公司')).toBe('有限公司');
  });

  it('normalizes strong identifiers by type and rejects masks', () => {
    expect(normalizeContactIdentifier('S 123-4567 A', 'NRIC')).toBe('S1234567A');
    expect(normalizeContactIdentifier('ab-12 34', 'PASSPORT')).toBe('AB-12 34');
    expect(isDeterministicIdentifier('S****567A', 'NRIC')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests and verify RED**

Run: `npm test -- __tests__/lib/contact-identity-normalization.test.ts`

Expected: FAIL because `@/lib/contact-identity-normalization` does not exist.

- [ ] **Step 4: Implement the pure normalizer and shared types**

```ts
import { caseFold } from 'unicode-case-folding';
import type { IdentificationType } from '@/generated/prisma';

const LEGAL_SUFFIXES = ['incorporated', 'corporation', 'private', 'limited', 'company', 'corp', 'pte', 'ltd', 'llp', 'llc', 'inc', 'co'] as const;
const MASK_OR_PLACEHOLDER = /[*•●]|\b(?:unknown|not available|n\/?a|redacted|masked)\b/iu;

export function canonicalizeContactName(value: string | null | undefined): string {
  return caseFold((value ?? '').normalize('NFKC')).replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

export function canonicalizeCorporateComparisonName(value: string | null | undefined): string {
  const folded = caseFold((value ?? '').normalize('NFKC'));
  const tokens = folded.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().split(/\s+/u).filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.includes(tokens[tokens.length - 1] as typeof LEGAL_SUFFIXES[number])) tokens.pop();
  return tokens.join('');
}

export function normalizeContactIdentifier(value: string | null | undefined, type: IdentificationType | null | undefined): string | null {
  const normalized = (value ?? '').normalize('NFKC').trim().toUpperCase();
  if (!normalized) return null;
  return type === 'NRIC' || type === 'FIN' || type === 'UEN'
    ? normalized.replace(/[\s-]+/g, '')
    : normalized.replace(/\s+/g, ' ');
}

export function isDeterministicIdentifier(value: string | null | undefined, type: IdentificationType | null | undefined): boolean {
  const normalized = normalizeContactIdentifier(value, type);
  return Boolean(normalized && !MASK_OR_PLACEHOLDER.test(normalized) && (normalized.match(/[A-Z0-9]/g)?.length ?? 0) >= 5);
}
```

Define the shared types exactly around source (`MANUAL | COMPANY_QUICK_CREATE | BIZFILE | DOCUMENT_VAULT`), contact fields, detail fields, per-field confidence, decision (`AUTO | REUSE | CREATE_SEPARATE`), match score/reasons, conflicts, and fingerprints. Implement matching with the approved `1.00`, `0.99`, and `0.93` thresholds; return zero on identifier conflicts; never auto-accept fuzzy CJK; rank masters by strong ID, populated fields, relationship count, then `createdAt`/ID.

```ts
export type ContactIdentitySource = 'MANUAL' | 'COMPANY_QUICK_CREATE' | 'BIZFILE' | 'DOCUMENT_VAULT';
export type ContactResolutionDecision =
  | { action: 'AUTO' }
  | { action: 'REUSE'; contactId: string }
  | { action: 'CREATE_SEPARATE'; reason: string };
export type ContactMatchReason = 'IDENTIFIER' | 'CORPORATE_UEN' | 'APPROVED_ALIAS' | 'EXACT_CANONICAL_NAME' | 'CORPORATE_SUFFIX_VARIANT' | 'FUZZY_NAME';

export interface ContactIdentityConflict {
  field: 'identificationNumber' | 'corporateUen' | 'dateOfBirth' | 'fullAddress' | 'firstName' | 'lastName' | 'corporateName';
  incomingValue: string | null;
  existingValue: string | null;
}

export interface ContactIdentityCandidate {
  source: ContactIdentitySource;
  sourceRecordId?: string;
  contactType: 'INDIVIDUAL' | 'CORPORATE';
  firstName?: string | null;
  lastName?: string | null;
  corporateName?: string | null;
  alias?: string | null;
  identificationType?: IdentificationType | null;
  identificationNumber?: string | null;
  corporateUen?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  fullAddress?: string | null;
  contactDetails?: Array<{ detailType: ContactDetailType; value: string; companyId?: string; purposes?: string[]; isPrimary?: boolean; isPoc?: boolean }>;
  confidence?: Partial<Record<'identificationNumber' | 'corporateUen' | 'fullAddress' | 'email' | 'phone', number>>;
}

export interface ContactIdentityRecord extends ContactIdentityCandidate {
  id: string;
  tenantId: string;
  canonicalName: string;
  createdAt: Date;
  updatedAt: Date;
  relationshipCount: number;
  populatedFieldCount: number;
}

export interface ContactMatchResult {
  contactId: string;
  score: number;
  automatic: boolean;
  blockedByIdentifierConflict: boolean;
  reasons: ContactMatchReason[];
  conflicts: ContactIdentityConflict[];
}
```

- [ ] **Step 5: Add matching tests, run both files, and verify GREEN**

```ts
it('auto-reuses exact Chinese names but only recommends near Chinese names', () => {
  expect(scoreContactIdentityMatch(candidate('王小明'), record('王小明')).automatic).toBe(true);
  const near = scoreContactIdentityMatch(candidate('王小明'), record('王小敏'));
  expect(near.automatic).toBe(false);
});

it('lets identifier conflicts override exact names', () => {
  const result = scoreContactIdentityMatch(
    candidate('王小明', 'S1234567A'),
    record('王小明', 'S7654321B')
  );
  expect(result.blockedByIdentifierConflict).toBe(true);
  expect(result.automatic).toBe(false);
});
```

Run: `npm test -- __tests__/lib/contact-identity-normalization.test.ts __tests__/lib/contact-identity-matching.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/types/contact-identity.ts src/lib/contact-identity-normalization.ts src/lib/contact-identity-matching.ts __tests__/lib/contact-identity-normalization.test.ts __tests__/lib/contact-identity-matching.test.ts
git commit -m "feat(contacts): add Unicode identity primitives"
```

---

### Task 2: Persistence, Indexes, and Merge Ledger

**Files:**
- Modify: `prisma/schema.prisma:384-420,1332-1396,1422-1453,2749-2781`
- Create: `prisma/migrations/20260714090000_contact_identity_and_merge/migration.sql`
- Create: `__tests__/lib/contact-identity-schema.test.ts`
- Regenerate: `src/generated/prisma/**` with Prisma CLI

**Interfaces:**
- Produces: `Contact.canonicalName`, `DocumentRevision.counterpartyIdentity`, `ContactDuplicateDecision`, `ContactMergeOperation`, `AuditAction.MERGE`.

- [ ] **Step 1: Write a failing schema contract test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contact identity Prisma schema', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');

  it('stores canonical names, counterparty identity, decisions, and merge ledgers', () => {
    expect(schema).toContain('canonicalName');
    expect(schema).toContain('counterpartyIdentity');
    expect(schema).toContain('model ContactDuplicateDecision');
    expect(schema).toContain('model ContactMergeOperation');
    expect(schema).toMatch(/enum AuditAction[\s\S]*\bMERGE\b/);
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/lib/contact-identity-schema.test.ts`

Expected: FAIL on missing `canonicalName`.

- [ ] **Step 3: Add the Prisma models and migration**

Add nullable `canonicalName String?`, `counterpartyIdentity Json? @map("counterparty_identity")`, `MERGE`, and these model contracts:

```prisma
model ContactDuplicateDecision {
  id               String   @id @default(uuid())
  tenantId         String
  leftContactId    String
  rightContactId   String
  leftFingerprint  String
  rightFingerprint String
  decision         String
  reason           String
  decidedById      String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([tenantId, leftContactId, rightContactId])
  @@index([tenantId, updatedAt])
  @@map("contact_duplicate_decisions")
}

model ContactMergeOperation {
  id                String   @id @default(uuid())
  tenantId          String
  idempotencyKey    String
  masterContactId   String
  masterSnapshot    Json
  sourceContactIds  String[]
  sourceSnapshots   Json
  fingerprints      Json
  fieldDecisions    Json
  movedRecordCounts Json
  matchingReasons   Json
  approvedById      String
  approvedAt        DateTime @default(now())

  @@unique([tenantId, idempotencyKey])
  @@index([tenantId, approvedAt])
  @@index([masterContactId])
  @@map("contact_merge_operations")
}
```

Migration SQL must enable `pg_trgm`, add columns, tables, enum value, a B-tree exact-match index on `(tenantId, contactType, deletedAt, canonicalName)`, and a partial GIN trigram index on active non-null canonical names.

- [ ] **Step 4: Validate, generate, and verify GREEN**

Run: `npx prisma format && npx prisma validate && npm run db:generate && npm test -- __tests__/lib/contact-identity-schema.test.ts`

Expected: schema validation succeeds, generated client updates, test PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260714090000_contact_identity_and_merge src/generated/prisma __tests__/lib/contact-identity-schema.test.ts
git commit -m "feat(contacts): add identity and merge persistence"
```

---

### Task 3: Tenant-Scoped Resolve, Create, and Enrich Service

**Files:**
- Create: `src/services/contact-identity.service.ts`
- Create: `__tests__/services/contact-identity.service.test.ts`
- Modify: `src/services/contact.service.ts:42-193`
- Modify: `src/services/contact-detail.service.ts`
- Modify: `src/lib/audit.ts` only if an existing call cannot pass its transaction cleanly

**Interfaces:**
- Consumes: Task 1 primitives and Task 2 persistence.
- Produces: `previewContactIdentity(candidate, tenantId, tx?)` and `resolveOrCreateContact(candidate, decision, params)`.

```ts
export interface ResolveContactIdentityResult {
  contact: Contact;
  outcome: 'CREATED' | 'REUSED_IDENTIFIER' | 'REUSED_NAME' | 'REUSED_ALIAS' | 'CREATED_SEPARATE';
  match: ContactMatchResult | null;
  enrichedFields: string[];
  conflicts: ContactIdentityConflict[];
}

export async function resolveOrCreateContact(
  candidate: ContactIdentityCandidate,
  decision: ContactResolutionDecision,
  params: TenantAwareParams
): Promise<ResolveContactIdentityResult>;
```

- [ ] **Step 1: Write failing service tests**

Cover exact Chinese name reuse, identifier-first reuse, conflict blocking, explicit separate creation, empty-field enrichment, non-overwrite of conflicts, detail consolidation, all lock keys in sorted order, and audit creation through the same transaction.

```ts
it('reuses and enriches an exact Chinese name-only contact', async () => {
  prisma.contact.findMany.mockResolvedValue([existingContact({ fullName: '王小明', identificationNumber: null })]);
  const result = await resolveOrCreateContact(
    candidate({ fullName: '王小明', identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
    { action: 'AUTO' },
    params
  );
  expect(result.outcome).toBe('REUSED_NAME');
  expect(tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ identificationNumber: 'S1234567A' }) }));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/services/contact-identity.service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement locking, lookup, creation, and enrichment**

Use `prisma.$transaction` unless `params.tx` is supplied. Construct canonical and usable identifier keys, sort them, and execute for each:

```ts
await tx.$executeRaw(
  Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
);
```

Requery active tenant contacts after locks. Select deterministic matches using Task 1 scores. On `CREATE_SEPARATE`, require reason and write a decision after the new contact exists. On reuse, fill only null/blank fields, create only distinct normalized details, and return conflicts without overwriting. Pass `tx` to every `createAuditLog` and `createContactDetail` call. Make legacy `findOrCreateContact` a compatibility wrapper around this service and change direct creation callers in later tasks.

- [ ] **Step 4: Run focused and existing service tests**

Run: `npm test -- __tests__/services/contact-identity.service.test.ts __tests__/services/company.service.test.ts __tests__/services/vendor-resolution.service.test.ts __tests__/services/customer-resolution.service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/contact-identity.service.ts src/services/contact.service.ts src/services/contact-detail.service.ts src/lib/audit.ts __tests__/services/contact-identity.service.test.ts
git commit -m "feat(contacts): centralize contact resolution and enrichment"
```

---

### Task 4: Manual and Company Quick Creation Decisions

**Files:**
- Create: `src/components/contacts/contact-match-dialog.tsx`
- Create: `__tests__/api/contacts-create-route.test.ts`
- Create: `__tests__/components/contact-match-dialog.test.tsx`
- Modify: `src/lib/validations/contact.ts`
- Modify: `src/app/api/contacts/route.ts:63-127`
- Modify: `src/app/api/companies/[id]/contact-details/create-contact/route.ts`
- Modify: `src/hooks/use-contacts.ts:112-123,259-268`
- Modify: `src/app/(dashboard)/contacts/new/page.tsx:228-239`
- Modify: `src/components/companies/contact-details/add-contact-modal.tsx`

**Interfaces:**
- Consumes: `resolveOrCreateContact`.
- Produces: HTTP `409 CONTACT_MATCH_REVIEW_REQUIRED` with `match`, and resubmission decision `{ action, contactId?, reason? }`.

- [ ] **Step 1: Write route and dialog tests first**

```ts
it('returns a reviewable 409 before reusing a manual name-only match', async () => {
  previewContactIdentity.mockResolvedValue(exactChineseMatch);
  const response = await POST(requestWith({ contactType: 'INDIVIDUAL', firstName: '王小明' }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'CONTACT_MATCH_REVIEW_REQUIRED' });
});

it('offers use-existing and create-separate actions', async () => {
  render(<ContactMatchDialog match={match} open onUseExisting={useExisting} onCreateSeparate={createSeparate} onClose={close} />);
  expect(screen.getByRole('button', { name: /use existing/i })).toBeVisible();
  expect(screen.getByRole('button', { name: /create separate/i })).toBeVisible();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/api/contacts-create-route.test.ts __tests__/components/contact-match-dialog.test.tsx`

Expected: FAIL on missing behavior/component.

- [ ] **Step 3: Implement API decisions and accessible dialog**

Extend create validation with:

```ts
const contactResolutionSchema = z.object({
  action: z.enum(['REUSE', 'CREATE_SEPARATE']),
  contactId: z.string().uuid().optional(),
  reason: z.string().trim().min(10).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'CREATE_SEPARATE' && !value.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Reason is required' });
});
```

Both routes preview when the request has no decision, return 409 for a reviewable exact match, and call `resolveOrCreateContact` on resubmission. Company quick creation must still link the resolved contact and create submitted details atomically. The dialog uses existing `Modal`, `Button`, `FormInput`, focus management, and a required reason for separate creation.

- [ ] **Step 4: Wire pages/hooks and verify GREEN**

The hook throws a typed `ContactMatchReviewRequiredError` carrying the match. Both UIs catch it, open the dialog, and resubmit the same payload with the selected decision.

Run: `npm test -- __tests__/api/contacts-create-route.test.ts __tests__/components/contact-match-dialog.test.tsx __tests__/lib/contact.validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- src/lib/validations/contact.ts src/app/api/contacts/route.ts ':(literal)src/app/api/companies/[id]/contact-details/create-contact/route.ts' src/hooks/use-contacts.ts 'src/app/(dashboard)/contacts/new/page.tsx' src/components/companies/contact-details/add-contact-modal.tsx src/components/contacts/contact-match-dialog.tsx __tests__/api/contacts-create-route.test.ts __tests__/components/contact-match-dialog.test.tsx __tests__/lib/contact.validation.test.ts
git commit -m "feat(contacts): review manual name-only matches"
```

---

### Task 5: BizFile Identity Preview and Comprehensive Capture

**Files:**
- Create: `src/app/api/contacts/match-preview/route.ts`
- Create: `__tests__/api/contact-match-preview-route.test.ts`
- Create: `__tests__/services/bizfile-contact-resolution.test.ts`
- Modify: `src/services/bizfile/types.ts`
- Modify: `src/lib/validations/bizfile-review.ts:115-141`
- Modify: `src/services/bizfile/processor.ts:240-395,881-975`
- Modify: `src/app/api/documents/[documentId]/confirm/route.ts`
- Modify: `src/app/api/documents/[documentId]/apply-update/route.ts`
- Modify carefully: `src/components/companies/bizfile-review/bizfile-review-sections.tsx:502-705`
- Modify carefully: `src/components/companies/bizfile-review/bizfile-review-workspace.tsx:209-230`
- Modify carefully: `src/app/(dashboard)/companies/upload/page.tsx`

**Interfaces:**
- Produces batch preview `POST /api/contacts/match-preview` with `{ candidates: ContactIdentityCandidate[] }`.
- Adds per officer/shareholder `contactResolution?: { action: 'REUSE' | 'CREATE_SEPARATE'; contactId?: string; reason?: string }`.

- [ ] **Step 1: Write failing BizFile tests**

Test that both existing-company and new-company processors pass ID type/number, nationality, address, corporate UEN, source record path, and decision to `resolveOrCreateContact`; test exact Chinese reuse and explicit separate creation.

```ts
expect(resolveOrCreateContact).toHaveBeenCalledWith(
  expect.objectContaining({
    fullName: '王小明',
    identificationType: 'NRIC',
    identificationNumber: 'S1234567A',
    source: 'BIZFILE',
  }),
  expect.objectContaining({ action: 'REUSE' }),
  expect.objectContaining({ tenantId: 'tenant-1' })
);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/services/bizfile-contact-resolution.test.ts __tests__/api/contact-match-preview-route.test.ts`

Expected: FAIL on missing route/service calls.

- [ ] **Step 3: Implement batch preview and processor integration**

The preview route authenticates, requires contact read permission, validates at most 100 candidates, and returns matches keyed by stable source path such as `officers.0` or `shareholders.2`. Replace all four `findOrCreateContact` call sites with `resolveOrCreateContact`; pass every field already present in extracted BizFile data and the reviewed resolution decision.

- [ ] **Step 4: Add review controls without overwriting existing dirty-worktree changes**

On entering or saving Officers/Shareholders, request batch previews. Render a compact match panel under each exact match with confidence reasons, existing ID/company links, `Use existing`, and `Create separate` plus reason. Block confirmation only when a reviewable match has no decision. Preserve the current responsive review workspace and unsaved-change guards.

- [ ] **Step 5: Run focused and existing BizFile tests**

Run: `npm test -- __tests__/services/bizfile-contact-resolution.test.ts __tests__/api/contact-match-preview-route.test.ts __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/app/api/contacts/match-preview/route.ts ':(literal)src/app/api/documents/[documentId]/confirm/route.ts' ':(literal)src/app/api/documents/[documentId]/apply-update/route.ts' src/services/bizfile/types.ts src/services/bizfile/processor.ts src/lib/validations/bizfile-review.ts src/components/companies/bizfile-review/bizfile-review-sections.tsx src/components/companies/bizfile-review/bizfile-review-workspace.tsx 'src/app/(dashboard)/companies/upload/page.tsx' __tests__/api/contact-match-preview-route.test.ts __tests__/services/bizfile-contact-resolution.test.ts __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-workspace.test.tsx
git commit -m "feat(bizfile): resolve and enrich contact identities"
```

---

### Task 6: Document Vault Counterparty Identity Capture

**Files:**
- Create: `__tests__/services/document-counterparty-identity.test.ts`
- Modify: `src/services/document-extraction.service.ts:123-150,207-260,1245-1316,2270-2380,2710-2910`
- Modify: `src/services/document-revision.service.ts:90-165,250-340,410-440,553-710`
- Modify: `src/services/vendor-resolution.service.ts:41-58,125-270`
- Modify: `src/services/customer-resolution.service.ts:41-58,122-260`
- Modify: `src/hooks/use-processing-documents.ts:57-70,364-374,817-838`
- Modify: `src/app/(dashboard)/processing/[id]/page.tsx:562-600,661-735`
- Modify: `src/app/api/processing-documents/[documentId]/revisions/[revisionId]/approve/route.ts`
- Update: `__tests__/services/vendor-resolution.service.test.ts`
- Update: `__tests__/services/customer-resolution.service.test.ts`

**Interfaces:**
- Produces validated `CounterpartyIdentityDraft` stored in `DocumentRevision.counterpartyIdentity`.

```ts
export interface CounterpartyIdentityDraft {
  identificationType?: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER';
  identificationNumber?: string;
  fullAddress?: string;
  email?: string;
  phone?: string;
  confidence: Partial<Record<'identificationNumber' | 'fullAddress' | 'email' | 'phone', number>>;
}
```

- [ ] **Step 1: Write failing extraction and approval tests**

Test structured extraction, persistence through draft update, reviewer correction, `0.90` identifier-confidence gating, Chinese vendor reuse, missing-field enrichment, and AP/AR parity.

```ts
it('passes a high-confidence extracted UEN and details into contact resolution on approval', async () => {
  revision.counterpartyIdentity = {
    identificationType: 'UEN',
    identificationNumber: '202012345A',
    fullAddress: '1 Raffles Place',
    email: 'accounts@王氏企业.sg',
    confidence: { identificationNumber: 0.98, fullAddress: 0.92, email: 0.95 },
  };
  await approveRevision(revision.id, { userId: 'user-1' });
  expect(resolveOrCreateContact).toHaveBeenCalledWith(
    expect.objectContaining({ corporateName: '王氏企业', corporateUen: '202012345A', fullAddress: '1 Raffles Place' }),
    { action: 'AUTO' },
    expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' })
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/services/document-counterparty-identity.test.ts __tests__/services/vendor-resolution.service.test.ts __tests__/services/customer-resolution.service.test.ts`

Expected: FAIL because counterparty identity fields are not extracted or persisted.

- [ ] **Step 3: Extend extraction contracts and revision persistence**

Add confidence-bearing schema fields for `counterpartyIdentificationType`, `counterpartyIdentificationNumber`, `counterpartyAddress`, `counterpartyEmail`, and `counterpartyPhone` to every extraction provider schema/prompt. Map them into `counterpartyIdentity`, include evidence, store the JSON on created revisions, and accept validated edits in revision update/create flows.

- [ ] **Step 4: Delegate vendor/customer creation to the identity service**

Keep alias lookup first, replace ASCII-only direct contact scoring with Task 1 scoring, and replace direct `prisma.contact.create` with `resolveOrCreateContact`. Pass `corporateUen` for UEN/registration data plus address/email/phone and field confidence. Existing non-empty conflicts are returned and logged, never overwritten.

- [ ] **Step 5: Add processing-page review fields**

Add Identification type, Identification/UEN, Address, Email, and Phone fields near Vendor/Customer. Show confidence and evidence using existing field patterns. Save them in revision updates; approval uses the corrected values. Do not create a contact during initial upload/extraction.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm test -- __tests__/services/document-counterparty-identity.test.ts __tests__/services/vendor-resolution.service.test.ts __tests__/services/customer-resolution.service.test.ts && npx tsc --noEmit`

Expected: PASS and no type errors.

- [ ] **Step 7: Commit**

```bash
git add -- src/services/document-extraction.service.ts src/services/document-revision.service.ts src/services/vendor-resolution.service.ts src/services/customer-resolution.service.ts src/hooks/use-processing-documents.ts ':(literal)src/app/(dashboard)/processing/[id]/page.tsx' ':(literal)src/app/api/processing-documents/[documentId]/revisions/[revisionId]/approve/route.ts' __tests__/services/document-counterparty-identity.test.ts __tests__/services/vendor-resolution.service.test.ts __tests__/services/customer-resolution.service.test.ts
git commit -m "feat(documents): capture and resolve counterparty identities"
```

---

### Task 7: Duplicate Recommendation Discovery and Rejection

**Files:**
- Create: `src/services/contact-duplicate.service.ts`
- Create: `src/lib/validations/contact-duplicate.ts`
- Create: `src/app/api/contacts/duplicates/route.ts`
- Create: `src/app/api/contacts/duplicates/reject/route.ts`
- Create: `__tests__/services/contact-duplicate.service.test.ts`
- Create: `__tests__/api/contact-duplicates-route.test.ts`

**Interfaces:**
- Produces: `listContactDuplicateGroups({ tenantId, page, limit })`, `rejectContactDuplicatePair(input, params)`.
- Produces response `{ groups, total, page, limit, totalPages }` with preview records, reasons, confidence, conflicts, fingerprints, and recommended master.

- [ ] **Step 1: Write failing discovery tests**

Cover exact canonical groups, identifier groups, `pg_trgm` fuzzy candidates, short-CJK exact-only behavior, tenant isolation, stable grouping of three or more contacts, master ranking, pagination, rejection suppression, and fingerprint invalidation.

```ts
it('groups exact Chinese duplicates and suppresses only matching rejection fingerprints', async () => {
  prisma.contact.findMany.mockResolvedValue([
    duplicateContact('c1', '王小明', 'fp-1'),
    duplicateContact('c2', ' 王小明 ', 'fp-2'),
  ]);
  prisma.contactDuplicateDecision.findMany.mockResolvedValue([
    { leftContactId: 'c1', rightContactId: 'c2', leftFingerprint: 'old', rightFingerprint: 'fp-2' },
  ]);
  const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].contactIds).toEqual(['c1', 'c2']);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/services/contact-duplicate.service.test.ts __tests__/api/contact-duplicates-route.test.ts`

Expected: FAIL on missing service/routes.

- [ ] **Step 3: Implement bounded discovery and decisions**

Use indexed `groupBy`/queries for identifiers and canonical names. Query fuzzy candidates with `similarity(canonicalName, input) >= 0.3` only within tenant/contact type and score the bounded results in TypeScript. Union overlapping pair candidates into stable groups. Recompute fingerprints at read time and ignore decisions whose fingerprints no longer match.

- [ ] **Step 4: Implement secure routes**

GET requires contact read permission and `session.hasAllCompaniesAccess`. Reject requires contact update permission, all-company access or workspace admin, sorted IDs, current fingerprints, and a reason of at least 10 characters. Return 403 without leaking group data to company-scoped users.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- __tests__/services/contact-duplicate.service.test.ts __tests__/api/contact-duplicates-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/contact-duplicate.service.ts src/lib/validations/contact-duplicate.ts src/app/api/contacts/duplicates src/app/api/contacts/duplicates/reject __tests__/services/contact-duplicate.service.test.ts __tests__/api/contact-duplicates-route.test.ts
git commit -m "feat(contacts): recommend duplicate groups"
```

---

### Task 8: Idempotent Atomic Hard-Delete Merge Engine

**Files:**
- Create: `src/services/contact-merge.service.ts`
- Create: `src/app/api/contacts/merge/route.ts`
- Create: `__tests__/services/contact-merge.service.test.ts`
- Create: `__tests__/api/contact-merge-route.test.ts`

**Interfaces:**
- Consumes: current fingerprints, selected master, selected source IDs, per-field decisions, expected `updatedAt`, and idempotency key.
- Produces: immutable ledger ID, surviving contact ID, moved counts, and `alreadyCompleted`.

```ts
export interface MergeContactsInput {
  idempotencyKey: string;
  masterContactId: string;
  sourceContactIds: string[];
  expectedUpdatedAt: Record<string, string>;
  expectedFingerprints: Record<string, string>;
  fieldDecisions: Partial<Record<'firstName' | 'lastName' | 'alias' | 'identificationType' | 'identificationNumber' | 'nationality' | 'dateOfBirth' | 'corporateName' | 'corporateUen' | 'fullAddress', string | null>>;
}
```

- [ ] **Step 1: Write failing merge tests**

Cover group merge, stale rejection, conflict rejection, sorted row locks, company-contact OR consolidation, contact-detail purpose union/primary choice, note ordering, all relational updates, document revision IDs, alias deduplication, reference assertion, ledger/audit creation, hard delete, rollback on forced failure, tenant isolation, permissions in route, and repeated idempotency response.

```ts
expect(tx.contact.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['source-1', 'source-2'] }, tenantId: 'tenant-1' } });
expect(tx.contactMergeOperation.create).toHaveBeenCalledBefore(tx.contact.deleteMany);
expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'MERGE' }) }));
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/services/contact-merge.service.test.ts __tests__/api/contact-merge-route.test.ts`

Expected: FAIL on missing service/route.

- [ ] **Step 3: Implement validation, locks, and consolidation**

First return an existing ledger for `(tenantId, idempotencyKey)`. Otherwise lock master and sources in sorted ID order with the following query, verify tenant/active state/`updatedAt`/fingerprints, recalculate the group, and reject unresolved strong-ID conflicts. Execute the exact consolidation rules from the design for `CompanyContact`, contact details, notes, officer/shareholder/charge references, workflow references, revision IDs, and aliases.

```ts
const sortedIds = [input.masterContactId, ...input.sourceContactIds].sort();
const locked = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>(
  Prisma.sql`SELECT "id", "updatedAt" FROM "contacts" WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(sortedIds)}) ORDER BY "id" FOR UPDATE`
);
if (locked.length !== sortedIds.length) throw new ContactMergeConflictError('One or more contacts are unavailable');
```

- [ ] **Step 4: Implement reference inventory, ledger, audit, and delete**

Before delete, count every reference in the Contact Prisma relation list plus non-FK `DocumentRevision.vendorId`, `DocumentRevision.customerId`, `VendorAlias.normalizedContactId`, and `CustomerAlias.normalizedContactId`; every count must be zero. Write source/master snapshots, decisions, reasons, and moved counts to `ContactMergeOperation`; write `MERGE` audit using the transaction client; hard-delete source contacts last.

- [ ] **Step 5: Implement route and verify GREEN**

The route requires contact update permission and workspace-admin/all-company access, validates with Zod, passes the session tenant/user, maps stale/conflict to 409, and maps repeated success to 200.

Run: `npm test -- __tests__/services/contact-merge.service.test.ts __tests__/api/contact-merge-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/contact-merge.service.ts src/app/api/contacts/merge/route.ts __tests__/services/contact-merge.service.test.ts __tests__/api/contact-merge-route.test.ts
git commit -m "feat(contacts): merge duplicate contacts atomically"
```

---

### Task 9: Contacts Duplicate Review UI

**Files:**
- Create: `src/components/contacts/contact-duplicate-review-modal.tsx`
- Create: `__tests__/components/contact-duplicate-review-modal.test.tsx`
- Create: `__tests__/app/contacts-page-duplicate-review.test.tsx`
- Modify: `src/types/contact.ts`
- Modify: `src/hooks/use-contacts.ts`
- Modify: `src/app/(dashboard)/contacts/page.tsx`

**Interfaces:**
- Consumes: duplicate list/reject/merge APIs.
- Produces: `useContactDuplicateGroups`, `useRejectContactDuplicate`, `useMergeContacts`.

- [ ] **Step 1: Write failing component tests**

Cover confidence reasons, recommended master, alternate master selection, multi-source group selection, conflicting field selection, hidden merge button on unresolved ID conflict, rejection reason, irreversible hard-delete copy, stale refresh, idempotency key reuse across retries, keyboard focus, and mobile card rendering.

```tsx
it('requires conflict resolution and warns that sources are permanently deleted', async () => {
  render(<ContactDuplicateReviewModal open onClose={vi.fn()} />);
  expect(await screen.findByText(/permanently deleted/i)).toBeVisible();
  expect(screen.getByRole('button', { name: /merge contacts/i })).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/use master identification number/i));
  expect(screen.getByRole('button', { name: /merge contacts/i })).toBeEnabled();
});

it('shows the entry point only to users with workspace-wide access', () => {
  render(<ContactsPageHarness permissions={{ updateContact: true }} hasAllCompaniesAccess={false} />);
  expect(screen.queryByRole('button', { name: /review duplicates/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/components/contact-duplicate-review-modal.test.tsx`

Expected: FAIL because the modal does not exist.

- [ ] **Step 3: Implement hooks and modal**

Use TanStack Query keys `['contact-duplicates', page, limit]`, invalidate contacts/stats/duplicates after reject or merge, and keep the same idempotency UUID until a merge succeeds or the selection changes. Use existing `Modal`, `Button`, `ConfirmDialog`, `FormInput`, `MobileCard`, `CardDetailsGrid`, and toast components. Confirmation copy must state: `The duplicate source records will be permanently deleted. Only the selected master contact will remain.`

- [ ] **Step 4: Add Contacts-page entry point**

Show `Review duplicates` only when the user has contact update permission and all-company or workspace-admin access. Display pending count, open the modal, and preserve existing contact selection/bulk-delete state.

- [ ] **Step 5: Run component and page tests**

Run: `npm test -- __tests__/components/contact-duplicate-review-modal.test.tsx __tests__/app/contacts-page-duplicate-review.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/contacts/contact-duplicate-review-modal.tsx src/types/contact.ts src/hooks/use-contacts.ts "src/app/(dashboard)/contacts/page.tsx" __tests__/components/contact-duplicate-review-modal.test.tsx __tests__/app/contacts-page-duplicate-review.test.tsx
git commit -m "feat(contacts): add duplicate review workflow"
```

---

### Task 10: Backfill, Documentation, and End-to-End Verification

**Files:**
- Create: `scripts/backfill-contact-canonical-names.ts`
- Create: `__tests__/services/contact-canonical-backfill.test.ts`
- Modify: `package.json`
- Modify: `docs/INDEX.md`
- Modify: `docs/reference/API_REFERENCE.md:980-1030`
- Modify: `docs/reference/DATABASE_SCHEMA.md`

**Interfaces:**
- Produces: `npm run db:backfill-contact-canonical-names -- --batch-size=500 --resume-after=<uuid>`.

- [ ] **Step 1: Write a failing backfill test**

```ts
it('backfills in stable batches and resumes after the last ID', async () => {
  prisma.contact.findMany.mockResolvedValueOnce([contact('a', '王小明'), contact('b', 'Acme Pte Ltd')]).mockResolvedValueOnce([]);
  const result = await backfillContactCanonicalNames({ batchSize: 2, resumeAfter: null });
  expect(result).toMatchObject({ processed: 2, updated: 2, failed: 0, lastId: 'b' });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- __tests__/services/contact-canonical-backfill.test.ts`

Expected: FAIL because the backfill function/script does not exist.

- [ ] **Step 3: Implement resumable batch backfill**

Export a testable `backfillContactCanonicalNames` function. Read active contacts ordered by ID, compute canonical names with Task 1 code, update only changed/null rows in a transaction per batch, report `{ processed, updated, skipped, failed, lastId }`, and exit nonzero when any batch fails. Add the package script.

- [ ] **Step 4: Update existing documentation**

Document the new match-preview, duplicates, rejection, and merge endpoints; canonical/ledger/decision schema; Document Vault approval timing; BizFile capture; permissions; hard-delete semantics; migration order; dry operational verification; and backfill/resume command. Add links from `docs/INDEX.md` without creating another documentation file.

- [ ] **Step 5: Run the focused feature suite**

Run:

```bash
npm test -- __tests__/lib/contact-identity-normalization.test.ts __tests__/lib/contact-identity-matching.test.ts __tests__/services/contact-identity.service.test.ts __tests__/services/bizfile-contact-resolution.test.ts __tests__/services/document-counterparty-identity.test.ts __tests__/services/contact-duplicate.service.test.ts __tests__/services/contact-merge.service.test.ts __tests__/services/contact-canonical-backfill.test.ts __tests__/api/contacts-create-route.test.ts __tests__/api/contact-match-preview-route.test.ts __tests__/api/contact-duplicates-route.test.ts __tests__/api/contact-merge-route.test.ts __tests__/components/contact-match-dialog.test.tsx __tests__/components/contact-duplicate-review-modal.test.tsx
```

Expected: all selected tests PASS with no unhandled warnings.

- [ ] **Step 6: Run full verification**

Run:

```bash
npx prisma validate
npm run db:generate
npx tsc --noEmit
npm run lint
npm run test:run
npm run build
```

Expected: every command exits 0. If the pre-existing dirty BizFile work has an unrelated failure, capture the exact failing command/test and verify the feature-focused suite independently before changing unrelated code.

- [ ] **Step 7: Perform database smoke checks in a disposable/local database**

Apply the migration, run the backfill twice, and confirm the second run reports zero updates. Create/approve two simultaneous Chinese-name document revisions and confirm one contact. Merge a disposable duplicate group and confirm source rows are absent, ledger/audit rows exist, and every reference points to the master.

- [ ] **Step 8: Commit**

```bash
git add scripts/backfill-contact-canonical-names.ts package.json package-lock.json docs/INDEX.md docs/reference/API_REFERENCE.md docs/reference/DATABASE_SCHEMA.md __tests__/services/contact-canonical-backfill.test.ts
git commit -m "docs(contacts): document identity controls and backfill"
```

---

## Final Acceptance Checklist

- Chinese exact names work in manual, company quick-create, BizFile, AP vendor, and AR customer paths.
- IDs/UENs and other available data are captured, validated, and used to enrich empty fields.
- Masked or low-confidence identifiers never become deterministic match keys.
- Legitimate same-name users can explicitly create a separate contact.
- Duplicate recommendations are bounded, tenant-scoped, fingerprint-aware, and permission-safe.
- Merge is atomic, idempotent, fully audited, and hard-deletes only approved sources after reference assertions.
- Existing dirty-worktree BizFile changes remain preserved.
- Focused tests, full tests, lint, typecheck, Prisma validation, build, backfill, and disposable-database smoke checks pass.

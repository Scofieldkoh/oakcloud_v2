# Document Generation Draft Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace implicit single-browser wizard recovery with explicit, server-backed, multi-draft document-generation sessions that users can save, resume, discard, and protect from unsaved navigation.

**Architecture:** Persist a versioned `generationSession` payload inside existing `GeneratedDocument.metadata` records with `DRAFT` status. A focused service and dedicated API routes own session creation/loading/updating, while the existing generation service gains an optional `draftId` path that atomically turns the selected session into generated content. The generation page coordinates API calls; the wizard owns dirty-state baselines and save controls; the existing document list detects active session metadata and exposes Resume/Discard actions.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, Prisma/PostgreSQL, Vitest, Testing Library, existing Oakcloud UI components.

## Global Constraints

- **Generate Document** without a `draft` query parameter always starts a clean session.
- **Save Draft** is available at every wizard step, including the untouched initial step.
- Saved sessions are ordinary `GeneratedDocument` records with `status: DRAFT`; do not add a database table or migration.
- Support multiple independent drafts per user/workspace; subsequent saves update the same selected draft.
- Resume and mutation operations must enforce workspace isolation and document permissions.
- In-app navigation uses an Oakcloud confirmation dialog; close, refresh, and external navigation use `beforeunload`.
- The legacy `oakcloud:document-generation-wizard-draft` value is cleared and never restored.
- Do not alter `/api/generated-documents/[id]/draft`; it belongs to generated-document editor auto-save.
- Do not auto-save or create a server record merely by opening the wizard.
- Do not run the baseline or broad test suite unless the user explicitly requests it.
- Run only directly relevant Vitest files and touched-file type/lint checks supported by project tooling.

---

## File Structure

**Create**

- `src/services/document-generation-session.service.ts` — tenant-safe create/load/update operations.
- `src/lib/document-generation-session.ts` — client-safe envelope type and metadata parser used by the service, wizard, and document list.
- `src/app/api/generated-documents/generation-sessions/route.ts` — create a new saved wizard session.
- `src/app/api/generated-documents/generation-sessions/[id]/route.ts` — load or update one saved wizard session.
- `src/hooks/use-unsaved-navigation-guard.tsx` — native unload protection plus deferred Oakcloud in-app navigation confirmation.
- `__tests__/services/document-generation-session.service.test.ts` — persistence, isolation, update, stale reference, and conversion service coverage.
- `__tests__/api/generated-document-generation-sessions-route.test.ts` — authentication, permissions, workspace scoping, and payload validation coverage.
- `__tests__/hooks/use-unsaved-navigation-guard.test.tsx` — anchor, history, unload, cancel, confirm, and disarm coverage.
- `__tests__/components/document-generation-list-drafts.test.tsx` — desktop/mobile Resume/Edit/Discard rendering coverage.

**Modify**

- `src/lib/validations/generated-document.ts` — versioned generation-session schemas and optional `draftId` on template generation.
- `src/services/document-generator.service.ts` — convert an authorized active session into generated content without duplication.
- `src/app/api/generated-documents/route.ts` — pass optional `draftId` into template generation validation/service.
- `src/app/(dashboard)/generated-documents/generate/page.tsx` — read explicit resume intent, load/save sessions, and delay redirect until the guard is disarmed.
- `src/components/documents/document-generation-wizard.tsx` — remove local restore/auto-save, accept an initial server session, expose Save Draft on every step, track dirty baseline, reconcile stale selections, and guard navigation.
- `src/components/documents/document-table.tsx` — identify active wizard sessions and render Resume/Discard instead of Edit/Delete semantics where appropriate.
- `src/app/(dashboard)/generated-documents/page.tsx` — handle fixed-reason draft discard confirmation separately from ordinary document deletion.
- `__tests__/components/document-generation-wizard.test.tsx` — replace localStorage recovery cases with explicit clean-start/save/resume/dirty/stale-selection cases.
- `__tests__/api/generated-documents-workspace.test.ts` — verify `draftId` forwarding remains workspace-scoped.
- `docs/ARCHITECTURE.md`, `docs/reference/API_REFERENCE.md`, `docs/reference/DATABASE_SCHEMA.md`, `docs/TODO.md` — replace legacy recovery documentation with the implemented server-backed workflow.

---

### Task 1: Define the Versioned Session Contract

**Files:**
- Modify: `src/lib/validations/generated-document.ts`
- Test: `__tests__/services/document-generation-session.service.test.ts`

**Interfaces:**
- Produces: `GENERATION_SESSION_VERSION`, `generationSessionStateSchema`, `saveGenerationSessionSchema`, `GenerationSessionState`, `SaveGenerationSessionInput`.
- Produces: `createDocumentFromTemplateSchema` accepts `draftId?: string`.

- [ ] **Step 1: Write the failing validation tests**

Create `__tests__/services/document-generation-session.service.test.ts` with the contract tests first:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));

import {
  GENERATION_SESSION_VERSION,
  createDocumentFromTemplateSchema,
  saveGenerationSessionSchema,
} from '@/lib/validations/generated-document';

describe('generation session validation', () => {
  it('accepts an untouched first-step session', () => {
    const result = saveGenerationSessionSchema.parse({
      version: GENERATION_SESSION_VERSION,
      currentStep: 0,
      templateId: null,
      companyId: null,
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      title: '',
      customData: {},
      useLetterhead: true,
      previewContent: null,
      editedContent: null,
      editedContentJson: null,
    });

    expect(result.currentStep).toBe(0);
    expect(result.templateId).toBeNull();
  });

  it('rejects an unsupported session version and out-of-range step', () => {
    expect(() => saveGenerationSessionSchema.parse({
      version: 999,
      currentStep: 9,
      templateId: null,
      companyId: null,
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      title: '',
      customData: {},
      useLetterhead: true,
      previewContent: null,
      editedContent: null,
      editedContentJson: null,
    })).toThrow();
  });

  it('accepts an optional draft id for final generation', () => {
    const result = createDocumentFromTemplateSchema.parse({
      draftId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      templateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Board resolution',
    });
    expect(result.draftId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run:

```powershell
npx.cmd vitest run __tests__/services/document-generation-session.service.test.ts
```

Expected: FAIL because the generation-session exports and `draftId` field do not exist.

- [ ] **Step 3: Add the minimal schemas and types**

Add to `src/lib/validations/generated-document.ts`:

```ts
export const GENERATION_SESSION_VERSION = 1 as const;

const nullableUuid = z.string().uuid().nullable();

export const generationSessionStateSchema = z.object({
  version: z.literal(GENERATION_SESSION_VERSION),
  currentStep: z.number().int().min(0).max(4),
  templateId: nullableUuid,
  companyId: nullableUuid,
  contactIds: z.array(z.string().uuid()),
  selectedDirectorId: nullableUuid,
  selectedShareholderId: nullableUuid,
  selectedContactId: nullableUuid,
  title: z.string().max(300),
  customData: z.record(z.string()),
  useLetterhead: z.boolean(),
  previewContent: z.string().nullable(),
  editedContent: z.string().nullable(),
  editedContentJson: z.unknown().nullable(),
});

export const saveGenerationSessionSchema = generationSessionStateSchema;
export type GenerationSessionState = z.infer<typeof generationSessionStateSchema>;
export type SaveGenerationSessionInput = z.infer<typeof saveGenerationSessionSchema>;
```

Extend `createDocumentFromTemplateSchema`:

```ts
draftId: z.string().uuid().optional(),
```

- [ ] **Step 4: Run the contract tests and verify GREEN**

Run the same focused command. Expected: all three validation tests PASS.

- [ ] **Step 5: Commit the contract**

```powershell
git add src/lib/validations/generated-document.ts __tests__/services/document-generation-session.service.test.ts
git commit -m "feat(documents): define generation session contract"
```

---

### Task 2: Persist and Load Multiple Tenant-Safe Sessions

**Files:**
- Create: `src/lib/document-generation-session.ts`
- Create: `src/services/document-generation-session.service.ts`
- Modify: `__tests__/services/document-generation-session.service.test.ts`

**Interfaces:**
- Consumes: `GenerationSessionState`, `SaveGenerationSessionInput`, `TenantAwareParams`.
- Produces from the client-safe lib: `GenerationSessionEnvelope = { id: string; savedAt: string; state: GenerationSessionState }`, `readActiveGenerationSession(metadata)`, and `isActiveGenerationSessionMetadata(metadata)`.
- Produces: `createGenerationSession(input, params)`, `getGenerationSession(id, params)`, `updateGenerationSession(id, input, params)`.

- [ ] **Step 1: Add failing service tests for create, update, multiple drafts, and isolation**

Replace the Task 1 empty Prisma mock with this hoisted Prisma mock, add the service imports after all `vi.mock` declarations, and add these assertions:

```ts
const prismaMock = vi.hoisted(() => ({
  documentTemplate: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
  contact: { findMany: vi.fn() },
  generatedDocument: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  createGenerationSession,
  getGenerationSession,
  updateGenerationSession,
} from '@/services/document-generation-session.service';

it('creates independent draft records for independent saves', async () => {
  prismaMock.generatedDocument.create
    .mockResolvedValueOnce({ id: 'draft-1', updatedAt: new Date('2026-07-18T01:00:00Z') })
    .mockResolvedValueOnce({ id: 'draft-2', updatedAt: new Date('2026-07-18T02:00:00Z') });

  const first = await createGenerationSession(emptySession, tenantParams);
  const second = await createGenerationSession(emptySession, tenantParams);

  expect(first.id).toBe('draft-1');
  expect(second.id).toBe('draft-2');
  expect(prismaMock.generatedDocument.create).toHaveBeenCalledTimes(2);
});

it('updates only an active session in the current workspace', async () => {
  prismaMock.generatedDocument.findFirst.mockResolvedValue({
    id: 'draft-1', tenantId: tenantParams.tenantId, status: 'DRAFT', deletedAt: null,
    metadata: { generationSession: emptySession },
  });
  prismaMock.generatedDocument.update.mockResolvedValue({
    id: 'draft-1', updatedAt: new Date('2026-07-18T03:00:00Z'),
  });

  await updateGenerationSession('draft-1', { ...emptySession, title: 'Changed' }, tenantParams);

  expect(prismaMock.generatedDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: 'draft-1', tenantId: tenantParams.tenantId, deletedAt: null }),
  }));
  expect(prismaMock.generatedDocument.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'draft-1' },
  }));
});

it('does not reveal a draft from another workspace', async () => {
  prismaMock.generatedDocument.findFirst.mockResolvedValue(null);
  await expect(getGenerationSession('draft-1', tenantParams)).rejects.toThrow('Document draft not found');
});
```

Also assert create uses `Untitled Document`, template-aware saves use `Untitled - Resolution`, and metadata contains exactly one active `generationSession` payload.

- [ ] **Step 2: Run the service test and verify RED**

Run the Task 1 Vitest command. Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement focused session persistence**

Create `src/lib/document-generation-session.ts` with the client-safe public shapes and helpers:

```ts
import {
  generationSessionStateSchema,
  type GenerationSessionState,
} from '@/lib/validations/generated-document';

export interface GenerationSessionEnvelope {
  id: string;
  savedAt: string;
  state: GenerationSessionState;
}

export function readActiveGenerationSession(metadata: unknown): GenerationSessionState | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const result = generationSessionStateSchema.safeParse(
    (metadata as Record<string, unknown>).generationSession,
  );
  return result.success ? result.data : null;
}

export function isActiveGenerationSessionMetadata(metadata: unknown): boolean {
  return readActiveGenerationSession(metadata) !== null;
}
```

Create `src/services/document-generation-session.service.ts` as a server-only module importing Prisma, audit, errors, the validation input type, `TenantAwareParams`, and the three client-safe exports above. Export only `createGenerationSession`, `getGenerationSession`, and `updateGenerationSession` from the service.

Implement `createGenerationSession`, `getGenerationSession`, and `updateGenerationSession` so they:

1. validate referenced template/company/contact IDs inside the current tenant when present;
2. persist `templateId`, `companyId`, fallback/user title, `content: editedContent ?? previewContent ?? ''`, `useLetterhead`, and `{ generationSession: input }`;
3. require `status: 'DRAFT'`, `deletedAt: null`, and active compatible metadata for load/update;
4. return `{ id, savedAt: updatedAt.toISOString(), state }`;
5. create one `DOCUMENT_DRAFT_SAVED` audit entry only for the first save.

Use one private `validateSessionReferences()` helper and one private `toEnvelope()` helper; do not add speculative migration logic.

- [ ] **Step 4: Run the focused service tests and verify GREEN**

Run only `__tests__/services/document-generation-session.service.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit session persistence**

```powershell
git add src/lib/document-generation-session.ts src/services/document-generation-session.service.ts __tests__/services/document-generation-session.service.test.ts
git commit -m "feat(documents): persist generation draft sessions"
```

---

### Task 3: Add Dedicated Generation-Session API Routes

**Files:**
- Create: `src/app/api/generated-documents/generation-sessions/route.ts`
- Create: `src/app/api/generated-documents/generation-sessions/[id]/route.ts`
- Create: `__tests__/api/generated-document-generation-sessions-route.test.ts`

**Interfaces:**
- Consumes: Task 2 service methods.
- Produces: `POST /api/generated-documents/generation-sessions` -> `201 GenerationSessionEnvelope`.
- Produces: `GET /api/generated-documents/generation-sessions/:id` -> `200 GenerationSessionEnvelope`.
- Produces: `PUT /api/generated-documents/generation-sessions/:id` -> `200 GenerationSessionEnvelope`.

- [ ] **Step 1: Write failing route tests**

Create route tests that mock auth, RBAC, and Task 2 service methods. Include these exact behavioral assertions:

```ts
expect(requirePermission).toHaveBeenCalledWith(session, 'document', 'create');
expect(createGenerationSession).toHaveBeenCalledWith(validState, {
  tenantId: workspaceId,
  userId: session.id,
});
```

For GET, expect `document/read`; for PUT, expect `document/update`. Send an unsupported version and assert status `400`. Include a body with an attacker-supplied `tenantId` and assert it never reaches the service.

- [ ] **Step 2: Run route tests and verify RED**

```powershell
npx.cmd vitest run __tests__/api/generated-document-generation-sessions-route.test.ts
```

Expected: FAIL because both route modules are missing.

- [ ] **Step 3: Implement the route handlers**

Use the existing route pattern:

```ts
const session = await requireAuth();
await requirePermission(session, 'document', 'create');
const body = await request.json();
const { tenantId: _ignoredTenantId, ...payload } = body;
const input = saveGenerationSessionSchema.parse(payload);
const result = await createGenerationSession(input, {
  tenantId: requireSessionWorkspaceId(session),
  userId: session.id,
});
return NextResponse.json(result, { status: 201 });
```

Use `createErrorResponse` for Zod/auth/service errors. GET has no body. PUT parses the same schema and calls `updateGenerationSession(id, input, params)`.

- [ ] **Step 4: Run route tests and verify GREEN**

Run only the route test file. Expected: PASS.

- [ ] **Step 5: Commit the API routes**

```powershell
git add src/app/api/generated-documents/generation-sessions __tests__/api/generated-document-generation-sessions-route.test.ts
git commit -m "feat(documents): expose generation session API"
```

---

### Task 4: Convert a Saved Session Without Creating a Duplicate

**Files:**
- Modify: `src/services/document-generator.service.ts`
- Modify: `src/app/api/generated-documents/route.ts`
- Modify: `__tests__/services/document-generation-session.service.test.ts`
- Modify: `__tests__/api/generated-documents-workspace.test.ts`

**Interfaces:**
- Consumes: optional `CreateDocumentFromTemplateInput.draftId` and the client-safe `readActiveGenerationSession()` helper.
- Produces: `createDocumentFromTemplate()` creates when `draftId` is absent and updates the authorized active session when present.

- [ ] **Step 1: Write failing conversion tests**

Add a service test with a valid active session and mock rendering dependencies. Assert:

```ts
expect(prismaMock.generatedDocument.create).not.toHaveBeenCalled();
expect(prismaMock.generatedDocument.update).toHaveBeenCalledWith({
  where: { id: draftId },
  data: expect.objectContaining({
    templateId,
    title: 'Final title',
    content: '<p>Rendered</p>',
    status: 'DRAFT',
    metadata: expect.not.objectContaining({ generationSession: expect.anything() }),
  }),
});
```

Add a failure assertion: if rendering rejects, neither `generatedDocument.update` nor `generatedDocument.create` is called and the original session remains untouched.

In `generated-documents-workspace.test.ts`, send `draftId` and assert it is forwarded while the session workspace still comes only from auth.

- [ ] **Step 2: Run the two focused files and verify RED**

```powershell
npx.cmd vitest run __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-documents-workspace.test.ts
```

Expected: FAIL because generation still always creates a record and/or drops `draftId`.

- [ ] **Step 3: Implement same-record conversion**

In `createDocumentFromTemplate()`:

1. if `data.draftId` exists, fetch `{ id, tenantId, status, deletedAt, metadata }` using `id + tenantId + deletedAt: null`;
2. reject with `NotFoundError('Document draft not found')` unless it is `DRAFT` with compatible active session metadata;
3. render fully before any mutation;
4. build the existing generated metadata without `generationSession`;
5. call `generatedDocument.update` instead of `create` using the rendered fields, current template version, company, placeholder data, letterhead, and title;
6. keep the existing create behavior unchanged when `draftId` is absent;
7. preserve a single `DOCUMENT_GENERATED` audit entry for the completed conversion.

Do not delete and recreate the record. Do not mutate it before rendering succeeds.

- [ ] **Step 4: Run the two focused files and verify GREEN**

Run the same two-file command. Expected: PASS.

- [ ] **Step 5: Commit atomic conversion**

```powershell
git add src/services/document-generator.service.ts src/app/api/generated-documents/route.ts __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-documents-workspace.test.ts
git commit -m "feat(documents): generate into saved draft session"
```

---

### Task 5: Add Reusable Unsaved In-App and Browser Navigation Protection

**Files:**
- Create: `src/hooks/use-unsaved-navigation-guard.tsx`
- Create: `__tests__/hooks/use-unsaved-navigation-guard.test.tsx`

**Interfaces:**
- Produces: `useUnsavedNavigationGuard(isDirty: boolean)` -> `{ disarm(): void; rearm(): void; dialog: React.ReactNode }`.

- [ ] **Step 1: Write failing hook harness tests**

Render a harness that exposes `disarm` and `dialog`. Cover:

```ts
fireEvent.beforeUnload(window);
expect(event.defaultPrevented).toBe(true);

fireEvent.click(screen.getByRole('link', { name: 'Documents' }));
expect(screen.getByText('Unsaved changes')).toBeVisible();
expect(window.location.pathname).toBe('/generated-documents/generate');

fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
expect(routerPush).toHaveBeenCalledWith('/generated-documents');
```

Also verify `disarm()` permits the next programmatic navigation and `isDirty=false` installs no guard. Simulate `popstate`, cancel it, then confirm it and assert one backward navigation occurs without reopening the dialog.

- [ ] **Step 2: Run the hook test and verify RED**

```powershell
npx.cmd vitest run __tests__/hooks/use-unsaved-navigation-guard.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the guard with the existing ConfirmDialog**

The hook must:

- install `beforeunload` only while dirty and armed;
- capture unmodified same-origin anchor clicks in the document capture phase;
- ignore downloads, `_blank`, modifier-key clicks, and same-URL links;
- prevent the link, store its pathname/search/hash, and open `ConfirmDialog`;
- neutralize `popstate` with `history.forward()`, then ask for confirmation;
- on confirm, disarm before `router.push(destination)` or the deferred `history.back()`;
- on cancel, clear only the pending navigation;
- render this exact dialog copy:

```tsx
<ConfirmDialog
  isOpen={pendingNavigation !== null}
  onClose={cancelNavigation}
  onConfirm={confirmNavigation}
  title="Unsaved changes"
  description="You have changes that have not been saved as a draft. Leave without saving them?"
  confirmLabel="Leave without saving"
  cancelLabel="Stay"
  variant="warning"
/>
```

- [ ] **Step 4: Run the hook test and verify GREEN**

Run only the hook test. Expected: PASS.

- [ ] **Step 5: Commit the guard**

```powershell
git add src/hooks/use-unsaved-navigation-guard.tsx __tests__/hooks/use-unsaved-navigation-guard.test.tsx
git commit -m "feat(ui): guard unsaved client navigation"
```

---

### Task 6: Replace Local Recovery with Explicit Wizard Save and Resume

**Files:**
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Modify: `src/app/(dashboard)/generated-documents/generate/page.tsx`
- Modify: `__tests__/components/document-generation-wizard.test.tsx`

**Interfaces:**
- Consumes: `GenerationSessionEnvelope` from `src/lib/document-generation-session.ts`, `GenerationSessionState`, and `useUnsavedNavigationGuard()`.
- Produces wizard props:

```ts
initialSession?: GenerationSessionEnvelope | null;
onSaveDraft: (
  draftId: string | null,
  state: GenerationSessionState,
) => Promise<GenerationSessionEnvelope>;
onGenerationComplete?: (result: GeneratedDocumentResult) => void;
```

- Extends `GenerateDocumentData` with `draftId?: string`.

- [ ] **Step 1: Replace legacy recovery tests with failing explicit-session tests**

Delete only the tests whose setup writes `oakcloud:document-generation-wizard-draft`. Preserve unrelated party eligibility coverage by passing `initialSession` instead.

Add focused tests that verify:

```ts
it('starts clean and clears the obsolete browser draft', () => {
  window.localStorage.setItem('oakcloud:document-generation-wizard-draft', '{"title":"Old"}');
  render(<DocumentGenerationWizard {...baseProps} onSaveDraft={vi.fn()} />);
  expect(screen.getByText('No template selected')).toBeVisible();
  expect(window.localStorage.getItem('oakcloud:document-generation-wizard-draft')).toBeNull();
});

const sessionAtStep = (step: number): GenerationSessionEnvelope => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  savedAt: '2026-07-18T01:00:00.000Z',
  state: {
    version: 1,
    currentStep: step,
    templateId: template.id,
    companyId: null,
    contactIds: [],
    selectedDirectorId: null,
    selectedShareholderId: null,
    selectedContactId: null,
    title: 'Resolution',
    customData: {},
    useLetterhead: true,
    previewContent: step === 4 ? '<p>Preview</p>' : null,
    editedContent: null,
    editedContentJson: null,
  },
});

it.each([0, 1, 2, 3, 4])('shows Save Draft on wizard step %s', async (step) => {
  render(<DocumentGenerationWizard
    {...baseProps}
    initialSession={sessionAtStep(step)}
    onSaveDraft={vi.fn()}
  />);
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeVisible();
});

it('creates once, then updates the returned draft id', async () => {
  const onSaveDraft = vi.fn()
    .mockResolvedValueOnce({ id: 'draft-1', savedAt: savedAt, state: emptySession })
    .mockResolvedValueOnce({ id: 'draft-1', savedAt: later, state: changedSession });
  // click save, make one input change, click save again
  expect(onSaveDraft.mock.calls[0][0]).toBeNull();
  expect(onSaveDraft.mock.calls[1][0]).toBe('draft-1');
});

it('resumes only the supplied server session', async () => {
  render(<DocumentGenerationWizard {...baseProps} initialSession={savedSession} onSaveDraft={vi.fn()} />);
  expect(screen.getByDisplayValue('Restored resolution')).toBeVisible();
  expect(screen.getByText('Saved draft resumed')).toBeVisible();
});

it('keeps the warning dirty after save failure and resets it after success', async () => {
  const onSaveDraft = vi.fn()
    .mockRejectedValueOnce(new Error('Draft save failed'))
    .mockImplementationOnce(async (_draftId, state) => ({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      savedAt: '2026-07-18T03:00:00.000Z',
      state,
    }));
  render(<DocumentGenerationWizard {...baseProps} onSaveDraft={onSaveDraft} />);

  fireEvent.click(screen.getAllByText('Resolution').at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  expect(await screen.findByText('Draft save failed')).toBeVisible();

  const dirtyUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirtyUnload);
  expect(dirtyUnload.defaultPrevented).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  expect(await screen.findByText(/Saved/)).toBeVisible();

  const cleanUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});
```

Retain stale company/party tests, but construct `initialSession.state` rather than localStorage. Assert only the invalid selection and dependent preview content are cleared, and a warning is shown.

- [ ] **Step 2: Run the wizard test and verify RED**

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
```

Expected: FAIL because the new props, server resume, Save Draft UI, and guard integration do not exist.

- [ ] **Step 3: Implement explicit initial-state hydration**

In the wizard:

- remove `WizardDraftState`, `draftRestored`, `hasLoadedDraftRef`, the localStorage restore effect, and the localStorage persistence effect;
- retain one initialization effect that removes `WIZARD_DRAFT_STORAGE_KEY` without reading it;
- initialize `currentStep`, selected records, values, and pending party IDs from `initialSession.state`;
- reuse current eligibility loading to validate saved party IDs;
- show a warning when a referenced template/company/contact/party is unavailable, clearing only the invalid ID and any preview content that depended on it;
- show `Saved draft resumed` only for a compatible supplied session.

Do not fetch an arbitrary or latest draft from inside the wizard.

- [ ] **Step 4: Implement snapshot comparison and Save Draft UI**

Create a memoized `GenerationSessionState` snapshot from current wizard state and step. Store:

```ts
const [draftId, setDraftId] = useState(initialSession?.id ?? null);
const [savedSnapshot, setSavedSnapshot] = useState(
  initialSession ? JSON.stringify(initialSession.state) : JSON.stringify(cleanInitialSnapshot),
);
const isDirty = JSON.stringify(currentSnapshot) !== savedSnapshot;
```

Wire `useUnsavedNavigationGuard(isDirty && !isSavingDraft && !isGenerating)`. On successful save, set `draftId`, `savedSnapshot`, and last-saved time from the returned envelope. On failure, preserve both the prior baseline and dirty state.

Render the secondary button beside Next/Generate on every step:

```tsx
<Button variant="secondary" onClick={handleSaveDraft} disabled={isSavingDraft || isGenerating}>
  {isSavingDraft ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Draft'}
</Button>
```

Render the last-saved indicator using the existing compact text/color conventions. Include `guard.dialog` once at the component root.

- [ ] **Step 5: Move API coordination and redirect control into the generation page**

In `generate/page.tsx`:

- use `useSearchParams()` to read only an explicit `draft` UUID;
- load that session from `/api/generated-documents/generation-sessions/:id` alongside initial options;
- show a specific error with a **Start a new document** link to `/generated-documents/generate` when loading fails;
- implement `handleSaveDraft(draftId, state)` using POST for null and PUT otherwise;
- add `draftId` to the generation POST body;
- remove `router.push` from `handleGenerate`;
- pass `onGenerationComplete={(result) => router.push(`/generated-documents/${result.id}`)}` so the wizard can disarm before invoking it.

- [ ] **Step 6: Run the wizard test and verify GREEN**

Run only `__tests__/components/document-generation-wizard.test.tsx`. Expected: PASS with no legacy recovery assertions.

- [ ] **Step 7: Commit the wizard workflow**

```powershell
git add src/components/documents/document-generation-wizard.tsx src/app/\(dashboard\)/generated-documents/generate/page.tsx __tests__/components/document-generation-wizard.test.tsx
git commit -m "feat(documents): save and resume generation sessions"
```

---

### Task 7: Expose Resume and Discard in Desktop and Mobile Lists

**Files:**
- Modify: `src/components/documents/document-table.tsx`
- Modify: `src/app/(dashboard)/generated-documents/page.tsx`
- Create: `__tests__/components/document-generation-list-drafts.test.tsx`

**Interfaces:**
- Consumes: the client-safe `isActiveGenerationSessionMetadata(metadata)` from `src/lib/document-generation-session.ts`.
- Extends `GeneratedDocument` with `metadata?: unknown`.
- Produces `onDiscardDraft?: (id: string) => void` separately from ordinary `onDelete`.

- [ ] **Step 1: Write failing list action tests**

Render one active session draft and one generated `DRAFT` document. Assert in both desktop and mobile DOM branches:

```ts
expect(screen.getAllByRole('link', { name: /Resume/ })).toHaveLength(2);
expect(screen.getAllByRole('link', { name: /Resume/ })[0]).toHaveAttribute(
  'href', '/generated-documents/generate?draft=session-1',
);
expect(screen.getAllByRole('button', { name: /Discard/ })).toHaveLength(2);
expect(screen.getAllByRole('link', { name: /Edit generated draft/ })).toHaveLength(2);
```

Click Discard and assert `onDiscardDraft('session-1')`. Verify finalized/archived documents never show Resume.

- [ ] **Step 2: Run the list test and verify RED**

```powershell
npx.cmd vitest run __tests__/components/document-generation-list-drafts.test.tsx
```

Expected: FAIL because metadata-aware actions do not exist.

- [ ] **Step 3: Implement metadata-aware actions in table and cards**

For `status === 'DRAFT' && isActiveGenerationSessionMetadata(doc.metadata)`:

- render a link to `/generated-documents/generate?draft=${encodeURIComponent(doc.id)}` with `aria-label={`Resume ${doc.title}`}`;
- render a discard button with `aria-label={`Discard ${doc.title}`}`;
- do not render the ordinary edit pencil for that record;
- preserve view/export/share visibility according to existing permissions unless an action requires generated content; hide export/share for active incomplete sessions.

For generated `DRAFT` records without active metadata, preserve the existing Edit behavior and label it `Edit generated draft ${title}` for clear tests/accessibility.

- [ ] **Step 4: Implement fixed-reason discard confirmation on the list page**

Add a separate `draftToDiscard` state and a non-reason `ConfirmDialog`:

```tsx
<ConfirmDialog
  isOpen={draftToDiscard !== null}
  onClose={() => setDraftToDiscard(null)}
  onConfirm={handleDiscardDraft}
  title="Discard draft?"
  description="This saved document-generation draft will be removed. This action cannot be undone from this list."
  confirmLabel="Discard draft"
  variant="danger"
/>
```

`handleDiscardDraft()` calls the existing DELETE route with `reason=Discarded document generation draft`, removes only that ID from list state on success, decrements total safely with `Math.max(0, total - 1)`, and shows `Draft discarded`. Keep the existing reason-required Delete Document dialog unchanged for normal documents.

- [ ] **Step 5: Run the list test and verify GREEN**

Run only the list test. Expected: PASS.

- [ ] **Step 6: Commit list actions**

```powershell
git add src/components/documents/document-table.tsx src/app/\(dashboard\)/generated-documents/page.tsx __tests__/components/document-generation-list-drafts.test.tsx
git commit -m "feat(documents): list resumable generation drafts"
```

---

### Task 8: Update Existing Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/reference/API_REFERENCE.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: the implemented routes, metadata contract, lifecycle, and UI behavior from Tasks 1-7.
- Produces: current documentation with no claim that local auto-restore is supported.

- [ ] **Step 1: Update architecture and API references**

Document:

- `POST /api/generated-documents/generation-sessions`;
- `GET /api/generated-documents/generation-sessions/:id`;
- `PUT /api/generated-documents/generation-sessions/:id`;
- the optional `draftId` on `POST /api/generated-documents`;
- create/update/resume/convert/discard lifecycle and permission requirements.

- [ ] **Step 2: Update database and TODO descriptions**

In `DATABASE_SCHEMA.md`, describe `metadata.generationSession` as a versioned JSON payload on active incomplete `DRAFT` records, not a new table. Update `GEN-001` in `docs/TODO.md` from automatic local recovery to explicit multiple server-backed saves/resume/discard.

- [ ] **Step 3: Scan documentation for stale workflow claims**

Run:

```powershell
rg -n -S "document-generation-wizard-draft|restores interrupted|automatic local|auto.*restore" docs
```

Expected: no current documentation claims the old workflow is supported; historical design documents may remain when clearly historical.

- [ ] **Step 4: Check documentation formatting**

```powershell
git diff --check -- docs/ARCHITECTURE.md docs/reference/API_REFERENCE.md docs/reference/DATABASE_SCHEMA.md docs/TODO.md
```

Expected: no output.

- [ ] **Step 5: Commit documentation**

```powershell
git add docs/ARCHITECTURE.md docs/reference/API_REFERENCE.md docs/reference/DATABASE_SCHEMA.md docs/TODO.md
git commit -m "docs: document generation draft sessions"
```

---

### Task 9: Focused Verification and Review

**Files:**
- Review only the files listed in Tasks 1-8.
- Do not modify unrelated files.

**Interfaces:**
- Consumes: all task deliverables.
- Produces: evidence that the requested workflow works without running a baseline suite.

- [ ] **Step 1: Run only the directly relevant test files**

```powershell
npx.cmd vitest run __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts __tests__/api/generated-documents-workspace.test.ts __tests__/hooks/use-unsaved-navigation-guard.test.tsx __tests__/components/document-generation-wizard.test.tsx __tests__/components/document-generation-list-drafts.test.tsx
```

Expected: all selected tests PASS. This is the maximum test scope authorized by this plan; do not run `npm test`, `test:run`, or any baseline command.

- [ ] **Step 2: Run touched-file lint if ESLint accepts explicit paths**

```powershell
npx.cmd eslint src/lib/validations/generated-document.ts src/lib/document-generation-session.ts src/services/document-generation-session.service.ts src/services/document-generator.service.ts src/app/api/generated-documents/route.ts src/app/api/generated-documents/generation-sessions/route.ts src/app/api/generated-documents/generation-sessions/[id]/route.ts src/hooks/use-unsaved-navigation-guard.tsx src/components/documents/document-generation-wizard.tsx src/components/documents/document-table.tsx "src/app/(dashboard)/generated-documents/generate/page.tsx" "src/app/(dashboard)/generated-documents/page.tsx"
```

Expected: exit code 0. If project configuration cannot lint explicit paths, report that limitation and do not substitute a repository-wide lint run.

- [ ] **Step 3: Inspect the final diff for lifecycle errors**

```powershell
git diff --check HEAD~8..HEAD
git status --short
```

Expected: no whitespace errors and no unintended files. Manually confirm:

- a clean route never loads a draft;
- every Save after the first reuses its ID;
- failed save/generation retains recoverability and dirty protection;
- successful generation disarms before redirect and updates one record;
- list actions respect metadata, status, permissions, and mobile layout;
- cross-workspace access returns the same not-found behavior;
- no baseline tests were run.

- [ ] **Step 4: Commit any focused verification fixes individually**

If a focused check reveals an implementation defect, add a failing regression assertion to the relevant focused test, verify RED, apply the smallest fix, verify GREEN, and commit only those files. If no fix is needed, do not create an empty commit.

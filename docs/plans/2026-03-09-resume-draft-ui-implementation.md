# Resume Draft UI/UX Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the resume draft section on the public form view into a stateful card with 3 states (idle, active, hidden), an improved draft-saved modal with email option on first save only, inline "Draft updated" feedback on subsequent saves, and proper error/feedback state separation.

**Architecture:** All changes are self-contained in `src/app/forms/f/[slug]/page.tsx`. A new API route `src/app/api/forms/public/[slug]/drafts/[draftCode]/email/route.ts` and a matching service function `emailPublicFormDraft` in `src/services/form-builder.service.ts` are needed for the email feature. No schema changes.

**Tech Stack:** Next.js 14 App Router, React, Tailwind CSS, lucide-react icons, existing `sendEmail` utility, existing `Modal`/`Button`/`ModalBody`/`ModalFooter` components.

---

## Task 1: Add new UI labels

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:42-120` (DEFAULT_UI_LABELS object)

**Step 1: Add the new label keys to DEFAULT_UI_LABELS**

Find the `resume_link_copy_failed` entry (line ~100) and add after it:

```ts
  draft_active: 'Draft active',
  update_draft: 'Update draft',
  updating_draft: 'Updating...',
  draft_updated: 'Draft updated',
  send_draft_to_email: 'Send to my email',
  draft_email_sent: 'Sent to {email}',
  draft_email_failed: 'Failed to send',
  draft_email_placeholder: 'name@example.com',
```

**Step 2: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: add draft UI label keys for stateful card redesign"
```

---

## Task 2: Split draftFeedback state into draftError + draftFeedback

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` — state declarations (~line 843), all call sites

**Step 1: Replace the single `draftFeedback` state with two states**

Find (around line 843):
```ts
const [draftFeedback, setDraftFeedback] = useState<string | null>(null);
```

Replace with:
```ts
const [draftError, setDraftError] = useState<string | null>(null);
const [draftFeedback, setDraftFeedback] = useState<string | null>(null);
```

**Step 2: Update `saveDraft` function (~line 1698)**

- Change `setDraftFeedback(uiLabel('preview_save_draft_notice'))` → `setDraftFeedback(uiLabel('preview_save_draft_notice'))`  (keep as feedback, not error)
- Change `setDraftFeedback(uiLabel('draft_save_disabled_notice'))` → `setDraftFeedback(uiLabel('draft_save_disabled_notice'))` (keep as feedback)
- Change `setDraftFeedback(null)` at start → also add `setDraftError(null)`
- Change the catch block: `setDraftFeedback(...)` → `setDraftError(...)`
- Change `setDraftFeedback(null)` before opening modal → keep as-is (clears feedback)

**Step 3: Update `resumeDraftByCode` function (~line 1763)**

- Change `setDraftFeedback(null)` at start → also add `setDraftError(null)`
- Change the catch block: `setDraftFeedback(...)` → `setDraftError(...)`

**Step 4: Update `copyResumeLink` function (~line 1794)**

- `setDraftFeedback(uiLabel('resume_link_unavailable'))` → `setDraftError(uiLabel('resume_link_unavailable'))`
- `setDraftFeedback(uiLabel('resume_link_copied'))` → `setDraftFeedback(uiLabel('resume_link_copied'))` (keep as success feedback)
- `setDraftFeedback(uiLabel('resume_link_copy_failed'))` → `setDraftError(uiLabel('resume_link_copy_failed'))`

**Step 5: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "refactor: split draftFeedback into draftError and draftFeedback states"
```

---

## Task 3: Add isFirstDraftSave state and wire to saveDraft

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Add state near other draft states (~line 844)**

```ts
const [isFirstDraftSave, setIsFirstDraftSave] = useState(true);
```

**Step 2: Update `saveDraft` success path (~line 1746)**

After `applyResolvedDraftPayload(...)`, replace:
```ts
setDraftFeedback(null);
setIsDraftDetailsModalOpen(true);
```

With:
```ts
setDraftError(null);
if (isFirstDraftSave) {
  setIsDraftDetailsModalOpen(true);
  setIsFirstDraftSave(false);
} else {
  setDraftFeedback(uiLabel('draft_updated'));
  setTimeout(() => setDraftFeedback(null), 3000);
}
```

**Step 3: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: show draft saved modal only on first save, inline feedback on subsequent saves"
```

---

## Task 4: Add draft banner feedback state + auto-clear

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Add `draftBannerFeedback` state near draft states**

```ts
const [draftBannerFeedback, setDraftBannerFeedback] = useState<string | null>(null);
```

**Step 2: Update the `saveDraft` else branch from Task 3**

Replace `setDraftFeedback(uiLabel('draft_updated'))` with:
```ts
setDraftBannerFeedback(uiLabel('draft_updated'));
setTimeout(() => setDraftBannerFeedback(null), 3000);
```

And remove the `draftFeedback` call added in Task 3.

**Step 3: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: add draftBannerFeedback state for inline update confirmation"
```

---

## Task 5: Redesign the draft card — Idle state

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:3318-3378`

**Step 1: Replace the idle card JSX**

Find the current card block starting at `{draftSettings.enabled && !isPreview && currentPage === 0 && (` (~line 3318).

Replace the entire block with:

```tsx
{draftSettings.enabled && !isPreview && currentPage === 0 && (
  <>
    {!draftSession ? (
      // --- IDLE STATE ---
      <div className="mb-6 rounded-xl border border-border-primary/50 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">{localizedUiLabels.resume_draft}</p>
            <p className="mt-0.5 text-xs text-text-secondary leading-relaxed">
              {resumeDraftDescription}
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:flex-row lg:w-auto">
            <input
              type="text"
              value={resumeDraftCodeInput}
              onChange={(e) => {
                const nextValue = e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 5);
                setResumeDraftCodeInput(nextValue);
                if (draftError) setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && DRAFT_CODE_PATTERN.test(resumeDraftCodeInput.trim())) {
                  resumeDraftByCode();
                }
              }}
              placeholder={localizedUiLabels.resume_draft_placeholder}
              className="h-10 w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-0 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150 sm:h-9 sm:min-w-44"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={resumeDraftByCode}
              isLoading={isResumingDraft}
              disabled={!DRAFT_CODE_PATTERN.test(resumeDraftCodeInput.trim())}
            >
              {isResumingDraft ? localizedUiLabels.resuming_draft : localizedUiLabels.resume_draft}
            </Button>
          </div>
        </div>
        {draftError && (
          <p className="mt-2.5 text-xs text-status-error">{draftError}</p>
        )}
      </div>
    ) : (
      // --- ACTIVE STATE (rendered in Task 6) ---
      null
    )}
  </>
)}
```

**Step 2: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: redesign draft card idle state with Enter key support and error styling"
```

---

## Task 6: Redesign the draft card — Active state (session banner)

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` — the `null` placeholder from Task 5

**Step 1: Replace the `null` placeholder with the active banner**

```tsx
// --- ACTIVE STATE ---
<div className="mb-6 rounded-xl border border-oak-primary/30 bg-oak-primary/5 px-4 py-3 shadow-sm">
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-2 min-w-0">
      <span className="h-2 w-2 shrink-0 rounded-full bg-oak-primary" />
      <div className="min-w-0">
        <span className="text-sm font-semibold text-text-primary">{localizedUiLabels.draft_active}</span>
        {draftBannerFeedback ? (
          <p className="text-xs text-oak-primary mt-0.5">{draftBannerFeedback}</p>
        ) : draftSession.expiresAt ? (
          <p className="text-xs text-text-secondary mt-0.5">
            {localizedUiLabels.draft_expires_label}: {formatDraftDateTime(draftSession.expiresAt)}
          </p>
        ) : null}
      </div>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {draftSession.resumeUrl && (
        <button
          type="button"
          onClick={copyResumeLink}
          title={localizedUiLabels.copy_resume_link}
          className="flex items-center justify-center h-8 w-8 rounded-lg border border-border-primary/50 bg-white text-text-secondary hover:text-text-primary hover:border-border-primary transition-colors duration-150"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  </div>
  {draftError && (
    <p className="mt-2 text-xs text-status-error">{draftError}</p>
  )}
  {draftFeedback && !draftBannerFeedback && (
    <p className="mt-2 text-xs text-text-secondary">{draftFeedback}</p>
  )}
</div>
```

**Step 2: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: add draft active session banner with expiry display and copy link button"
```

---

## Task 7: Update "Save draft" → "Update draft" button label in nav bar

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:3440-3450`

**Step 1: Update the nav bar button label**

Find (~line 3440):
```tsx
{draftSettings.enabled && !isPreview && (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    onClick={saveDraft}
    isLoading={isSavingDraft}
  >
    {isSavingDraft ? localizedUiLabels.saving_draft : localizedUiLabels.save_draft}
  </Button>
)}
```

Replace with:
```tsx
{draftSettings.enabled && !isPreview && (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    onClick={saveDraft}
    isLoading={isSavingDraft}
  >
    {isSavingDraft
      ? (draftSession ? localizedUiLabels.updating_draft : localizedUiLabels.saving_draft)
      : (draftSession ? localizedUiLabels.update_draft : localizedUiLabels.save_draft)}
  </Button>
)}
```

**Step 2: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: update save draft button label to 'Update draft' when session is active"
```

---

## Task 8: Add draft email state + auto-detect email from form answers

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Add new state near other draft states**

```ts
const [isDraftEmailExpanded, setIsDraftEmailExpanded] = useState(false);
const [draftEmailInput, setDraftEmailInput] = useState('');
const [isDraftEmailSending, setIsDraftEmailSending] = useState(false);
const [draftEmailFeedback, setDraftEmailFeedback] = useState<string | null>(null);
const [draftEmailSent, setDraftEmailSent] = useState(false);
```

**Step 2: Add auto-detect logic — derive initial email from form answers**

Add a derived value (after existing derived values section, e.g. after `resumeDraftDescription`):

```ts
const detectedEmailFromForm = useMemo(() => {
  if (!orderedFields) return '';
  for (const field of orderedFields) {
    if (EMAIL_HINT_PATTERN.test(field.key) || EMAIL_HINT_PATTERN.test(field.label ?? '')) {
      const val = answers[field.key];
      if (typeof val === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
        return val.trim();
      }
    }
  }
  return '';
}, [orderedFields, answers]);
```

**Step 3: Pre-fill `draftEmailInput` when modal opens**

In `saveDraft`, before `setIsDraftDetailsModalOpen(true)`, add:
```ts
setDraftEmailInput(detectedEmailFromForm);
setDraftEmailSent(false);
setDraftEmailFeedback(null);
setIsDraftEmailExpanded(false);
```

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: add draft email state and auto-detect email from form answers"
```

---

## Task 9: Add sendDraftEmail function

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` (add function near other async handlers)
- Create: `src/app/api/forms/public/[slug]/drafts/[draftCode]/email/route.ts`
- Modify: `src/services/form-builder.service.ts` (add `emailPublicFormDraft`)

**Step 1: Add service function `emailPublicFormDraft` in form-builder.service.ts**

Append after `emailPublicFormResponsePdfLink`:

```ts
export async function emailPublicFormDraft(
  slug: string,
  draftCode: string,
  recipientEmail: string,
  resumeUrl: string
): Promise<void> {
  const form = await prisma.form.findFirst({
    where: { slug, deletedAt: null },
    select: { title: true },
  });

  if (!form) throw new Error('Form not found');

  const email = recipientEmail.trim().toLowerCase();
  const safeFormTitle = form.title.replace(/[<>&]/g, (m) =>
    m === '<' ? '&lt;' : m === '>' ? '&gt;' : '&amp;'
  );

  const subject = `Your draft for: ${form.title}`;
  const html = `
    <p>Hello,</p>
    <p>Here are your draft details for <strong>${safeFormTitle}</strong>.</p>
    <p><strong>Draft code:</strong> ${draftCode}</p>
    <p><strong>Resume link:</strong> <a href="${resumeUrl}">${resumeUrl}</a></p>
    <p>Use the code or link to continue filling out your form.</p>
    <p>If you did not request this email, you can ignore it.</p>
  `;

  const result = await sendEmail({ to: email, subject, html });
  if (!result.success) {
    throw new Error(result.error || 'Failed to send email');
  }
}
```

**Step 2: Create API route `src/app/api/forms/public/[slug]/drafts/[draftCode]/email/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { emailPublicFormDraft } from '@/services/form-builder.service';

const emailPayloadSchema = z.object({
  email: z.string().email().max(320),
  resumeUrl: z.string().url().max(2048),
  accessToken: z.string().min(1),
});

interface RouteParams {
  params: Promise<{ slug: string; draftCode: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { slug, draftCode } = await params;

    const ip = getClientIp(request);
    const rl = checkRateLimit(
      getRateLimitKey('form-draft-save', `${ip}:${slug}:email`),
      RATE_LIMIT_CONFIGS.FORM_DRAFT_SAVE
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const payload = emailPayloadSchema.parse(body);

    await emailPublicFormDraft(slug, draftCode, payload.email, payload.resumeUrl);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 3: Add `sendDraftEmail` handler in page.tsx**

Add near `copyResumeLink`:

```ts
async function sendDraftEmail() {
  if (!draftSession) return;

  const normalizedEmail = draftEmailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    setDraftEmailFeedback(uiLabel('email_invalid'));
    return;
  }

  setIsDraftEmailSending(true);
  setDraftEmailFeedback(null);
  try {
    const response = await fetch(
      `/api/forms/public/${slug}/drafts/${encodeURIComponent(draftSession.draftCode)}/email`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          resumeUrl: draftSession.resumeUrl,
          accessToken: draftSession.accessToken,
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || uiLabel('draft_email_failed'));
    }
    setDraftEmailFeedback(uiLabel('draft_email_sent', { email: normalizedEmail }));
    setDraftEmailSent(true);
    setTimeout(() => setIsDraftEmailExpanded(false), 1500);
  } catch (err) {
    setDraftEmailFeedback(err instanceof Error ? err.message : uiLabel('draft_email_failed'));
  } finally {
    setIsDraftEmailSending(false);
  }
}
```

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx \
        src/app/api/forms/public/\[slug\]/drafts/\[draftCode\]/email/route.ts \
        src/services/form-builder.service.ts
git commit -m "feat: add draft email API route and sendDraftEmail handler"
```

---

## Task 10: Redesign the Draft Saved modal

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:3486-3546`

**Step 1: Replace the modal body and footer**

Find the entire `<Modal isOpen={isDraftDetailsModalOpen ...}>` block (~lines 3486–3546) and replace with:

```tsx
<Modal
  isOpen={isDraftDetailsModalOpen && !!draftSession}
  onClose={() => {
    setIsDraftDetailsModalOpen(false);
    setDraftError(null);
  }}
  title={uiLabel('draft_saved_title')}
  description={draftValidityNotice}
  size="lg"
>
  <ModalBody className="space-y-4">
    {/* Draft code */}
    <div className="rounded-xl border border-oak-primary/20 bg-oak-primary/8 px-4 py-3">
      <p className="text-xs font-medium text-text-secondary">{localizedUiLabels.draft_code_label}</p>
      <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-oak-primary select-all">
        {draftSession?.draftCode}
      </p>
    </div>

    {/* Resume URL with inline copy */}
    <div className="rounded-lg border border-border-primary/50 bg-background-primary px-4 py-3">
      <p className="text-xs font-medium text-text-secondary mb-1.5">{uiLabel('resume_link_label')}</p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={draftSession?.resumeUrl || ''}
          className="min-w-0 flex-1 rounded-md border border-border-primary/40 bg-background-secondary px-3 py-2 text-sm text-text-primary focus:outline-none"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <button
          type="button"
          onClick={copyResumeLink}
          title={localizedUiLabels.copy_resume_link}
          className="flex items-center justify-center h-9 w-9 shrink-0 rounded-md border border-border-primary/50 bg-white text-text-secondary hover:text-text-primary hover:border-border-primary transition-colors duration-150"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
      {draftSession?.expiresAt && (
        <p className="mt-1.5 text-xs text-text-muted">
          {localizedUiLabels.draft_expires_label}: {formatDraftDateTime(draftSession.expiresAt)}
        </p>
      )}
      {draftFeedback && (
        <p className="mt-1.5 text-xs text-text-secondary">{draftFeedback}</p>
      )}
    </div>

    {/* Send to email — collapsible */}
    {!draftEmailSent ? (
      <div className="rounded-lg border border-border-primary/50 bg-background-primary overflow-hidden">
        <button
          type="button"
          onClick={() => {
            setIsDraftEmailExpanded((prev) => !prev);
            setDraftEmailFeedback(null);
          }}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors duration-150"
        >
          {localizedUiLabels.send_draft_to_email}
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', isDraftEmailExpanded && 'rotate-180')} />
        </button>
        {isDraftEmailExpanded && (
          <div className="border-t border-border-primary/40 px-4 pb-4 pt-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={draftEmailInput}
                onChange={(e) => {
                  setDraftEmailInput(e.target.value);
                  if (draftEmailFeedback) setDraftEmailFeedback(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendDraftEmail();
                }}
                placeholder={localizedUiLabels.draft_email_placeholder}
                className="h-9 w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={sendDraftEmail}
                isLoading={isDraftEmailSending}
              >
                {localizedUiLabels.send}
              </Button>
            </div>
            {draftEmailFeedback && (
              <p className={cn('mt-2 text-xs', draftEmailFeedback.startsWith('Sent') || draftEmailFeedback.startsWith('发') ? 'text-text-secondary' : 'text-status-error')}>
                {draftEmailFeedback}
              </p>
            )}
          </div>
        )}
      </div>
    ) : (
      <p className="text-xs text-text-secondary px-1">{draftEmailFeedback}</p>
    )}
  </ModalBody>
  <ModalFooter>
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => {
        setIsDraftDetailsModalOpen(false);
        setDraftError(null);
      }}
    >
      {uiLabel('continue_editing')}
    </Button>
  </ModalFooter>
</Modal>
```

**Step 2: Add `ChevronDown` to the lucide-react import at the top of the file**

Find:
```ts
import { ArrowLeft, CheckCircle2, Copy, Download, Info, Mail, Plus, UploadCloud, X } from 'lucide-react';
```

Replace with:
```ts
import { ArrowLeft, CheckCircle2, ChevronDown, Copy, Download, Info, Mail, Plus, UploadCloud, X } from 'lucide-react';
```

**Step 3: Fix email feedback color logic**

The `draftEmailFeedback` color check in step 1 uses a string-starts-with hack. Replace it with a dedicated `draftEmailError` state:

Add state:
```ts
const [draftEmailError, setDraftEmailError] = useState<string | null>(null);
```

In `sendDraftEmail`:
- On validation fail: `setDraftEmailError(...)` instead of `setDraftEmailFeedback(...)`
- On catch: `setDraftEmailError(...)` instead of `setDraftEmailFeedback(...)`
- On success: `setDraftEmailFeedback(...)` only, clear `setDraftEmailError(null)`
- Also `setDraftEmailError(null)` on input onChange

Update modal JSX: show `draftEmailError` in `text-status-error` and `draftEmailFeedback` in `text-text-secondary` separately.

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: redesign draft saved modal with prominent code, inline copy, collapsible email step"
```

---

## Task 11: Visual polish pass

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

This task ensures visual consistency across all three states and the modal.

**Step 1: Verify `bg-oak-primary/8` renders — check Tailwind config**

If `bg-oak-primary/8` is not a standard Tailwind utility, use `bg-oak-primary/[0.08]` instead. Check any existing usage of `oak-primary/` opacity variants in the file for the correct pattern. Replace in both the idle card (if used) and active banner.

**Step 2: Active banner — ensure `draftFeedback` (copy link success) renders correctly**

The active banner currently shows `draftFeedback` below the banner. Make sure `copyResumeLink` sets `draftFeedback` (not `draftError`) so it renders in `text-text-secondary`, not error red.

**Step 3: Confirm `draftError` is cleared on `setDraftSession`**

In `applyResolvedDraftPayload` (~line 985), ensure `setDraftError(null)` is called when a draft session is successfully set. Add it alongside the existing `setDraftFeedback(null)` call.

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "fix: visual polish - opacity classes, clear errors on draft apply"
```

---

## Task 12: Manual smoke test

No automated tests exist for this page (it's a large client component). Do a manual pass:

1. Load a published form with drafts enabled at `/forms/f/[slug]`
2. **Idle card:** Verify input + button renders, Enter key triggers resume, invalid code keeps button disabled
3. **Resume:** Enter a valid draft code, verify card collapses to active banner with expiry
4. **Save draft (first time):** Click "Save draft" — modal opens with prominent code, copy URL button, collapsible email section
5. **Email step:** Expand email section, verify auto-fill if email field present, send email, verify confirmation + collapse
6. **Continue editing:** Modal closes, banner shows "Draft active" + expiry, button now says "Update draft"
7. **Update draft:** Click "Update draft" — modal does NOT open, banner briefly shows "Draft updated", expiry resets
8. **Error state:** Enter wrong code — verify error appears in red below input
9. **Copy link:** Click copy icon in banner — verify `draftFeedback` shows "Resume link copied" in gray

```bash
# Start dev server
npm run dev
```

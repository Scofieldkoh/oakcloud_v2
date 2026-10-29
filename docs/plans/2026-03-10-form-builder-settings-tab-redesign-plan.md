# Form Builder Settings Tab — Collapsible Sections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganise the flat settings tab into 5 collapsible bordered-card sections with summary text, improving scannability and discoverability.

**Architecture:** A local `SettingsSection` component wraps each group of settings. Each section has a header row (icon + title + summary + chevron) that toggles the body. No new global state — each section manages its own `open` boolean via `useState`. The existing settings JSX is reorganised into the 5 sections with no logic changes.

**Tech Stack:** React (useState), Tailwind CSS, Lucide icons (already imported). No new dependencies.

---

### Task 1: Add `SettingsSection` component to `page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`

**Context:** The file already imports `ChevronDown` and `Sparkles` from `lucide-react`. We need to add `Globe`, `Bell`, `Users`, `Paintbrush` to the existing import.

**Step 1: Update the lucide-react import**

Find line 21 in `page.tsx`:
```ts
import { ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardCopy, Copy, Plus, Save, Sparkles } from 'lucide-react';
```

Replace with:
```ts
import { Bell, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardCopy, Copy, Globe, Paintbrush, Plus, Save, Sparkles, Users } from 'lucide-react';
```

**Step 2: Add the `SettingsSection` component**

Find the line that declares `type BuilderTab` (around line 322):
```ts
type BuilderTab = 'form' | 'language' | 'settings';
```

Insert the following component **above** that line:

```tsx
function SettingsSection({
  icon,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border-primary bg-background-primary">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5 shrink-0 text-text-muted">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold text-text-primary">{title}</span>
          {!open && (
            <span className="block text-2xs text-text-muted truncate">{summary}</span>
          )}
        </span>
        <ChevronDown
          className={`mt-0.5 w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border-primary px-3 pb-3 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Verify the component compiles (no runtime step needed — TypeScript will catch issues on save)**

---

### Task 2: Restructure the settings JSX into 5 sections

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx` (lines 1606–1803)

**Context:** The entire `{activeTab === 'settings' && (...)}` block needs to be replaced. The underlying state variables (`status`, `tagsText`, `slug`, `notificationRecipientsText`, etc.) are all unchanged — we're only reorganising the JSX.

**Step 1: Replace the settings tab JSX block**

Find the block starting at line 1606:
```tsx
          {activeTab === 'settings' && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Status</label>
```

And ending at line 1803:
```tsx
              <p className="text-2xs text-text-muted inline-flex items-center gap-1">
                <CircleHelp className="w-3 h-3" />
                Publish to make this form available at public URL and embed code.
              </p>
            </>
          )}
```

Replace the entire block with:

```tsx
          {activeTab === 'settings' && (
            <>
              {/* Publishing */}
              <SettingsSection
                icon={<Globe className="w-3.5 h-3.5" />}
                title="Publishing"
                summary={`${status.charAt(0) + status.slice(1).toLowerCase()} · ${slug || 'no slug'}`}
                defaultOpen
              >
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED')}
                    className="w-full rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PUBLISHED">Published</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </div>
                <FormInput label="Tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="intake, registration" />
                <FormInput
                  label="Custom URL segment"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  onBlur={(e) => setSlug(normalizeSlugSegment(e.target.value))}
                  placeholder="client-intake-form"
                  hint="Use lowercase letters, numbers, and hyphens."
                />
                <div className="text-2xs text-text-muted">
                  Public URL: <span className="font-mono text-text-secondary">{publicUrlPreview}</span>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full min-h-24 rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary"
                    placeholder="Describe this form"
                  />
                </div>
                <p className="text-2xs text-text-muted inline-flex items-center gap-1">
                  <CircleHelp className="w-3 h-3" />
                  Publish to make this form available at public URL and embed code.
                </p>
              </SettingsSection>

              {/* Notifications */}
              <SettingsSection
                icon={<Bell className="w-3.5 h-3.5" />}
                title="Notifications"
                summary={(() => {
                  const count = notificationEmailParse.validEntries.length;
                  return count === 0 ? 'No recipients' : `${count} recipient${count === 1 ? '' : 's'}`;
                })()}
                defaultOpen
              >
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Completion notification emails</label>
                  <textarea
                    value={notificationRecipientsText}
                    onChange={(e) => setNotificationRecipientsText(e.target.value)}
                    className="w-full min-h-24 rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary"
                    placeholder={'ops@example.com\nowner@example.com'}
                  />
                  <p className="mt-1 text-2xs text-text-muted">
                    One email per line (or comma-separated). Each recipient gets a completion email with response PDF and uploaded files.
                  </p>
                  {notificationEmailParse.invalidEntries.length > 0 && (
                    <p className="mt-1 text-2xs text-status-error">
                      Invalid emails: {notificationEmailParse.invalidEntries.join(', ')}
                    </p>
                  )}
                </div>
              </SettingsSection>

              {/* Respondent */}
              <SettingsSection
                icon={<Users className="w-3.5 h-3.5" />}
                title="Respondent"
                summary={draftSaveEnabled ? `Save draft enabled · ${draftAutoDeleteDays} days` : 'Save draft off'}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-text-secondary">Enable save draft</p>
                    <p className="text-2xs text-text-muted">Allow respondents to save progress and resume later with a draft code and secure resume link.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draftSaveEnabled}
                    onClick={() => setDraftSaveEnabled((value) => !value)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      draftSaveEnabled ? 'bg-oak-primary' : 'bg-border-primary'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        draftSaveEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                {draftSaveEnabled && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Draft auto-delete (days)</label>
                    <input
                      type="number"
                      min={MIN_FORM_DRAFT_AUTO_DELETE_DAYS}
                      max={MAX_FORM_DRAFT_AUTO_DELETE_DAYS}
                      value={draftAutoDeleteDays}
                      onChange={(e) => {
                        const nextValue = Number.parseInt(e.target.value, 10);
                        if (!Number.isFinite(nextValue)) {
                          setDraftAutoDeleteDays(DEFAULT_FORM_DRAFT_AUTO_DELETE_DAYS);
                          return;
                        }
                        setDraftAutoDeleteDays(nextValue);
                      }}
                      className="w-full rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary"
                    />
                    <p className="mt-1 text-2xs text-text-muted">
                      Drafts and their uploaded files are deleted after this many days. Allowed range: {MIN_FORM_DRAFT_AUTO_DELETE_DAYS}-{MAX_FORM_DRAFT_AUTO_DELETE_DAYS}.
                    </p>
                  </div>
                )}
              </SettingsSection>

              {/* AI Review */}
              <SettingsSection
                icon={<Sparkles className="w-3.5 h-3.5" />}
                title="AI Review"
                summary={aiParsingEnabled ? (aiParsingCustomContext ? 'Enabled · Custom context set' : 'Enabled') : 'Disabled'}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-text-secondary">Enable AI parsing</p>
                    <p className="text-2xs text-text-muted">Run an internal AI review on each completed response using the default AI model from the server environment.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aiParsingEnabled}
                    onClick={() => setAiParsingEnabled((value) => !value)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      aiParsingEnabled ? 'bg-oak-primary' : 'bg-border-primary'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        aiParsingEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                {aiParsingEnabled && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <label className="block text-xs font-medium text-text-secondary">Custom context</label>
                      <Button
                        variant="secondary"
                        size="xs"
                        leftIcon={<Sparkles className="w-3.5 h-3.5" />}
                        onClick={openAiAssistModal}
                      >
                        AI assist
                      </Button>
                    </div>
                    <textarea
                      value={aiParsingCustomContext}
                      onChange={(e) => setAiParsingCustomContext(e.target.value)}
                      rows={5}
                      className="w-full rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary"
                      placeholder="Example: Verify the declared identity details against the uploaded identification documents and flag any mismatches, PEP declarations, or unusual risk indicators."
                    />
                    <p className="mt-1 text-2xs text-text-muted">
                      Internal only. This is used for staff review and is never shown on the public form.
                    </p>
                  </div>
                )}
              </SettingsSection>

              {/* Appearance & PDF */}
              <SettingsSection
                icon={<Paintbrush className="w-3.5 h-3.5" />}
                title="Appearance & PDF"
                summary={[
                  !hideLogo && 'Logo',
                  !hideFooter && 'Footer',
                  pdfFileNameTemplate && 'PDF template',
                ].filter(Boolean).join(' · ') || 'Default appearance'}
              >
                <FormInput
                  label="PDF filename template"
                  value={pdfFileNameTemplate}
                  onChange={(e) => setPdfFileNameTemplate(e.target.value)}
                  placeholder="Form response - [full_name] - [datetime_stamp]"
                  hint="Use [field_key] plus standard variables: [datetime_stamp], [date_stamp], [time_stamp], [submission_id], [form_title], [form_slug]. [datetime_stamp] uses the tenant timezone (for example: 6 Mar 26 - 9.51PM)."
                />
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-text-secondary">Show tenant logo</p>
                    <p className="text-2xs text-text-muted">Display your organization logo beside the form title.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!hideLogo}
                    onClick={() => setHideLogo((v) => !v)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      !hideLogo ? 'bg-oak-primary' : 'bg-border-primary'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        !hideLogo ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-text-secondary">Show copyright footer</p>
                    <p className="text-2xs text-text-muted">Display © [Tenant Name] at the bottom of the form</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!hideFooter}
                    onClick={() => setHideFooter((v) => !v)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      !hideFooter ? 'bg-oak-primary' : 'bg-border-primary'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        !hideFooter ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </SettingsSection>
            </>
          )}
```

**Step 2: Verify the `notificationEmailParse` variable exists**

Search for `notificationEmailParse` in `page.tsx` to confirm it is already defined as a derived value from `notificationRecipientsText`. If it doesn't exist, add this near the other derived state (around line 350+):

```ts
const notificationEmailParse = useMemo(() => {
  const raw = notificationRecipientsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const validEntries: string[] = [];
  const invalidEntries: string[] = [];
  for (const entry of raw) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)) {
      validEntries.push(entry);
    } else {
      invalidEntries.push(entry);
    }
  }
  return { validEntries, invalidEntries };
}, [notificationRecipientsText]);
```

**Step 3: Commit**

```bash
git add src/app/\(dashboard\)/forms/\[id\]/builder/page.tsx
git commit -m "feat: reorganise form builder settings into collapsible sections"
```

---

### Task 3: Manual verification

Open the form builder in the browser and navigate to the Settings tab. Verify:

1. **Publishing** section is open by default — Status, Tags, URL, Description visible
2. **Notifications** section is open by default — email textarea visible
3. **Respondent**, **AI Review**, **Appearance & PDF** are collapsed by default
4. Summary text shows correctly for each collapsed section:
   - Respondent: `Save draft off` (or `Save draft enabled · N days` if enabled)
   - AI Review: `Disabled` (or `Enabled` / `Enabled · Custom context set`)
   - Appearance & PDF: `Logo · Footer` (if both shown) or `Default appearance`
5. Clicking any section header toggles it open/closed
6. Chevron rotates 180° when section is open
7. Save the form — all settings still persist correctly

# Form Builder Settings Tab — Collapsible Sections Redesign

> **Date**: 2026-03-10
> **Status**: Approved

## Problem

The Settings tab is a flat list of ~10 unrelated fields with no visual grouping. Users cannot quickly find what they need (scannability) and don't know which advanced settings exist (discoverability).

## Solution

Reorganise settings into 5 collapsible bordered-card sections. Each section header shows a summary of current values when collapsed, enabling full-panel scannability without opening anything.

## Section Definitions

| # | Title | Icon | Default | Fields |
|---|-------|------|---------|--------|
| 1 | Publishing | `Globe` | Open | Status, Tags, Custom URL segment, public URL preview, Description |
| 2 | Notifications | `Bell` | Open | Completion notification emails |
| 3 | Respondent | `Users` | Collapsed | Enable save draft toggle, Draft auto-delete days |
| 4 | AI Review | `Sparkles` | Collapsed | Enable AI parsing toggle, Custom context textarea + AI assist button |
| 5 | Appearance & PDF | `Paintbrush` | Collapsed | PDF filename template, Show tenant logo toggle, Show copyright footer toggle |

The "Publish to make this form available…" hint moves inside the Publishing section footer.

## `SettingsSection` Component

A new local component (defined in `page.tsx` or extracted to a small file) with this interface:

```ts
interface SettingsSectionProps {
  icon: React.ReactNode;
  title: string;
  summary: React.ReactNode; // shown only when collapsed
  defaultOpen?: boolean;
  children: React.ReactNode;
}
```

### Header anatomy

```
┌──────────────────────────────────────────────────────┐
│ [icon] Title                              [chevron] │
│        summary text (hidden when open)              │
└──────────────────────────────────────────────────────┘
```

- Outer: `rounded-lg border border-border-primary bg-background-primary`
- Header row: `flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none`
- Icon: `w-3.5 h-3.5 text-text-muted shrink-0`
- Title: `flex-1 text-xs font-semibold text-text-primary`
- Summary: `text-2xs text-text-muted` — only rendered when `!open`
- Chevron: `ChevronDown w-3.5 h-3.5 text-text-muted transition-transform duration-150`, rotated 180° when open
- Body: `px-3 pb-3 space-y-3 border-t border-border-primary` — only rendered when `open`

### Summary strings

| Section | When collapsed shows |
|---------|---------------------|
| Publishing | `{statusLabel} · {slug}` (e.g. `Published · kyccdd-individual`) |
| Notifications | `{n} recipient{s}` or `No recipients` |
| Respondent | `Save draft enabled · {n} days` or `Save draft off` |
| AI Review | `Enabled · Custom context set` / `Enabled` / `Disabled` |
| Appearance & PDF | Comma-joined active items from: `Logo`, `Footer`, `PDF template` |

## Styling consistency fix

The two standalone toggle rows (Show tenant logo, Show copyright footer) currently have no card wrapping. Inside the Appearance & PDF section body, they will use the same `flex items-center justify-between` pattern as the save-draft and AI parsing toggles — no extra card wrapping needed since the section card provides the container.

## Implementation scope

- One new `SettingsSection` component (~40 lines)
- Restructure the `activeTab === 'settings'` JSX block in `page.tsx` — no state changes, no logic changes
- No new dependencies

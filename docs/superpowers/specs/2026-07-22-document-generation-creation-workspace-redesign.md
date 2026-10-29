# Document Generation Creation Workspace Redesign

## Status

Approved for implementation planning on 2026-07-22.

## Objective

Make document creation faster and clearer by replacing the current five-step
wizard with a focused three-stage workspace that follows the strongest patterns
from Oakcloud Forms and E-signing and uses extra-wide monitors purposefully.

## Scope

This redesign covers the internal `/generated-documents/generate` experience:

- Combining Template and Company into **Setup**.
- Combining People and Custom Fields into **Details**.
- Turning Edit & Preview into **Review & Generate**.
- Replacing singular party dropdowns with searchable radio-card lists.
- Keeping general contacts multi-select through searchable checkbox-card lists.
- Adding a responsive workspace shell, persistent draft status, stage navigation,
  contextual summaries, and a wide-screen review layout.

The redesign preserves generation payloads, validation semantics, document
preview and editing, template/company/contact search APIs, draft persistence,
draft restoration, unsaved-navigation protection, letterhead behavior, and the
generated-document destination.

## Experience Principles

1. A user should understand the next required action without reading a manual.
2. The interface should expose only data required by the selected template.
3. Users should be able to review or revise earlier choices without losing work.
4. Wide screens should gain useful parallel context, not stretched form fields.
5. Oakcloud's compact four-pixel-grid design, light/dark themes, and accessible
   interaction patterns remain authoritative.

## Information Architecture

### Stage 1: Setup

Setup contains two task sections: template selection and company selection.
Template selection remains search-first and shows category, description,
placeholder count, version, and preview access. Company selection remains
search-first and includes the explicit no-company option where allowed.

On wide screens the two sections may sit beside each other, but each list keeps a
readable width and independent vertical rhythm. The current selection is echoed
in a contextual summary so it remains visible when the list is searched.

Each task section places that contextual summary directly below its heading as a
compact selected-value strip. The template strip shows the selected template
name and category. The company strip shows the selected company name and UEN,
or clearly states `No company selected` when company context is intentionally
omitted. Both strips update immediately when the user changes a selection.

The task header contains only the back link and `Create document` title; it does
not repeat workflow instructions or draft-saving guidance. The three-stage
indicator keeps `Review & Generate` on one line at supported viewport widths.

### Stage 2: Details

Details contains:

- Required singular Director, Shareholder, and Company Contact selections.
- Optional or required general Contacts multi-selection.
- Document title.
- Custom template fields.
- Letterhead preference.

Singular party choices use searchable radio-card lists. General contacts use
searchable checkbox-card lists with selected count and Clear all. Each row shows
the person's name and available designation, email, or phone. Selected rows stay
visible while filtering, and Oak green communicates selection.

Sections that the template does not require are omitted. Required state, helper
copy, inline errors, loading, retry, empty, and no-match states live inside the
relevant section so the page does not jump between unrelated error surfaces.

### Stage 3: Review & Generate

The editable A4 preview is the primary surface. A contextual panel contains:

- Template, company, people, title, and custom-field completion summary.
- Blocking validation issues and non-blocking warnings.
- Links to reopen Setup or Details.
- Generation state and the final Generate Document action.

Clicking a summary link returns to the appropriate stage without discarding the
preview. When a validation issue maps to a known input, its action returns to and
focuses that input. Editor-specific issues remain associated with the document
canvas.

## Workspace and Responsive Layout

The route uses a compact task header containing Back to Documents, the current
draft/document title, Saved/Unsaved/Saving status, and Save draft. A compact
three-stage indicator sits below it. Completed stages are directly revisitable.

Navigation actions remain visible in a sticky bottom action bar. Back is placed
on the left; Save draft and Continue or Generate are grouped on the right.

- **Mobile, 320-639px:** one stacked column, compact stage header, 44px touch
  targets, and full-width bottom actions where needed.
- **Standard desktop, 640-1439px:** one primary content column with readable
  section widths; review context appears above or beside the canvas when space
  permits.
- **Wide desktop, 1440px and above:** the shell can exceed `max-w-7xl`. Setup and
  Details use a bounded primary column plus contextual rail. Review uses an A4
  canvas and a sticky 320-384px sidebar.

Form controls never expand merely because viewport width is available. Search
and text fields retain sensible maximum widths, and list rows retain scannable
line lengths.

## Visual System

The redesign reuses Oakcloud tokens and existing component language:

- Compact rounded surfaces with subtle borders and minimal shadows.
- Oak green selected, active, and focus states.
- `text-2xl` page titles, `text-lg` section headings, `text-sm` body and controls,
  and `text-xs` supporting metadata.
- Four-pixel-grid spacing and 32-36px desktop controls.
- Restrained Oak-tinted headers rather than decorative gradients or new artwork.
- Existing semantic error, warning, success, and muted colors in both themes.

No generated visual concept is required; the user explicitly chose the existing
Forms, E-signing, and Oakcloud design system as the visual reference.

## Draft Compatibility and State Mapping

The persisted generation-session schema remains version 1. Existing five-step
draft indices map into the new stages on restore:

| Existing step | Existing label | New stage |
| --- | --- | --- |
| 0 | Template | 0 — Setup |
| 1 | Company | 0 — Setup |
| 2 | People | 1 — Details |
| 3 | Custom Fields | 1 — Details |
| 4 | Edit & Preview | 2 — Review & Generate |

Newly saved drafts persist only stage indices 0-2. A restored review draft is
still gated on current company and party eligibility before the editor appears.
Stale or removed selections continue to invalidate dependent preview content.

## Accessibility and Interaction

- Radio-card groups expose native radio semantics and an accessible group label.
- Checkbox-card lists expose native checkbox semantics and selected count.
- Search fields have explicit labels even when the visible label is compact.
- Every row supports pointer and keyboard activation without nested duplicate
  interactive behavior.
- Focus states meet existing Oakcloud conventions.
- Sticky regions do not obscure focused controls or mobile content.
- Loading, errors, no results, and disabled actions are announced appropriately.
- Unsaved-navigation protection and draft-resume messaging remain intact.

## Testing and Verification

Component tests cover stage mapping, three-stage navigation, conditional Details
sections, radio-card selection, checkbox-card multi-selection, restored drafts,
validation gating, direct stage revision, and generation payload parity.

Browser verification covers the complete creation path at mobile, standard
desktop, and an extra-wide viewport. It checks sticky actions, list keyboard
behavior, no horizontal overflow, readable field widths, wide-screen pane
allocation, preview editing, draft saving, and final generation.

## Acceptance Criteria

- The visible workflow has exactly Setup, Details, and Review & Generate.
- All existing generation inputs and payload values remain available.
- Singular parties use searchable radio-card lists; general contacts use a
  searchable checkbox-card list.
- Templates, company choices, and earlier stages can be revised without losing
  unrelated work.
- Existing five-step server drafts restore into the correct new stage.
- Review uses a dedicated contextual sidebar on extra-wide screens.
- Mobile remains usable at 320px with 44px touch targets and no horizontal trap.
- Draft save, resume, validation, preview, edit, generation, and unsaved guards
  continue to work.
- Relevant unit/component tests, TypeScript, ESLint, production build, and
  browser verification pass.

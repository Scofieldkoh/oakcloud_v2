# TODO / Roadmap

> **Last Updated**: 2026-09-29

This document tracks known issues, planned features, and completed work for Oakcloud.

## Development Guidelines

Oakcloud is in production use and holds real client data. Preserve existing records, stored preferences and public links when changing behaviour, and never delete or rewrite business records as a side effect of a code change.

Key principles:

- Keep code modular, reusable, and consistent
- Update documentation under `docs/` whenever feature behavior changes
- Follow [Design Guidelines](./guides/DESIGN_GUIDELINE.md) for UI work
- Record unrelated issues or follow-up work here

## Priority Legend

| Priority | Description |
|----------|-------------|
| **P0** | Critical / blocking |
| **P1** | High priority |
| **P2** | Standard backlog |
| **P3** | Nice to have |

## Status Legend

| Status | Description |
|--------|-------------|
| Open | Not started |
| In Progress | Currently being worked on |
| Blocked | Waiting on dependency |
| Done | Completed |
| Superseded | No longer applies; the note says what replaced it |

## Known Issues

### Document Vault

| ID | Priority | Status | Description | Notes |
|----|----------|--------|-------------|-------|
| DOC-001 | P2 | Open | Async auto-extraction error handling | Errors only logged to console, not stored in database |
| DOC-002 | P2 | Open | N+1 query in duplicate detection | Could load thousands of documents; add filters to reduce candidate set |
| DOC-003 | P1 | Open | Merge and split document not working | Core functionality incomplete |

### Document Generation

| ID | Priority | Status | Description | Notes |
|----|----------|--------|-------------|-------|
| GEN-001 | P2 | Implemented | Save draft to pause functionality | Explicit Save Draft persists multiple server-backed generation sessions; users can resume or discard a selected draft, while Generate Document always starts clean |
| GEN-002 | P2 | Open | Remove page number from templates/partials | User request |
| GEN-003 | P2 | Open | Letterhead rendering issues | Various formatting problems |
| GEN-004 | P2 | Open | Share button issues | Format, comment, and notification problems |
| GEN-005 | P3 | Open | Export details without line items | Option to exclude AI extraction data |
| GEN-006 | P2 | Superseded | A4 editor blank-page browser test is flaky | The A4 editor and this test were removed when OakDoc became the only editor (PRs #62-#66) |
| GEN-007 | P1 | Implemented | Multi-template document generation batches | One unified four-stage workspace (Documents, Shared setup, Configure, Review & generate) replaces the single-template wizard and split steppers; resumable batches, server-derived master fields, per-item overrides, editable review, partial success, and targeted retry are implemented |

### UI/UX

| ID | Priority | Status | Description | Notes |
|----|----------|--------|-------------|-------|
| UI-001 | P2 | Open | Mobile responsiveness improvements | General responsive issues across modules |

### Developer Tooling

| ID | Priority | Status | Description | Notes |
|----|----------|--------|-------------|-------|
| DEV-001 | P2 | Done | Repository typecheck is blocked by stale renderer verification types | Removed the scratch file `tmp/verify-renderer.ts`; `tmp/` is now ignored (2026-09-29) |

### Forms

| ID | Priority | Status | Description | Notes |
|----|----------|--------|-------------|-------|
| FORMS-002 | P1 | Open | Published form render snapshot | Store optimized published schema separately from editable builder draft so live public forms only change on publish |
| FORMS-003 | P2 | Open | Async cached response PDFs | Generate response PDFs in a background job and reuse cached artifacts for repeated downloads |
| FORMS-004 | P2 | Open | Progressive rendering for long public forms | Reduce full-form recalculation/render work on every answer change, especially with conditions and repeat sections |

## Planned Features

### Phase 1 - Near Term

| Feature | Priority | Status | Description |
|---------|----------|--------|-------------|
| Deadline Management | P1 | Planned | Company deadline tracking and alerts |
| KYC/CDD Module | P1 | Planned | Know Your Customer / Customer Due Diligence compliance |
| Tasks And Pipelines | P1 | Complete | Tenant-scoped versioned pipelines, immutable task snapshots, stage adapters, and responsive workspaces |

### Phase 2 - Medium Term

| Feature | Priority | Status | Description |
|---------|----------|--------|-------------|
| E-Signature | P1 | Planned | Digital signature integration for documents |
| Salesrooms | P2 | Planned | Client proposal and presentation rooms |

### Phase 3 - Long Term

| Feature | Priority | Status | Description |
|---------|----------|--------|-------------|
| Bank Reconciliation | P1 | Planned | Bank transaction matching and multi-currency support |
| Client Portal | P1 | Planned | Client access, document requests, communications |
| Accounting Integration | P2 | Planned | Xero, QuickBooks, MYOB connectors |

## Completed

| ID | Completed | Description |
|----|-----------|-------------|
| TASKS-001 | 2026-07-27 | Replaced the retired Workflow/Projects module with Tasks and Pipelines, including a complete legacy data reset and tenant-aware Client Onboarding seed |
| GEN-007 | 2026-08-12 | Replaced the one-document-at-a-time wizard and split Service Agreement stepper with the unified batch workspace |
| FORMS-008 | 2026-09-29 | Incorporation form version 4: company type and name ending as dropdowns (full private ending list), officer roles hidden for a company shareholder (option-level conditions), separate shareholder and director nominator names, Yes/No tick boxes on the review page, Check name required before continuing, every field labelled so the publish check passes |
| FORMS-007 | 2026-09-29 | Incorporation form version 3: four company types, chosen name ending (names entered without it), alternative name 1 required, each person's particulars (ID number, nationality, address, contact number, email), constitution options for the model as at adoption or from time to time with a link to the current model, new field widths, no form description |
| FORMS-006 | 2026-09-29 | Incorporation form version 2 from Scofield's review: seeded by script instead of "Start from"; company type with name-ending check; alternative names checked too; no name reservation, SSIC review, contact timing, share structure, office hours, 52-week year or "not sure" answers; roles include managing director, CEO and company secretary as buttons; per-person resident/nominee/control ticks; pages stop until shareholdings total 100%, there is an individual director and a resident director (or our nominee director service); whole-share check; nominee director and secretary services as tick boxes |
| FORMS-005 | 2026-09-29 | Singapore Company Incorporation intake template with review step, advisory name check, locked published definition, link-only notifications and staff KYC readiness checklist; fixed repeated short-text answers being dropped on submit |
| FORMS-001 | 2026-03-10 | Implemented the Forms module with builder, public links, draft save/resume/email, uploads, response review, response PDF export, and queued AI review |

## Notes

- Add new items with the next available ID in their category.
- Move finished work to the Completed section.
- Keep this file aligned with shipped module status.

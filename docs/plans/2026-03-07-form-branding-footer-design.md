# Form Branding — Copyright Footer Design

**Date:** 2026-03-07

## Overview

Add a copyright footer (`© [Tenant Name]`) to the public form view, toggleable per form via a new `hideFooter` setting, defaulting to shown.

## Data Layer

- Add `tenantName: string | null` to `PublicFormDefinition` (form-utils.ts) and `FormDetail` (form-builder.service.ts).
- Both `getPublicFormBySlug` and `getFormById` already join `tenant`; extend the select to include `name`.
- Store `hideFooter` as a boolean in the existing freeform `Form.settings` JSON — no migration needed.

## Form Builder

- Add `hideFooter` state to the builder page (default `false`), read from `settingsObj.hideFooter === true` on load.
- Add a "Show copyright footer" toggle in the settings tab, below the existing "Show tenant logo" toggle.
- Pass `hideFooter` to all `serializeBuilderState` calls (dirty-checking) and write `hideFooter: hideFooter === true` into the `persistForm` settings payload.

## Public Form View

- Derive `shouldShowFooter = !!tenantName && hideFooter !== true` via `useMemo`.
- Render a centered footer below the form card: `© [tenantName]` in small muted text.
- Also wire `tenantName` into the preview object literal (same pattern as `tenantLogoUrl`).

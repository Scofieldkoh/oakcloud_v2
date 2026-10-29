# Form Dropdown Presets and URL Health Design

**Date:** 2026-08-01
**Status:** Approved for implementation planning

## Summary

Improve the Forms module in four related areas:

1. Allow large dropdown lists, including the full Singapore Standard Industrial Classification (SSIC) list, without exceeding the current 500-option field validation limit.
2. Add workspace-managed dropdown presets that can be created and maintained through CSV upload with minimal interface footprint.
3. Allow respondents to clear an optional dropdown selection.
4. Add plain styling and backend-only broken-link monitoring for URL information blocks.

## Goals

- Provide protected Countries, Nationalities, and SSIC presets.
- Let authorized workspace users create, update, and delete custom preset lists.
- Keep dropdown fields linked to presets so preset changes propagate automatically.
- Continue supporting manually entered options, including lists larger than 500 items.
- Keep historical submission values unchanged when preset labels or entries change.
- Warn authenticated users about persistently broken URL information blocks without changing the public form.
- Follow the existing compact Forms UI and scheduler patterns.

## Non-goals

- Automatically disabling or hiding links on public forms.
- Sending email or other external notifications for broken links.
- Synchronizing SSIC from an external government endpoint automatically.
- Versioning every historical preset revision.
- Supporting nested options in dropdown presets.

## Preset Data Model

Add a workspace-scoped `FormOptionPreset` model. A preset stores:

- Stable ID and workspace ID.
- Unique workspace-scoped name and normalized key.
- Preset kind: built-in or custom.
- Built-in identifier where applicable: `countries`, `nationalities`, or `ssic`.
- Whether the preset is protected from deletion.
- Whether CSV replacement is permitted.
- Options as a JSON array of `{ value, label }` objects.
- Option count and standard audit timestamps/user identifiers.

Countries and Nationalities are protected, application-maintained presets. SSIC is protected from deletion but can be replaced through CSV. Custom presets can be created, replaced, renamed, and deleted when unused.

Each dropdown field gains an optional preset reference. A linked dropdown resolves the preset's current options when the form is loaded, previewed, published, or submitted. A dropdown without a preset reference continues to use options embedded in the field record.

Preset updates are immediately visible to all linked forms. Existing submissions continue storing their original string values and are not rewritten. Response displays should fall back to the stored value if it no longer exists in the current preset.

Deletion of a custom preset is blocked while any active or archived form field references it. The API returns its usage count so the management UI can explain why deletion is unavailable.

## Large Dropdown Lists

The current server validation rejects more than 500 options. Increase the generic embedded dropdown limit to 5,000 options. Apply the same ceiling consistently to request validation, CSV validation, builder serialization, and persistence tests.

Linked presets keep form-save payloads small because the field sends only its preset reference rather than copying every option. Manually pasted dropdowns remain embedded and therefore retain the explicit option-count and request-size safeguards.

Dropdown options preserve distinct values and labels. The visible SSIC label can use `code - description`, while the submitted value remains the SSIC code.

## Preset Management UI

Add a secondary **Preset lists** button beside **New Form** on the Forms page. It opens one compact modal with:

- Preset name.
- Built-in or custom status.
- Option count.
- Last updated time.
- Number of forms using the preset.
- Available create, update, and delete actions.

Protected presets display a lock indicator. Countries and Nationalities cannot be deleted or replaced. SSIC cannot be deleted but exposes **Update CSV**. Custom presets expose update and delete actions, with delete disabled when usage is non-zero.

### CSV Import

The importer accepts UTF-8 CSV files in either format:

- A `label` column; `value` defaults to the label.
- `value` and `label` columns.

Column matching is case-insensitive and trims surrounding whitespace. Blank rows are ignored. Values must be non-empty and unique within the preset. Labels must be non-empty. Imports are limited to 5 MB and 5,000 valid option rows; both limits are validated before persistence.

Before saving, show a preview containing:

- Detected columns.
- Total and valid row counts.
- Duplicate and rejected row counts.
- Row-numbered errors.
- A small sample of parsed options.

Malformed rows or duplicate values block the import. Replacement is atomic: validation failure leaves the prior preset unchanged.

### Field Editor

The dropdown field editor offers:

- Built-in presets.
- Workspace custom presets.
- A **Custom options** choice for manually entered lines.

Selecting a preset links the field to that preset. It does not copy the current options. Switching to Custom options detaches the preset and initializes editable options from the currently resolved list so the user does not unexpectedly lose visible choices.

## Dropdown Clearing

The public form's dropdown control becomes clearable when the field is not read-only. Clearing writes an empty value through the existing answer-state path.

Optional dropdowns remain empty. Required dropdowns may be cleared during editing, but the existing required-field validation prevents page progression or submission until another option is selected.

Timezone and phone-country selectors retain their current non-clearable behavior because they are not form dropdown fields and have separate defaults.

## URL Plain Text Style

Expose **Plain text style** for `info_url` fields as well as information text fields.

When enabled, the public form renders the anchor without the surrounding rounded border or background card. Link label, target behavior, width, inline placement, padding/background overrides, PDF visibility, and stop-progression behavior continue using existing field settings. The PDF renderer applies the same behavior by omitting its `info-box` wrapper while retaining the outer layout block.

## URL Health Monitoring

Register a daily task in the existing scheduler with a default `0 2 * * *` cron pattern. It examines HTTP/HTTPS URLs from URL information blocks on active, non-deleted forms.

Health records are stored separately from `FormField` and keyed by workspace ID, form ID, and stable field key. This avoids losing history because the current field-save operation deletes and recreates form-field rows.

A health record contains:

- Last checked URL and a normalized URL fingerprint.
- Last checked time.
- Last successful time.
- Classification: healthy, unable to verify, or failed.
- Last HTTP status or concise error code/message.
- Consecutive definite-failure count.
- Time at which the broken warning became active.

Changing the URL resets prior failure history. Removing the URL or field removes stale health state during reconciliation.

### Classification

- `2xx` and accepted redirects are healthy.
- DNS failures, connection failures, timeouts, redirect failures, `404`, and `410` are definite failures.
- `401`, `403`, and `429` are unable to verify and do not activate a broken warning.
- Other `4xx` and `5xx` responses are definite failures.

A successful check resets the consecutive-failure count. A backend warning activates after two consecutive definite daily failures. An unable-to-verify result is visible in detailed status but neither activates nor increments a broken warning.

### Safe Fetching

The checker must:

- Accept only HTTP and HTTPS.
- Resolve destinations and reject loopback, private, link-local, multicast, and other non-public address ranges for IPv4 and IPv6.
- Revalidate every redirect target and allow at most five redirects.
- Use a 10-second timeout per request attempt.
- Prefer `HEAD`, with a minimal bounded `GET` fallback only for `405` or `501` responses.
- Limit fallback response reads to 64 KB.
- Check at most 500 URLs per run with concurrency limited to five requests.

These controls prevent form-authored URLs from turning the scheduler into an internal network probe or unbounded downloader.

## Backend Warning Surfaces

Public forms remain unchanged and links remain clickable regardless of health state.

Authenticated Forms surfaces show warnings only after the two-failure threshold:

- A warning indicator and count on affected form entries.
- An inline warning in the affected URL field's builder settings.
- Last checked time, last HTTP status or error, and a concise explanation.

The Forms page should obtain warning summaries without fetching every individual health record. The builder may request detailed records for the current form.

## API and Authorization

Preset list and URL-health endpoints are tenant-scoped through the existing workspace resolver and authorization helpers.

- Reading presets and health warnings requires form/document read permission.
- Creating, replacing, renaming, or deleting presets requires form/document update permission.
- Built-in protections and in-use deletion checks are enforced server-side, not only in the UI.
- All preset mutations produce audit-log entries including preset name, option count, and action.

The scheduler operates across tenants using server-side service functions and never trusts a tenant identifier supplied by a URL record.

## Error Handling

- Invalid CSV returns structured row and column errors suitable for preview display.
- Duplicate preset names or normalized keys return a conflict response.
- In-use deletion returns a conflict response with usage count.
- Preset replacement is transactional and never leaves partial options.
- If a linked preset cannot be resolved, the builder shows a configuration warning and form APIs fail closed instead of silently presenting an empty required dropdown.
- Scheduler failures are isolated per URL; one unreachable destination does not abort the run.

## Testing Strategy

Follow red-green-refactor for each behavior.

### Validation and Services

- Accept embedded dropdowns above 500 and up to the new ceiling; reject above it.
- Parse both supported CSV shapes with literal expected options.
- Reject duplicate values, blank required columns, malformed CSV, excessive rows, and excessive files.
- Create, replace, rename, and delete custom presets within tenant boundaries.
- Protect built-ins and block deletion of in-use presets.
- Resolve updated preset options for already-linked fields.
- Preserve historical response values after preset changes.

### UI

- Render the Preset lists action next to New Form.
- Preview imports and show actionable row errors.
- Link and detach presets in the dropdown editor.
- Clear optional dropdowns and enforce required validation after clearing.
- Offer Plain text style for URL blocks and render the bare-link variant.
- Display backend warnings only after the threshold.

### URL Checker and Scheduler

- Classify success, redirects, definite failures, and unable-to-verify responses.
- Activate warnings only after two consecutive definite failures and clear them after success or URL change.
- Reject private and loopback IPv4/IPv6 destinations and unsafe redirect targets.
- Enforce timeouts, redirect limits, body bounds, batch limits, and bounded concurrency.
- Verify scheduler export, registration, enablement, and default daily cron pattern.

### Regression Verification

- Existing Countries and Nationalities behavior remains available.
- Existing custom embedded dropdowns load and save unchanged.
- Timezone and phone selectors remain non-clearable.
- Public links remain clickable when backend health warnings are active.
- Full focused test suites, type checking, and linting pass before completion.

## Documentation

Update the existing Forms/API and environment-variable documentation under `docs/` with:

- Preset management and CSV format.
- Generic option and import limits.
- Scheduler enablement and cron override for URL health checks.
- URL health classification and backend warning behavior.

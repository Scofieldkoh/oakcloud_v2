# BizFile New-Company Review Redesign

## Goal

Redesign the new-company BizFile preview so a user can efficiently compare the extracted data with the source document, correct every extracted value, add missing records, remove incorrect records, and save the corrected dataset.

This design applies only to the new-company preview. The existing-company update and diff flow remains unchanged.

## Success Criteria

- Every field represented by `ExtractedBizFileData` is visible and editable.
- Users can add, duplicate, edit, and remove repeating records where applicable.
- The BizFile remains visible beside the review interface on desktop.
- Missing required values and invalid values are easy to locate before saving.
- The server saves the corrected client-submitted dataset rather than the original extraction snapshot.
- Existing upload, cancel, reset, keyboard shortcut, conflict handling, dark-mode, and responsive behavior continues to work.

## Information Architecture

The preview remains a resizable two-panel workspace:

- Left: existing BizFile document viewer.
- Right: editable review workspace.

The review workspace has three persistent layers:

1. A compact header containing only the review title and workflow status.
2. Sticky section navigation showing reviewed and validation state.
3. A sticky action footer containing upload-again, cancel, and confirm-and-save actions.

The editable content is divided into these sections:

1. Entity
2. Addresses
3. Business activities
4. Capital
5. Officers
6. Shareholders
7. Auditor
8. Compliance and financial year
9. Charges
10. Document details

## Field Coverage

### Entity

- UEN
- Name
- Former name
- Date of name change
- Former names history: name, effective from, effective to
- Entity type
- Status
- Status date
- Incorporation date
- Registration date

### Addresses

- Registered address: block, street, level, unit, building, postal code, country, effective from
- Mailing address: block, street, level, unit, building, postal code, country

### Business Activities

- Primary SSIC code and description
- Secondary SSIC code and description

### Capital

- Home currency
- Paid-up capital amount and currency
- Issued capital amount and currency
- Share capital rows: class, currency, number of shares, par value, total value, paid-up flag, treasury flag
- Treasury shares: number of shares and currency

### Officers

- Name
- Role
- Identification type and number
- Nationality
- Address
- Appointment date
- Cessation date

### Shareholders

- Name
- Type
- Identification type and number
- Nationality
- Place of origin
- Address
- Share class
- Number of shares
- Percentage held
- Currency

### Auditor

- Name
- Address
- Appointment date

### Compliance and Financial Year

- Financial year-end day and month
- FYE as at last annual return
- Last AGM date
- Last annual return filing date
- Accounts due date
- Compliance FYE as at last annual return

### Charges

- Charge number
- Charge type
- Description
- Charge holder name
- Amount secured
- Amount secured text
- Currency
- Registration date
- Discharge date

### Document Details

- Receipt number
- Receipt date

Optional fields remain visible even when extraction returns no value, allowing the user to fill data the AI missed.

## Interaction Design

At desktop widths, section navigation is a sticky tab strip across the top of the editor rather than a vertical sidebar. It uses concise labels: Entity, Addresses, Activities, Capital, Officers, Shareholders, Auditor, Compliance, Charges, and Document. Each tab retains a text label and semantic state icon; tabs with validation issues show their issue count. Selecting a section does not affect the document viewer or draft data, and the selected tab scrolls into view when necessary.

Previous and next icon buttons beside the tab strip move one section at a time and wrap at the ends. They expose descriptive accessible labels and shortcut hints. `Ctrl + <` and `Ctrl + >` provide the same wrapped navigation unless focus is in an input, textarea, select, or content-editable element. When focus is within the tab list, Left Arrow and Right Arrow move focus and selection using a roving `tabIndex`. The navigation uses `tablist`, `tab`, and `tabpanel` semantics, and handled shortcuts alone call `preventDefault`.

Scalar fields use the application's standard inputs, selects, date controls, number controls, and checkboxes. Enumerated fields use constrained selects when the accepted values are known. Codes and identifiers use a monospace value style while retaining the standard input appearance.

Former names, share-capital classes, officers, shareholders, and charges are repeating row editors. Each supports add, duplicate, and remove. Destructive removal is reversible during the unsaved editing session through an inline undo affordance. Empty optional singleton groups such as auditor or mailing address remain available as editable groups rather than disappearing.

The compact header contains only the `Review extracted information` title and the current workflow status. Section totals, reviewed totals, issue totals, record totals, AI provider/model/usage/cost metadata, and the generic AI accuracy warning are not displayed in this workspace.

The sticky footer keeps these actions visible:

- Upload Different File
- Cancel
- Confirm & Save

The existing keyboard shortcuts remain: `Ctrl+Backspace` cancels and `Ctrl+S` attempts save. The equivalent macOS Command modifier follows the workspace's existing shortcut convention. If validation fails, save is prevented, the affected tab is scrolled into view, and focus moves to the first invalid field. Navigating away after any edit prompts for confirmation.

## Responsive Behavior

At desktop widths, the document and form stay side by side with the existing resizable divider. The document panel and review-content panel have equal heights, with the action footer outside that measurement. Their shared content height is exactly `min(780px, 100dvh)`. Each panel owns its internal scrolling, and the review tabs remain sticky at the top of the editor.

At narrower widths, the interface uses document and review tabs rather than compressing both panels. The review section navigation becomes a compact select control. Editable row layouts stack into labeled field groups while keeping row actions accessible.

## Component Boundaries

The large upload page should delegate the new-company review UI to focused components:

- Review workspace: owns section selection, compact header, shortcut registration, and footer composition. Its public props do not include unused AI metadata.
- Sticky tab navigation: derives reviewed and error states and provides accessible pointer, button, and keyboard navigation without a new dependency.
- Field sections: render and update their corresponding schema slice.
- Repeating record editor: provides consistent add, duplicate, remove, and undo behavior.
- Validation summary: maps issues to sections and fields.

Form state and mutations remain controlled by the review workspace or a dedicated hook. Static field definitions and validation rules live outside React render functions. The update/diff preview retains its current implementation and is not migrated as part of this work.

## Data Flow

1. Upload and extraction continue to populate `extractedData`.
2. The preview initializes an editable draft from that extraction result.
3. User edits update the draft immutably, including nested and repeating values.
4. Client validation runs while editing and before submission.
5. Confirm sends the complete corrected draft in the request body.
6. The confirm route validates and normalizes the submitted draft, persists that exact corrected version to the pending document, and passes it to `processBizFileExtraction`.
7. On success, the existing navigation to the created company continues.

The server must not trust arbitrary client data. Request validation must reject malformed structures, invalid enumerations, non-finite or negative values where disallowed, and missing required company identifiers. Server normalization remains authoritative for formatting.

## Validation

Required fields for save are:

- Entity UEN
- Entity name
- Entity type
- Entity status
- Registered-address street name and postal code when a registered-address group exists
- SSIC code and description for each present activity
- Name and role for each officer
- Name, type, share class, and non-negative share count for each shareholder
- Share class, currency, non-negative share count, and non-negative total value for each share-capital row
- Charge holder name for each charge

Dates must use valid ISO date values. Financial year day and month must form a valid calendar date. Amounts, share counts, and percentages must be finite; share counts and monetary values cannot be negative, and percentages must be between 0 and 100. Blank optional groups are omitted from the submitted normalized structure instead of being saved as meaningless empty objects.

All optional date fields share one normalization rule: `null`, `undefined`, and blank strings are treated as absent and omitted from normalized output. Any populated optional date must still be a valid ISO calendar date. This shared rule prevents extraction-contract mismatches such as a current officer's `cessationDate: null` from becoming a validation error.

Validation messages appear next to the affected input, at section level in navigation, and in a concise save-attempt summary. Validation does not require users to manually mark each field as reviewed.

## Error Handling

- Extraction errors retain the existing upload-page behavior.
- Client validation prevents submission and directs the user to the first error.
- Server validation returns field-addressable issues when possible; the review workspace maps them back to inputs without losing the draft.
- Network or persistence failures show the existing error alert pattern and leave all edits intact for retry.
- Confirm is disabled while saving to prevent duplicate submissions.
- Removing a repeating row is locally undoable until the draft is saved or reset.

## Accessibility

- Each input has a programmatic label and associated error description.
- Section navigation is keyboard reachable and exposes its selected and error states.
- Desktop section tabs use roving focus, remain sticky while form content scrolls, and expose reviewed/error state in their accessible names rather than color alone.
- Row actions have descriptive accessible names including the record name or row number.
- Focus moves predictably after adding, removing, undoing, and attempting an invalid save.
- Status is communicated with text and icons, not color alone.
- Sticky regions do not hide focused fields or validation messages.

## Visual Direction

Follow the Oakcloud design guideline: compact Linear-inspired density, 4px layout rhythm, subtle borders, standard semantic colors, and full light/dark support. The redesign should reduce card nesting and use section dividers, labels, and restrained status indicators to establish hierarchy. The source viewer remains visually dominant enough for comparison, while editable controls make it unambiguous that values can be changed.

No generated imagery is needed because this is an existing product surface using the established design system.

## Testing Strategy

### Unit and Component Tests

- Every `ExtractedBizFileData` field is represented in the review interface.
- Empty optional fields and groups can be populated.
- Scalar and nested field edits update the draft without mutating the extraction snapshot.
- Repeating rows can be added, duplicated, removed, and restored.
- Validation derives correct section states and focuses the first error.
- Null and blank optional dates are accepted and omitted, while populated invalid dates are rejected.
- Desktop tabs support pointer selection, previous/next controls, roving focus with Left/Right Arrow, and wrapped `Ctrl + <` / `Ctrl + >` navigation.
- Removed summary and AI metadata copy is absent from the rendered workspace.
- The equal-height desktop content panels use `min(780px, 100dvh)`, and the action footer remains outside that measurement.
- Confirm submits the edited draft rather than the original extraction.
- Unsaved-change protection activates only after the draft changes.
- The existing update/diff flow continues to render unchanged.

### API Tests

- Confirm accepts a valid corrected dataset and persists/processes it.
- Confirm rejects malformed or incomplete datasets with useful validation errors.
- Confirm ignores neither valid edits nor newly added nested records.
- Failed processing does not silently replace the corrected pending extraction with stale data.

### Browser Verification

- Desktop: upload result to editable preview, edit fields, add and remove people, trigger and resolve validation, then save.
- Desktop layout: verify sticky tabs, pointer/button/keyboard section navigation, equal panel heights, the footer outside the content measurement, the `min(780px, 100dvh)` cap, and no horizontal page overflow.
- Narrow viewport: switch between document and review, edit a repeating row, and access sticky actions without overflow.
- Verify page identity, meaningful content, absence of framework overlays, console health, dark mode, keyboard shortcuts, and visible focus states.

## Out of Scope

- Redesigning the existing-company update/diff preview.
- Adding field-level document coordinates or click-to-highlight source citations, because the current extraction schema does not provide page/box provenance.
- Changing extraction models or prompts.
- Altering company-domain fields that are not represented by the BizFile extraction schema.

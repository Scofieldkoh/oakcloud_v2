# Singapore Company Incorporation Intake Form

Status: implemented (template version 4). Source: the 2026-09-28 handover spec "ACRA incorporation intake form", treated as reference and checked against the code. Version 2 follows Scofield's 19-point review of version 1, version 3 his follow-up review, and version 4 his third review (all 2026-09-29).

## What staff get

- **Seeding**: `npx tsx scripts/seed-incorporation-form.ts --email <login>` creates the form as a DRAFT in the user's workspace. Running it again updates the unpublished copy in place with the current questions. A published (locked) copy is never changed; a new draft is created beside it. There is no "Start from" choice in the New form dialog.
- The public form has four question pages plus a review step:
  1. Company details: contact name, email and mobile number; company type dropdown (exempt private, private, public limited by shares, public limited by guarantee); a dropdown of the name ending the client prefers (for private types the full list of Pte. Ltd., Sdn. Bhd., (Private) Limited, LLC and Law Corporation style endings Scofield gave, default Pte. Ltd.; for public types Limited, Ltd., Berhad or Bhd., default Limited); proposed name and alternative name 1 (required) and 2, entered without the ending and all advisory name-checked (the checker ignores endings); primary SSIC (required) and optional secondary SSIC; business description; company email.
  2. Shareholders and officers: one card per person or company. Type and roles are buttons (Shareholder, Director, Managing director, CEO, Company secretary); for a company only Shareholder is offered (option-level conditions, `ChoiceOption.condition`). Each person's particulars, all required: full name, Passport/FIN/NRIC number, nationality (dropdown), residential address, contact number and email. A company gives its UEN or registration number, place of incorporation and registered address instead. Then shareholding % (not asked for a company limited by guarantee) and ticks: lives in Singapore (directors and secretaries), nominee shareholder then "Shareholder nominator" (full name), nominee director then "Director nominator" (full name), each name asked only when its box is ticked. The review page shows tick boxes as Yes or No.
  3. Share capital and services (capital hidden for a company limited by guarantee): issued capital, currency, number of shares, fully paid (Yes/No, then amount paid); tick boxes for our nominee director service and company secretary service.
  4. Registered office and other details: own address or our registered office service, first FYE (12-month periods assumed), constitution (ACRA model as in force at adoption, ACRA model as in force from time to time, with a link to the model currently in force, or custom upload), additional instructions. The form has no description; page 1's introduction covers it.
  5. Review and submit (every answer by page with Edit links, plus items for our review).
- ACRA guidance sits on the relevant fields, with links that open in a new tab. Help on half-width fields is a tooltip, so fields side by side keep the same height.
- The form collects each person's basic particulars (version 3, at Scofield's request) but no ID uploads, declarations or signatures.
- Completion emails are link-only (no PDF or uploads). The builder's Notifications section has a **Send link only** switch for any form.
- Every template field has a label, so the builder's publish check passes (info blocks show only their text to respondents).
- Choice fields have a **Show options as buttons** switch in the builder (`validation.choiceLayout: 'chips'`).

## Rules

Code: `src/lib/forms/company-incorporation-profile.ts` (browser-safe, used on each page, on the review step and on the server).

- **Blocking (`error`)**, checked when the respondent presses Continue on the page the rule belongs to, and again on submit:
  - names are entered without an ending and must differ from each other; the chosen ending must suit the company type;
  - primary SSIC required and in the pinned catalogue; secondary different from primary; business description required;
  - every person has a role; a company can only be a shareholder; each person is listed once; nominees name who they act for;
  - shareholdings total exactly 100%, at least one shareholder and one individual director (director or managing director); at most 50 shareholders for a private company, and at most 20, all individuals, for an exempt private company; a company secretary cannot be the only director;
  - number of shares is a whole number and each shareholding gives whole shares; amount paid is below the capital when not fully paid;
  - at least one director lives in Singapore, or our nominee director service is ticked;
  - someone is company secretary and lives in Singapore, or our company secretary service is ticked;
  - 6-digit postal code; a real FYE date; option values from the form only.
- **Staff review** (stored, never blocking): names not checked or with matches, FYE more than 18 months away.
- Percentages and amounts are compared as exact decimals (`src/lib/forms/decimal-string.ts`), never floats.

## Name check

- The field's **Check mode** (builder > field > General) is `strict` or `advisory` (used by the template for all three names).
- In advisory mode the respondent must press Check name for the current name before Continue (version 4); any result, including an outage, lets them continue. On submit the server rechecks every advisory name at once with a 5-second bound; a timeout or outage records an "unavailable" result for staff instead of blocking. Client-supplied results for advisory fields are discarded.

## Storage and integrity

No Prisma migration. Everything is JSON:

- `Form.settings.template`: `{ key, version, installedAt, definitionHash, lockedAt }`. Server-owned; the builder cannot add, change or remove it, and Duplicate strips it.
- First publish sets `lockedAt` and a hash of the resolved definition. After that, field changes are rejected; the builder shows a "Questions are locked" notice.
- `FormSubmission.metadata.companyIncorporation` (profile version 4): template version, definition hash and snapshot, issues, ownership total, company type, number of shares, and party rows with immutable `party_<uuid>` ids, shares per shareholder and the per-person ticks. Version 1 records still display.
- `FormSubmission.metadata.companyIncorporationReview`: the staff checklist (below). Public payloads can never set either key.

## Staff checklist

On the response detail page, incorporation responses show **Company incorporation preparation**:

- Intake summary: SSIC labels, ownership total and number of shares, the intake's flagged items.
- People and KYC: each person with roles, shareholding and shares, and ticks (resident, nominee, shareholder and director nominators), plus people staff add. Each is linked to a KYC source with per-particular coverage ticks and a review status.
- Twelve checklist areas from the spec's internal ACRA preparation list.
- Readiness banner. "Ready for filing preparation" is internal only, not ACRA approval.

## Defaults chosen

- Shares are ordinary shares paid in cash; the model constitution is adopted as-is.
- Office hours are not asked: the rule that a registered office opens at least three hours on business days was removed with effect from 6 May 2026.
- COO and CFO are not ACRA positions, so they are not roles.
- KYC linking is manual.

## Not done / follow-ups

- No Bizfile automation and no automatic Company record creation (out of scope by design).
- No coverage audit of the firm's live KYC form. Staff tick coverage by hand.

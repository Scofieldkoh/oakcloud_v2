# Service agreement reference fidelity implementation plan

Date: **27 September 2026**. Reviewed code: **`3ec5e6e4d6868f8280ecf88a15a61e890e6e6520`**. Status: **first implementation in review (section 10); rendered page comparison, provider binding and the P1 items remain**.

Oakdoc can already generate structured service agreements, but its seeded master cannot closely reproduce the supplied agreement. The main gaps are the master document's formatting and structure, template control over generated fee and entity blocks, several variable bindings, and visual regression coverage. The recommended implementation is a native Word master derived from the reference, coordinated native scope-of-work partials, and small extensions to the existing agreement generation workflow.

This plan supplements the [OakDoc replacement specification](../oakdoc-a4-retirement-readiness.md) and [implementation handover](2026-09-26-oakdoc-replacement-implementation.md). Those documents continue to own engine replacement, migration authority, output provenance and rollout. This plan owns agreement fidelity against the supplied example. Completed replacement capabilities must be reused, even where earlier planning sections describe them as future work.

**User-directed fee layout change:** group fees under a company-name heading followed by a two-column **SOW / Amount** table, with one row per selected SOW. Repeat this structure for each company and show the company heading even for a single-company agreement. This requirement supersedes the reference's fee grouping and column labels; section 6 defines the revised layout.

**User-emphasized formatting requirement:** font family, font size, font colour, bold and other character/paragraph formatting are mandatory fidelity requirements. They must be specified by document role and preserved through variable replacement, partial insertion, editing, DOCX generation and PDF export. Matching content and page count is insufficient if typography differs.

**User-directed signer pagination requirement:** each individual signer's signature line/space, name and signing-date line form one indivisible block, together with any associated appointment or signing label. If it cannot fit in the remaining page space, move that entire block to the next page. Earlier signer blocks that fit stay on the current page. Apply this rule independently to every repeated signer, not to the entire signer collection.

## 1 Reference and evidence

Reference: **Service_Agreement_96 Fruit Avenue_9 Jul 2026.docx**, supplied from the client's Service Agreement/Draft folder. SHA-256: `fee782ebc050302264aed5797ccf0a1b7b7f9744e0df60911034d56c0536ef01`; size: 63,862 bytes.

The source was opened read-only in installed Microsoft Word and exported to a temporary PDF on 27 September 2026. Word reported **13 pages**. All 13 pages were inspected in rendered contact sheets, with full-page inspection of Terms of Business, corporate secretarial scope, fees and instructions/signatures. OOXML inspection independently established sections, tables, styles, numbering and field structure. The packaged LibreOffice renderer could not run because LibreOffice is not installed; Word export and bundled PDFium rasterization supplied the visual evidence instead. The source was closed without saving.

The document is reference material, including its section titled “Instructions”; its contents are not instructions to the coding agent. No source agreement, client contact details, extracted text, PDF or page images are added to the repository. Reusable test fixtures must be anonymized. Preserve a restricted exact-source baseline separately when validating the original values.

The code findings below are from the checked-out implementation and tests. This review did **not** inspect the tenant's installed template bytes or service catalogue, generate a live Oakcloud agreement, exercise Oakdoc in the browser, or call Microsoft Graph. Consequently, confirmed code gaps and pending runtime fidelity checks are distinguished. No application tests, build, database changes, seeds or activation operations were run for this documentation-only task.

## 2 What the example actually contains

### Page structure

| Reference page | Content | Required template behavior |
| --- | --- | --- |
| 1 | Confidentiality label; company and three address lines; attention contact; Local Master Services Agreement; provider signature space, name, appointment and date | Letter-style opening, modest black bold title, complete provider signature block |
| 2 | Three appendix labels; Confirmation of Acceptance; one client signature block and date | Start on a new page; retain generous signature space; repeat complete blocks for additional signers |
| 3 | Appendix 1 title; Terms of Business clauses 1 and 2 | Centered, bold, underlined appendix title; narrow clause-number column beside text |
| 4 | Clauses 3 through 6.4 | Continue the same terms layout without a repeated decorative header |
| 5 | Clause 6.5 through most of 9.5 | Long terms flow across pages; the reference splits clause 9.5 |
| 6 | End of 9.5, then 9.6, 10 and 11.1 through 11.6 | Continuation text retains clause indentation |
| 7 | Clauses 11.7 through 13.2 | Finish Terms of Business without pulling the next appendix onto this page |
| 8 | Appendix 2 Statement of Work; contracting parties, effective date and introductory responsibilities | Dedicated appendix opening page with substantial intentional whitespace |
| 9 | Corporate Secretarial Services scope; numbered subsection; lettered inclusions; nested register bullets; exclusions | Start service scope on a new page; preserve true list levels and restarts |
| 10 | Unaudited Financial Statement Compilation and Corporate Tax Computation & Filing; two numbered subsections and lettered lists | Second service starts a new page; long heading wraps naturally |
| 11 | Fees; Services/Amount table; three fee lines in two service groups; fee notes | Separate fees page; apply the user-directed company headings and SOW/Amount tables instead of copying the original grouping |
| 12 | Instructions; representative/specimen-signature table; variations; term; provider and client SOW signatures | Keep each signature block intact; allow overflow for more representatives/signers |
| 13 | Appendix 3; numbered client entity with UEN | New appendix page; repeat the numbered entity line |

The 13-page result is the source baseline for these exact values and service selections, not a fixed page limit for every generated agreement. Establish a revised fee-page baseline for the user-directed layout change; record any resulting pagination difference. A longer company name or more services must create additional pages rather than shrink text or clip content.

### Measured formatting and structure

All dimensions below are from the supplied DOCX. One inch is 1,440 twips; one point is 20 twips.

| Feature | Observed reference | Implementation consequence |
| --- | --- | --- |
| Page size | 11,910 × 16,840 twips, approximately A4 portrait | Preserve reference geometry initially; record any later normalization to standard A4 |
| Sections | Eight section-property records; both continuous and default next-page boundaries | Do not flatten the document into a single section or infer eight page breaks |
| Main margins | Most section records: 1,440 twips on every side; header/footer offsets 720 | About 25.4 mm margins, unlike the seed's approximately 20 mm margins |
| Other section records | Top 1,400, left 1,340, right 700; bottom 280 or 1,711 twips in three records | Imported layout residue may affect pagination. Preserve first, then simplify only against visual evidence; do not apply these margins globally |
| Columns | Section records do not request multiple text columns | Terms are a table layout, not a newspaper-column section |
| Typography | Visible body and headings predominantly Arial 10 pt, black; bold and underlining used selectively | Retain run formatting and understated hierarchy; no green display headings |
| Paragraph spacing | Frequent 276/240 automatic line spacing, or 1.15 lines; many 120-twip after-spacings; numerous local exceptions | Match style roles and important overrides rather than applying one global spacing rule |
| Character spacing | Many directly formatted runs have condensed character spacing; Normal style alone names Carlito | Copying only named styles misses actual appearance. Freeze the original run formatting before normalizing it |
| Alignment | Extensive justified prose; centered appendix titles; left-aligned service titles and fee amounts | Preserve role-specific alignment, including multiline fee text |
| Terms table | One 68-row table, width 9,072 twips; grid 567/63/8,442; frequent spans across the final two columns | Visually a narrow number column and broad text column. Cell-level `nil` borders suppress table borders; preserve the effective borderless appearance and spans |
| Fee table | Eight rows; width 9,065; grid 7,265/1,800, approximately 80/20; indent 110 | Headers are “Services” and “Amount”; gray `D9D9D9` header, black 0.5 pt grid, indented detail descriptions and spacer rows |
| Representative table | Two rows; width 9,018; grid 2,045/1,530/3,240/2,203; indent 110 | Four columns; white header; black 0.5 pt grid; body vertically centered; reference body minimum height 593 twips, about 29.7 pt |
| Numbering | Native numbering definitions for scope subsections, lettered lists, nested bullets and entity list | Preserve list definitions/restarts; Terms clause labels are text in table cells, not the same list system |
| Breaks and blank space | Three explicit page-break runs; eight sections; many empty paragraphs, particularly before the first service scope | Reproduce page intent, then replace fragile spacer paragraphs with explicit break/spacing rules where visually equivalent |
| Headers and footers | No header/footer parts, visible page numbers, logo or embedded drawing | The new reference template should add none by default; the existing seed's provider/Page footer is a deviation |
| Hyperlinks | Representative email appears blue and underlined | Preserve a valid email hyperlink with the chosen contact value, without retaining the reference address |
| Signature areas | Blank space before provider/client names; blank specimen cell | Keep semantic signing markers without printing placeholder labels in the final unsigned agreement |
| Template fields | No content controls or merge fields in the supplied source | Fields, repeats and composition slots must be deliberately authored into a sanitized copy |

The reference itself contains fragile construction: many empty paragraphs, condensed text runs, redundant numbering definitions and unusual intermediate section margins. It is the visual authority, but these artifacts are not requirements to perpetuate. Changes that improve robustness must retain the intended appearance and have a recorded before/after comparison. Do not rewrite contractual wording as part of layout cleanup.

### Typography contract

The following role matrix is the implementation target derived from the inspected reference, with the new company fee heading identified as a design choice for the requested layout. In F0, record the complete effective formatting of each role and its exceptions against the reference and revised fee-page baseline. Determine effective formatting from document defaults, paragraph/character/table styles, theme values and direct run overrides together; inspecting only `Normal` or a heading style is insufficient.

| Document role | Font and size | Colour and emphasis | Layout and exception rules |
| --- | --- | --- | --- |
| Body prose, address, attention line, dates and ordinary list text | Arial, 10 pt | Black `#000000`, regular; preserve any specifically emphasized phrases | Preserve the reference's paragraph alignment, indentation, line spacing and before/after spacing; do not bold an entire paragraph because one phrase is bold |
| Confidentiality label, agreement title and Confirmation of Acceptance | Arial, 10 pt | Black, bold | Left aligned; do not substitute enlarged or coloured heading presets |
| Appendix 1 and Appendix 2 titles | Arial, 10 pt | Black, bold, single underline | Centered; underlining belongs to these titles, not every heading |
| Appendix 3 title | Arial, 10 pt | Black, bold, no underline | Centered as in the reference |
| Terms clause-group headings and their number labels | Arial, 10 pt | Black, bold | Preserve the clause table's number/text alignment; individual clause numbers and body clauses remain regular |
| SOW titles and numbered subsection headings | Arial, 10 pt | Black, bold | Preserve reference alignment and hanging/list indentation; wrapped title lines retain the same size and weight |
| Excluded services label | Arial, 10 pt | Black, single underline, regular weight | Preserve this distinct treatment instead of applying the bold SOW-heading style |
| Company name above each fee table | Arial, 10 pt | Black, bold | Proposed treatment for the requested layout: left aligned, trailing colon, kept with the table below |
| SOW and Amount column headers | Arial, 10 pt | Black, bold on `#D9D9D9` fill | Preserve table padding and left alignment; table fill is separate from font colour |
| SOW descriptions, charge labels, amounts and frequency text | Arial, 10 pt | Black, regular | Preserve distinct multiline charge components; do not shrink the amount column's text to fit |
| Representative table header and body | Arial, 10 pt | Black, regular, with the email-link exception below | White header as in the reference; preserve body vertical centering and cell padding rather than adopting the fee-header style |
| Representative email hyperlink | Arial, 10 pt | Reference hyperlink blue and single underline | Resolve and record the exact colour from the source style/theme in F0; explicitly preserve it and the updated email target through export |
| Signature labels, provider legal name, signer name and appointment | Arial, 10 pt | Black; preserve emphasis separately for each location | Cover provider legal name is bold; SOW provider legal name and signer names/appointments are regular. SOW signing labels are bold. Do not apply one blanket signature style to every line |

No italic, strike-through, highlight, all-caps, small-caps, superscript or subscript treatment should be introduced by editor defaults or style inheritance. Preserve any such intentional source exception discovered in the complete F0 inventory and record its location. List/bullet glyphs may use their source numbering font; do not replace a square bullet with an unsupported Arial glyph merely to make every run report the same font.

Explicitly control font family and size for generated paragraphs, table cells, list labels and replacement values. Verify normal and bold font faces in the browser, Word and PDF renderer, including text entered after reopening the document. Report font substitution or missing glyphs; resolve them before visual acceptance. Do not silently substitute Aptos, Calibri or Carlito, synthesize a different appearance, or reduce font size to recover the target page count. Additional scripts require a reviewed fallback with correct glyphs and layout.

Preserve the reference's measured character spacing/kerning, paragraph spacing, tabs and line spacing where they affect wrapping. Define replacement-field spacing in the role prototype: replacing a name must not indiscriminately spread the first original character's condensed spacing across the whole new value. Any cleanup of the source's fragmented runs must retain effective font, size, colour and emphasis boundaries and pass a fresh visual comparison.

## 3 Existing capabilities to retain

| Existing capability | Repository evidence | Implication |
| --- | --- | --- |
| Agreement dates, term, entities, authorised representatives, signer subset, ordered items and entity-specific fee lines | [validation](../../src/lib/validations/service-agreement.ts), [DTOs](../../src/services/service-agreement/types.ts), [draft service](../../src/services/service-agreement/draft.service.ts) | Extend these models and validations, not a parallel agreement payload |
| Service variant and wording snapshots, explicit refresh, stale-version checks and canonical agreement hash | [snapshot](../../src/services/service-agreement/snapshot.ts), [canonical data](../../src/services/service-agreement/canonical.ts) | New identity/display inputs must participate in the same snapshot and freshness boundary |
| Native master, structural service/fee/entity slots, signer and representative repeaters, signature roles | [native seed](../../src/content/service-agreement/oaktree-service-agreement-oakdoc.ts), [agreement renderer](../../src/services/service-agreement/oakdoc-renderer.ts) | Preserve compatible tags and canonical business composition |
| Version-pinned native partials; styles, numbering, images and relationships are merged | [native partials](../../src/lib/document-editor/oakdoc-partials.ts), [partial service](../../src/services/oakdoc-partial.service.ts) | Native SOW support is implemented. Improve scoping/style handling where needed |
| Native editor with page, paragraph and section controls | [editor](../../src/components/documents/oakdoc-editor.tsx), installed `@docx-editor.dev/react` 2.21.1 | Sample fidelity requires testing; do not describe sections or page setup as entirely absent |
| DOCX output and canonical Microsoft Graph PDF conversion with revision/hash provenance | [generation](../../src/services/oakdoc-generation.service.ts), [output](../../src/services/oakdoc-output.service.ts) | Keep one DOCX/PDF authority; do not add a second HTML renderer |
| Fee header repetition and non-splitting fee rows | `oakdoc-renderer.ts`, `rowProperties` and `createFeeTable` | Improve group continuation and table presentation instead of rebuilding basic pagination |
| Permissions, tenant/company checks, draft/final lifecycle, signing and activation | Existing generation, agreement, output and e-signing services/tests | Fidelity work must preserve all these boundaries |

## 4 Gap register

Priority **P0** means required for faithful and correct reference generation. **P1** means needed for a reusable production template beyond the single sample. “Verify” means capability exists but its fidelity has not been demonstrated here.

| ID | Priority and state | Gap and impact | Required change |
| --- | --- | --- | --- |
| G01 | P0 confirmed | Native master is rebuilt from HTML with `plainText`/`sourceToBody`; inline emphasis is stripped | Author a native master from the reference, preserving OOXML runs, tables and styles |
| G02 | P0 confirmed | Seed uses Aptos, green 16/12 pt headings, smaller margins, one section and a footer absent from the reference | Apply measured Arial/black styles and reference section/page architecture; remove footer for this template |
| G03 | P0 confirmed | Terms become headings and prose paragraphs, losing the narrow clause column and table pagination | Retain the reference's borderless terms table in the master and all 13 clause groups |
| G04 | P0 confirmed | HTML service wording flattens nested register bullets; title/paragraph/list structure differs | Create native partials for the two reference services with native numbering and exclusions |
| G05 | P0 confirmed | Fee renderer hardcodes a 9,000-twip 70/30 “Description/Fee” table; groups by entity and flattens service membership | Support a company-name heading followed by a SOW/Amount table for each company, with one row per SOW; show the company heading for single-company agreements too |
| G06 | P0 confirmed | Amounts always have two decimals; dates use abbreviated months; term is printed in months | Template presentation must yield `S$500 per year`, `S$60 per year`, `S$1,200 per year`, `9 July 2026` and `1 year` |
| G07 | P0 confirmed | Effective date and term exist in data but the current agreement details form exposes only agreement date/company | Add editable effective date and term with explicit initialization and required-field checks |
| G08 | P0 confirmed | Provider legal name, provider signatory and appointment are hardcoded in content | Bind to reviewed provider configuration and snapshot the selected signatory |
| G09 | P0 confirmed implementation risk | Scalar replacement writes a full value into one `w:t`, clears other text nodes and does not construct new line-break runs | Implement/test multiline address replacement, preserve intended run style, and remove stale field text/links safely |
| G10 | P1 confirmed | Native SOW snapshots expose no item placeholder definitions; native resolution uses agreement-level context | Add typed item field definitions and scoped resolution, including conditions/repeaters inside expanded partials |
| G11 | P1 confirmed | Cover/name/address read live company values while appendix uses name/UEN snapshots; address/provider are absent from canonical identity | Freeze a consistent generation identity and provide explicit refresh semantics |
| G12 | P0 confirmed | Seed signature paragraphs lose keep-together semantics; representative row geometry differs and prints email/phone with an unconditional slash | Make each repeated signer independently indivisible across pages; preserve signature space and typography, permit breaks between signers, and use conditional contact formatting |
| G13 | P0 confirmed | First service has no explicit dedicated-page policy in the master; later items force page breaks; long source whitespace is not represented | Encode appendix, first-service, later-service, fees, instructions and entity-appendix page starts explicitly |
| G14 | P1 confirmed | Native partial merge drops section properties and lets conflicting master style IDs win | Keep section architecture in the master; give partials compatible named styles and reject unexpected layout/style loss |
| G15 | P1 confirmed | HTML SOW fallback calls `htmlToWordBlocks` without the available import-loss diagnostics | Surface losses during preview/generation or require native partials for this fidelity template |
| G16 | P0 confirmed | Existing agreement parity checks deliberately omit formatting and page layout | Add reference-bound structural and visual checks across import, edit, reopen, generation and canonical PDF |
| G17 | P0 confirmed content difference | Seed SOW introduction omits the reference's sentence applying Agreement terms unless otherwise agreed; other content/list/punctuation differences exist | Produce a full clause-by-clause text comparison and a reviewed wording manifest; no unreviewed legal edits |
| G18 | P1 verify | Exact native editor round-trip of these sections, table spans, condensed runs, hyperlinks and lists has not been established | Test the actual supplied structure with normal editing and the existing section compatibility repair |

Evidence anchors at the reviewed commit: seed conversion/styles at `oaktree-service-agreement-oakdoc.ts:61,108,277,340`; signature/representative generation at `:208,238`; fee/appendix/slot generation at `oakdoc-renderer.ts:496,637,666`; field replacement at `oakdoc-fields.ts:255`; partial section/style rules at `oakdoc-partials.ts:532,546`; native SOW snapshot at `snapshot.ts:104`; item inputs at `service-item-editor.tsx:67,189`; pipeline order at `oakdoc-generation.service.ts:366,377,417,436`; agreement setup at `service-agreement-config.tsx:39,178`; formatting at `oakdoc-context.ts:157` and `service-agreement/renderer.ts:43,58`; parity exclusions at `oakdoc-service-agreement-parity.ts:36`.

## 5 Variable and content contract

Use existing canonical tags wherever available. Names explicitly marked **proposed** below are contract proposals, not claims of implemented fields. Final names belong in the shared OakDoc registry/manifest, with types, labels, sources, validation, allowed scopes and formatting. Do not maintain independent UI and server field lists.

### Parties and identity

| Value and occurrences | Existing source or proposed binding | Behavior and gap |
| --- | --- | --- |
| Client legal name, cover and SOW opening | `company.name`; agreement primary entity | Existing field; freeze the same identity used by the entity appendix |
| Address lines, unit/building, country/postcode, cover | `company.address.letter` | Existing field; multiline native output and snapshot needed; omit empty lines without joining address components |
| Attention contact, cover | `selectedContact.name` | Existing field; make selected contact visible in setup; it may differ from signer or authorised representative |
| Client entities, appendix and service allocation | Existing `agreement.entities`, name/UEN snapshots and display order | Reuse entity selection; render a native numbered prototype; primary entity first under existing rules |
| Provider full legal name, cover and SOW | **Proposed** `provider.legalName` | Prefer existing tenant/provider business data where available, with a reviewed template-specific choice; do not invent a second company directory |
| Provider short/defined name, opening and clauses | **Proposed** `provider.displayName` or controlled wording profile | Reference uses multiple spellings of Oaktree. Record the chosen wording rather than silently correcting it |
| Provider signatory name and appointment, two signature blocks | **Proposed** `provider.signer.name`, `provider.signer.role` | Select an authorised provider signer; do not assume logged-in user or author is the signer; snapshot identity |
| Provider signing email/identity | Existing signing workflow, mapped to selected provider signer | Operational input, not necessarily visible in the agreement |
| Authorised representative name, appointment, email and mobile | Existing representative snapshots and `repeat.authorisedRepresentatives` fields | Repeat full rows; role is the agreed appointment; use source snapshots rather than mutable contact values |
| Authorised representative contact display | **Proposed** derived contact presentation | Email only, mobile only or both; no dangling slash, `null` text or invented contact value; update hyperlink relationship as well as display text |
| Client signing name and appointment, acceptance and SOW | `repeat.signers`, `signer.name`, `signer.role` | Retain ordered signer subset of representatives; repeat complete signature blocks |
| Singular/plural wording | **Proposed** controlled text variants derived from selected entity/signer count | Use approved singular/multiple-entity and “I/we” variants; avoid naive string replacement inside legal text |

### Dates and duration

| Value | Existing source or proposed presentation | Behavior |
| --- | --- | --- |
| Agreement date on cover and acceptance | `agreement.agreementDate` | Required agreement date, formatted `d MMMM yyyy` for this master; use date-only semantics to prevent timezone shifts |
| SOW effective date in Appendix 2 | `agreement.effectiveDate` | Editable and required for this template; offer “same as agreement date” as an explicit default; do not print an empty date |
| Term in the final SOW paragraph | `agreement.termMonths` plus **proposed** duration formatter | Keep 12 as canonical months and show `1 year`; 24 → `2 years`, 18 → `18 months`, 1 → `1 month` unless the wording profile specifies otherwise |
| Individual service start/end | Existing item start/end dates; item-scoped `service` context | Separate from agreement/effective date; only print where the selected SOW uses them; do not silently change billing |
| Fee commencement | Existing fee billing start date | Operational billing input; do not expose it in this sample's fee table unless requested by the template |
| Actual signature timestamp | Existing e-signing evidence; any visible signed-date field must use that workflow | Distinct from the preprinted agreement date. A proposed signing-date override must not falsify the actual event date |
| Document title and filename date | Existing document generation title/filename utilities | Produce the chosen client/date naming convention with filesystem-safe values; never use filename text as a contractual date source |

### Services and fees

| Value | Source | Behavior |
| --- | --- | --- |
| Service selection/order | Existing ordered agreement items and service variants | Reference has two SOWs; generation supports any approved selection without blank placeholder pages |
| Service heading and display label | Variant/family snapshots; **proposed** explicit display label only if canonical names cannot represent it | Reuse one label consistently across SOW heading and fee group; avoid accidental duplicate headings from renderer plus partial |
| Scope, exclusions and subheadings | Version-pinned native SOW partials | Controlled wording; preserve inclusion/exclusion order and all nested register bullets |
| Item-specific inputs | Existing item `fieldValues`; **proposed** native SOW field manifest | Typed required/default/options rules; bind under current item, not a global value shared by all SOWs |
| Service target entities | Existing item/entity associations | Keep associations in scope and fee grouping, including identical fee amounts for different entities |
| Service fee and government disbursement descriptions | Existing fee description/order and service membership | Three reference charges remain three canonical fee lines, with government-fee wording retained |
| Amount and currency | Existing fee amount/currency | Keep decimal precision operationally; whole SGD amounts display without `.00`, nonzero cents retain two digits, thousands are grouped |
| Billing frequency | Existing frequency/custom label | `ANNUALLY` displays `per year`; retain existing monthly/quarterly/semiannual/one-time/custom meanings |
| Fee group headings | Existing entity name snapshot; **proposed** company-heading prototype | Print `Company Name:` above each company's SOW/Amount table, including when there is only one company |
| SOW rows and multiple fee lines | Existing item/entity/fee associations; **proposed** SOW-row prototype | One row per SOW for the relevant company; retain labelled fee components within the row when that SOW has several charges, without silently summing them |
| Entity group order | Existing entity display order | Company heading, its SOW rows, then the next company; retain item and fee-line order within each company |
| Currency/term/date format | **Proposed** versioned template presentation settings | Reuse shared format utilities with per-template options, preserving existing templates' default output |
| Tax, expense and payment notes | Controlled master clauses | Reference has no tax amount or total row. Do not add a subtotal, GST calculation or cross-frequency total by default |

The example does not require new discount, deposit, credit or tax-calculation models. Defer those until a separate business requirement exists. Display formatting must never replace fee amount, currency or recurrence with arbitrary strings used by billing activation.

### Static wording and signature semantics

Keep “Private and confidential”, agreement/appendix headings, the 13 Terms of Business groups, the fee notes, representative instructions, variations clause and termination cross-reference in a versioned wording/master profile. Preserve clause references such as 9 and 10.2. The example contains policy constants including 30 days, 1% per month, 10%, 12 months and 90 days; these are controlled contractual terms, not automatic client-input fields. Negotiated differences require the existing reviewed wording/override process and a versioned snapshot.

Preserve the existing roles `oakdoc.signature.v1.provider`, `oakdoc.signature.v1.client-acceptance`, `oakdoc.signature.v1.authorised-representative-specimen` and `oakdoc.signature.v1.sow-client`. The same provider signs two document locations; each client signer has acceptance and SOW locations. A specimen signature is distinct from executing the contract. Do not merge those roles or infer recipients from free text. Automatic signature-coordinate extraction is outside this plan; retain the current signing placement and confirmation workflow.

For this reference, provider/client execution spaces are visibly blank. A semantic control may remain available for signing placement, but labels such as `[Signature]` and `[Specimen signature]` must not appear in the final unsigned DOCX/PDF.

## 6 Target implementation design

### Native master and service partials

Create a new versioned, initially inactive native master based on a sanitized copy of the reference. Keep the letter, acceptance, Terms table, Appendix 2 introduction, fees page wrapper, instructions/signature page and Appendix 3 wrapper in that master. Replace only variable runs and repeated regions with native content controls. Preserve the established `agreement.serviceSections`, `agreement.feeTable` and `agreement.entityAppendix` composition tags.

Create coordinated native corporate-secretarial and financial-statements/tax partial versions from the reference scopes. Use a shared named-style set for body, appendix title, service title, terms heading/text, lettered lists, register bullets, fee heading/detail, representatives and signatures. Native partials already merge numbering and relationships. Because their section properties are dropped by design, master-level layout must own section transitions. Avoid a new arbitrary section-merging engine for these two scopes.

Keep the source Terms table's numbering/content association. If later authoring needs automatic renumbering, treat that as a separate controlled change with cross-reference validation; fidelity does not require replacing stable clause labels with a new numbering system.

### Template-owned generated blocks

Extend the native composition contract with versioned row/block prototypes inside the existing structural slots. Prototype identifiers and metadata shape must be frozen before authoring the final master. Suggested roles are company heading, SOW/Amount table header, SOW row with repeatable fee components, inter-company spacing and entity-list entry. These roles are **proposed**, not currently recognized tags.

The renderer should obtain ordered records from the canonical agreement service, clone the applicable prototype, bind values, and preserve cell/paragraph/run properties. It must continue validating slot cardinality/location and unique control/relationship IDs. A styled placeholder cannot solve this today because slot replacement discards its content. Existing templates without the new layout contract must keep their current behavior; do not silently reinterpret every stored template.

Formatting belongs to each occurrence in the template, not to the variable's value. The same company name may be regular in prose and bold above the fee table. Resolve text inside its authored run/control while retaining that occurrence's effective font, size, colour, weight and decoration; inserted address lines inherit the approved address role. Preserve adjacent static runs and mixed emphasis. Cloned table rows and partials must not inherit the previous heading's bold/underline or lose explicit regular-weight overrides. Keep compatible character styles and numbering-run properties during partial merges as well as paragraph styles.

The requested fee layout is:

**Company Name:**

| SOW | Amount |
| --- | --- |
| First selected SOW | Its applicable fee amount and frequency |
| Second selected SOW | Its applicable fee amount and frequency |

**Company Name 2:**

| SOW | Amount |
| --- | --- |
| Selected SOW | Its applicable fee amount and frequency |

Render each company heading outside and immediately above its own table. Use the snapshotted legal name and a trailing colon. Include the heading even for a single company. A SOW assigned to several companies appears under each relevant company with only that company's fees. Preserve company display order, then SOW order within each company; never group records by matching amounts.

Start with the reference's 7,265/1,800-twip columns, black grid and gray header, changing the column labels to **SOW** and **Amount**. Validate wrapping against the revised fee-page baseline. For a SOW with multiple fee lines, keep one SOW row and a labelled breakdown within its cells: the corporate-secretarial row retains the service charge of `S$500 per year` and government disbursement of `S$60 per year` as distinct components. The financial-statements/tax row shows `S$1,200 per year`. Preserve matching description/amount order, currency and frequency; the three canonical fee lines remain unchanged. No aggregate amount or total is inferred from the requested layout.

Use the native representative row and signer block as repeating prototypes. Allow rows to grow. Each individual signer block must remain indivisible, with page breaks allowed between signer blocks. Do not make a table containing all signers indivisible. An oversized ordinary content row may use an explicit safe splitting policy; an oversized signer block must instead produce a layout diagnostic requiring correction before finalization, never silently split, clip or reduce its font size.

### Scoped generation and immutable context

Reuse the current generation service, with explicit scope boundaries:

1. Load and authorize the master, agreement, selected parties and pinned dependencies. Build/freeze the generation identity and template format settings.
2. Validate required global and per-item inputs from the shared manifest. Resolve canonical service ordering and fee/entity relationships.
3. Expand each SOW in its own item context, including pinned nested partials. Resolve conditions, repeaters and scalar fields within that context, preserving trusted native structure.
4. Compose the resolved service sections and cloned fee/entity prototypes into the master. Resolve remaining master-level fields, conditions and party repeats without reinterpreting completed item scopes.
5. Validate unresolved fields/slots, empty required collections, signature roles, style/layout diagnostics and the canonical dependency/context hash before persisting the preview.
6. Reuse existing reviewed-asset materialization and PDF output provenance. Edits invalidate the relevant preview/PDF/signing readiness as they do today.

Current native generation resolves global conditions/repeaters before service partial insertion and runs scalar resolution afterward. Reordering must be scoped and regression-tested; simply adding one global second pass risks binding different items to the same values or expanding a repeated region twice.

Add provider/contact/address snapshot data using existing generation/agreement metadata conventions where safe. Choose a minimal additive schema change only where typed persisted state is necessary. Include the frozen context, display settings, master hash and partial pins in freshness identity. Explicit refresh must mark reviewed output stale. Regeneration must not combine a new cover address with an old appendix identity.

### Pagination rules

The master owns new-page starts for acceptance, Appendix 1, Appendix 2, first service, fees, instructions and Appendix 3. Each reference service starts a new page; preserve that as this template's policy, while making the policy explicit rather than universal for all templates. Remove a section/page wrapper when its optional content is absent without leaving an empty page.

Use paragraph keep-with-next for headings and the following paragraph/first row. Keep each company heading with its table header and first SOW row, short SOW rows together, and signature label/space/name/appointment/date together. Repeat SOW/Amount and representative table headers on continuation pages; identify the company on a continued fee table so rows remain unambiguous. Allow a long company group to span pages rather than keeping its entire table together. Long Terms clauses may span pages as they do in the source; keep the number with the first text lines and preserve indentation on continuation. Do not apply keep-together to the entire 68-row Terms table.

Maintain the dedicated Appendix 2 introduction page and generous signature space. Replace stacks of empty paragraphs with intentional breaks and measured spacing only after comparison. Browser page count may differ from Word/Graph during editing; show and review the canonical PDF before signing, and treat material browser layout differences as defects to investigate.

### Independent pagination for each signer

The repeat unit must contain the complete signature block: the visible signature line or reserved signing space, signer name, signing-date line, and any appointment/signing label belonging to that signer. This grouping controls layout only; the date still follows the date-source contract in section 5. It must not replace an actual signing timestamp with the agreement date.

Required behavior:

1. Lay out each fully resolved signer block at its actual height, including wrapped names/appointments and reserved signature space.
2. Keep it on the current page if it fits. An exact fit must not force an unnecessary new page.
3. If it does not fit, move that block intact to the next page. Keep all earlier blocks that already fit in place; then continue laying out later signers normally.
4. Permit page breaks only between signer blocks. A signature line must never be left on one page while that signer's name or date appears on the next.
5. Preserve the intended gap between signers without using loose empty paragraphs that detach from their block or force an unnecessary blank page.

For example, when only two blocks fit on the first page, the result is:

```text
Page 1
________________
Signer 1 name
Signing date

________________
Signer 2 name
Signing date

[page break between blocks]

Page 2
________________
Signer 3 name
Signing date
```

If only the first block fits, signer 1 remains on page 1 and signer 2 moves intact to page 2. Do not preassign pages by signer index, insert a page break before every signer, or bind the last paragraph of one signer to the first paragraph of the next. Reflow must respond to edits, field-length changes, signer additions/removals and available page space.

Implement this in native DOCX structure, not only browser CSS. A content-control/repeater wrapper alone does not provide pagination protection. For a paragraph-based block, retain `w:keepLines` for every paragraph and a `w:keepNext` chain through all paragraphs except the last; explicitly disable inherited keep-with-next on the last paragraph (`w:keepNext w:val="0"`) so the chain terminates at that signer. Include the paragraph containing the signature line/space in the chain and prevent internal page-break properties. If a table prototype is needed, place one complete signer in each independent row, use `w:cantSplit`, preserve natural/minimum height, and avoid keep-with-next links between signer rows. Validate the chosen representation in the native editor, Word and canonical Graph PDF rather than assuming either property is sufficient in every renderer.

The signer prototype and every expanded instance must retain these rules after generation, save/reopen and editing. Apply the same individual-block rule to provider signing blocks; retain separate specimen-row semantics. If a resolved signer block exceeds a whole page's usable body area, report the specific block and require a content/layout correction before finalization. No fallback may split that signer, truncate text, shrink the approved font or enter an endless page-move loop.

## 7 Implementation packets and dependencies

Suggested owners are roles for dispatch, not assignments already made. Each packet has an independent exit condition. Shared files require one editor at a time.

### F0 Establish the fixture and freeze the contracts

**Owner:** integrator with document QA. **Depends on:** nothing. **Closes:** evidence prerequisites for all gaps.

- [ ] Inventory the actual installed master/partial IDs, versions and hashes read-only; compare with the checked-out seed and record tenant customizations.
- [ ] Create an anonymized reference fixture preserving text-length pressure, styles, sections, tables, list depth and line wrapping. Store the sensitive exact-source baseline only in restricted artifact storage.
- [ ] Capture Word and canonical Graph renders of the unchanged fixture; record renderer/version/font evidence, page images and structural measurements. Do not assume Word and Graph paginate identically.
- [ ] Record a typography manifest tied to fixture/master hashes: effective font family, size, colour, bold/italic/underline and other decorations, character spacing, paragraph alignment/spacing/indents, and table/numbering exceptions for every role. Include exact hyperlink colour and the revised fee company/header styles.
- [ ] Freeze the variable schema, provider source, required effective-date behavior, fee prototype roles, snapshot version and this template's page-break policy.
- [ ] Produce a complete source-versus-seed wording diff, including the missing Appendix 2 sentence, list nesting and provider spelling variants. Record deliberate deviations without changing legal text automatically.

**Exit:** reproducible fixture manifest and contracts; baseline page map confirmed; production-customized templates identified. No deployment dependency is needed to begin local implementation, but real Graph fidelity evidence remains a release gate.

### F1 Complete variables and setup

**Owner:** domain/UI engineer. **Depends on:** F0 contracts. **Closes:** G06–G11 where data/scoping applies.

Primary files: `src/lib/validations/service-agreement.ts`, `src/services/service-agreement/{types,snapshot,canonical,draft.service}.ts`, `src/lib/document-editor/{oakdoc-context,oakdoc-field-registry,oakdoc-field-manifest,oakdoc-fields}.ts`, `src/components/documents/generation-batch/service-agreement-config.tsx`, `src/components/documents/service-agreement/service-item-editor.tsx`, and generation master-field helpers. Review `prisma/schema.prisma` only if metadata cannot safely carry the required state.

- [ ] Expose effective date, term and selected attention/provider identities in the existing setup flow using existing Oakcloud form patterns.
- [ ] Add template-aware completeness checks and explicit default/refresh behavior; preserve existing permission and tenant checks.
- [ ] Validate real calendar dates, not just `YYYY-MM-DD` shape. The current schema uses a regular expression and native formatting uses local date getters. Reject impossible dates, handle leap days and keep date-only values stable across timezones; preserve explicit service-start and billing-start overrides when agreement dates change.
- [ ] Bind provider identity/signatory and freeze consistent client/contact/address values; hash these inputs.
- [ ] Support long-month dates, duration display and whole-amount suppression through template options, leaving old template defaults stable.
- [ ] Make native field replacement safe for multiline addresses, escaped characters, Unicode and hyperlink text/targets while preserving field style.
- [ ] Verify occurrence-specific formatting when the same field appears in regular prose and a bold heading; preserve surrounding mixed-style runs and explicit regular-weight overrides.
- [ ] Derive native SOW item inputs from a typed manifest and expose them through existing item forms.

**Exit:** dates/provider/identity are editable and reproducible; required inputs cannot generate incomplete output; native item values persist and refresh correctly; targeted validation, context, draft and component tests pass.

### F2 Preserve composition formatting and item scope

**Owner:** native generation engineer. **Depends on:** F0; F1 field contract before scoped integration. **Closes:** G05, G10, G12, G14, G15.

Primary files: `src/services/service-agreement/oakdoc-renderer.ts`, `src/services/service-agreement/renderer.ts`, `src/services/oakdoc-generation.service.ts`, `src/lib/document-editor/{oakdoc-partials,oakdoc-repeaters,oakdoc-generic-repeaters,oakdoc-html-import}.ts` and shared manifest/registry modules by coordinated ownership.

- [ ] Implement versioned template prototypes and backward-compatible slot fallback.
- [ ] Generate a company heading and SOW/Amount table per entity, including single-company agreements; retain one row per SOW with labelled multiple-charge breakdowns and preserve canonical amounts, billing cadence, entity association and ordering.
- [ ] Resolve each native SOW's scalars, conditions and repeats inside its own item scope after dependency expansion.
- [ ] Preserve representative row and signature block geometry and per-recipient role identity.
- [ ] Implement independent keep-together boundaries for every repeated signer, including signature line/space, name, appointment and date. End paragraph keep chains at each signer and diagnose blocks taller than a usable page.
- [ ] Keep master/partial style names coordinated; make conflicting definitions and dropped layout visible.
- [ ] Surface unsupported legacy HTML SOW losses; native fidelity templates must not silently flatten a selected clause.

**Exit:** fixture-based renderer/generation tests show correct formatting properties and different values for two uses of the same SOW; legacy templates retain their output contract; no billing or signing semantic regression.

### F3 Author the reference master and native service catalogue entries

**Owner:** template engineer. **Depends on:** F0; draft authoring can parallel F1/F2, final controls require their contracts. **Closes:** G01–G04, G12–G14, G17.

Primary files/assets: `src/content/service-agreement/oaktree-service-agreement-oakdoc.ts`, `src/content/service-agreement/oaktree-service-agreement-v1.ts` only for intentionally shared wording, `scripts/seed-service-agreement-template.ts`, and the established native partial/asset storage path. The exact fixture/asset repository path is to be chosen in F0; do not place client-filled documents in source control.

- [ ] Create an inactive new master version and two native SOW partial versions, with the measured styles, Terms table, numbering, fee prototypes and signature spaces.
- [ ] Apply and audit the typography role matrix, including font colour, bold versus regular text, selective underlining, table-header differences and signature-location exceptions; remove unintended theme/default overrides.
- [ ] Bind every variable in section 5; remove all real client data, stale email relationships and populated signature values.
- [ ] Implement page starts and representative/signature overflow rules; no footer/logo/page numbers in the reference variant.
- [ ] Author the signer repeat prototype as one indivisible block per signer, with inter-block spacing and no inherited keep-with-next link to the next signer; preserve this in both acceptance and SOW signing sections.
- [ ] Preserve all controlled terms and cross-references; record approved spelling/punctuation deviations separately.
- [ ] Seed/update only explicitly selected standard versions; customized masters and negotiated SOW overrides remain untouched.

**Exit:** reference fixture generates a complete agreement with all sections, three fee lines and all signature roles, without manual post-generation formatting or residual client data.

### F4 Prove visual and workflow fidelity

**Owner:** independent QA. **Depends on:** F1–F3 integrated. **Closes:** G16/G18 and all acceptance gates below.

- [ ] Run actual browser import → edit → save → reopen, including ordinary backspace/delete around section boundaries, undo/redo and content-control editing.
- [ ] Generate through the actual agreement/batch services, not a test-only document builder; compare the complete DOCX and canonical PDF.
- [ ] Run the fixture matrix below and inspect every generated page for baseline and overflow cases.
- [ ] Compare effective typography structurally and visually at readable full-page/detail scale. Check the same field in differently styled locations, repeated rows, merged partials, text typed after reopening, and font faces actually used in PDF output. Whole-page image similarity must not hide local formatting loss.
- [ ] Verify signer blocks at exact-fit and just-too-tall page boundaries, with one/two blocks fitting before a third, long wrapped names, optional appointments, changed preceding content and edited signer lists. Check per-block page membership in DOCX/Word, browser and canonical PDF.
- [ ] Exercise revision conflicts, explicit refresh, stale reviewed output, cross-tenant references, finalization and existing signing/activation boundaries.
- [ ] Record results, screenshots, hashes, renderer identity and any accepted deviations. A mocked Graph conversion is not visual evidence.

**Exit:** acceptance matrix passed with evidence, or named release blockers remain. Unit tests alone cannot complete this packet.

### F5 Publish the reviewed version through existing rollout controls

**Owner:** integrator/operator. **Depends on:** F4. **Closes:** operational completion.

- [ ] Run appropriate Node 24 lint/typecheck/focused tests and production build; run relevant PostgreSQL integration checks when persistence changes.
- [ ] Add a forward migration and regenerate Prisma only if F1 required a schema change; do not apply unrelated schema drift.
- [ ] Use existing template migration/seed validation authority and rollout controls. Activate the reviewed template/version for a selected tenant before wider rollout.
- [ ] Preserve existing template versions, generated agreements, negotiated snapshots and signed documents. Existing drafts move only under their established conversion/refresh policy.
- [ ] Roll back new generation by restoring the previous active selection; never overwrite historical DOCX/PDF assets. Update this plan and the replacement handover with actual evidence.

**Exit:** a user can select the reviewed template, enter agreement data, select services and generate a close match through the normal workflow without manual repair.

Execution order: **F0 → F1/F2/F3 with frozen seams → F4 → F5**. With four agents, use an integrator, domain/UI worker, generation worker and template worker; free a slot for independent QA once integrated. F1 and F2 must coordinate registry/context/generation files rather than editing them concurrently.

## 8 Acceptance and regression matrix

| ID | Fixture or check | Pass condition |
| --- | --- | --- |
| A01 | Exact supplied values in restricted QA | Source page map retained except documented effects of the requested fee layout; fee page shows the company heading and two SOW rows containing all three fee components; all terms and expected signature locations remain; no placeholder labels or extra footer |
| A02 | Anonymized baseline | Independently approved Word and Graph baselines; anonymization does not accidentally become a promise of identical wrapping to the sensitive original |
| A03 | Structural formatting | Reference page geometry, effective borders, 10 pt Arial roles, title alignment/underline, terms column widths, representative grid and list levels survive generation; fee layout matches the revised company-heading and SOW/Amount prototypes |
| A04 | Visual comparison | At equal page size/resolution, body/table edges and section-start positions match the approved baseline, using the revised baseline for the user-directed fee change; propose a 2 mm geometric tolerance, with antialiasing excluded. Every baseline page is reviewed; unexplained line-wrap/page-start changes fail even if an image score passes |
| A05 | Long company, address and contact values; Unicode and `&` | Address line breaks render correctly; safe escaping; no truncation, stale client text, squeezed fonts or awkward separator artifacts |
| A06 | One and two entities, equal-valued fees, same SOW assigned to multiple companies or used twice with different inputs | Company heading always present; one SOW/Amount table per company; correct company-specific SOW rows and fee components; independent item values and conditions; ordered appendix; no cross-item leakage |
| A07 | One, two and several representatives/signers | Correct signer subset and role per location; no duplicated provider block per client; specimen rows remain distinct; each individual signature block stays intact, while page breaks remain possible between signers |
| A08 | Email only, mobile only, both, neither | Defined required/optional behavior; no dangling `/`; email hyperlink opens the selected address; missing required values block generation |
| A09 | One service, both sample services, several services, long scope | Correct new-page policy and list restart; no duplicate titles, blank optional pages, orphaned headings or missing fee groups |
| A10 | Long company name, fee table, SOW description and multiple-charge row | Company heading stays with table header and first SOW row; continuation identifies the company and repeats SOW/Amount headers; long groups can span pages; long rows have a safe overflow policy; no clipped amount, lost charge or unauthorized total |
| A11 | Integer/cents/zero amounts, supported currencies and cadences | Correct presentation without changing billing values; zero remains distinguishable from missing; existing invalid-value rules remain enforced |
| A12 | Effective date differs from agreement date; 1/12/18/24-month terms; invalid and leap dates | Reject `2026-02-30`, accept valid leap days, and render the same calendar date in UTC, Singapore and negative-offset environments; correct full month name and singular/plural duration; retain explicit service/billing overrides and independent signing timestamp |
| A13 | Required item field, nested partial, condition and repeater | Missing required fields diagnosed in the owning item; scoped expansion occurs exactly once; version pins and nested dependency hashes remain authoritative |
| A14 | Edit, save, reopen and regenerate | No section corruption, style collision, list renumbering drift, table-width changes or loss of signature markers; existing section compatibility repair still works |
| A15 | Identity or partial changed after preview | Saved snapshots stay stable until explicit refresh; refresh invalidates preview/PDF readiness; no mix of old/new cover and appendix data |
| A16 | Permissions, output and lifecycle | Cross-tenant/master/partial/contact access denied; DRAFT/finalized boundaries preserved; signing uses current reviewed PDF; activation keeps original amounts/cadences/entity mappings |
| A17 | Typography roles across master, partials, generated rows and final PDF | Font family/size/colour, bold/regular, italic/underline and other decorations match the approved role manifest; no unexpected theme colour, fallback font, heading enlargement or shrink-to-fit. The geometric tolerance in A04 does not permit font, size, colour or emphasis mismatches |
| A18 | Same variable in different styles; mixed emphasis; edit and reopen | Each occurrence retains its own approved formatting; adjacent text and newly typed text retain their intended style; no bold/underline bleed, flattened emphasis, changed field character spacing or hyperlink-colour drift |
| A19 | Three repeated signers near a page boundary | With space for two complete blocks, signers 1 and 2 stay on page 1 and signer 3 moves intact to page 2; with space for one, only signer 1 stays. Each signature line/space, name, appointment and date share a page; no whole-collection move or forced page per signer |
| A20 | Exact fit, wrapped names, optional lines, preceding-content edits and oversized signer | Exact-fit block stays; a block that exceeds remaining space moves as a unit; removal/addition/reordering and save/reopen recalculate correctly without splitting or keep-chain bleed. A block taller than the usable page produces a specific blocking layout diagnostic, with no clipping, font shrinking or repeated blank pages |

Suggested existing suites to extend: `oaktree-service-agreement-oakdoc.test.ts`, `service-agreement-oakdoc-renderer.test.ts`, `oakdoc-service-agreement-generation.test.ts`, `oakdoc-generation-context.test.ts`, `oakdoc-fields.test.ts`, `oakdoc-partials.test.ts`, `service-agreement-schema.test.ts`, `service-agreement-draft.service.test.ts`, `service-agreement-batch-config.test.tsx`, and `service-agreement-generation.browser.test.tsx`. Use output/activation/PostgreSQL suites when the affected boundary changes. Add a reference fixture/render comparison harness rather than asserting only XML string fragments.

Pixel similarity, equal page count and text equality each catch different defects; none is sufficient alone. Store canonical DOCX/PDF hashes and visual review evidence against a specific master version, partial pins, generation context and renderer. Do not certify “close match” from the current semantic parity helper, which intentionally excludes layout.

## 9 Decisions and remaining verification

Working decisions for implementation are a reference-derived native master, Arial/black styling, no added footer, the current canonical agreement service, template-owned generated-block presentation, company headings with SOW/Amount tables even for a single company, 12-month storage with `1 year` display, and explicit new-page starts matching the sample subject to the revised fee layout. These decisions are sufficient to start F0 and local development.

The following require evidence during implementation rather than broad redesign: actual tenant template differences; provider configuration ownership; Word-versus-Graph pagination; editor round-trip preservation of the source's unusual section records; and whether source run-spacing cleanup can preserve layout. The complete wording diff must identify every deliberate content deviation before activation. These checks do not authorize new billing rules, legal-policy changes, automatic signing sends or production data migrations.

Completion means **the normal Oakcloud generation workflow produces the approved reference appearance and handles variable-length data safely**. Merely importing the source DOCX, adding placeholders, or producing 13 pages is not completion.

## 10 Implementation status (27 September 2026)

The attached agreement checked during implementation is byte-identical to this plan's reference (SHA-256 `fee782eb…ef01`, 63,862 bytes), so there is no reference-versus-plan conflict. Nothing was run against tenant data. `npx tsx scripts/seed-service-agreement-template.ts --agreement-only --email <operator email>` replaces only the agreement template; partials and services are left as they are (the firm removed scope seeding from this run on 2026-09-27). It runs only with the firm's approval.

| Gap | State | Where |
| --- | --- | --- |
| G01, G02, G03 | Done: the seeded master "Oaktree Master Services Agreement (OakDoc)" is replaced by a native OOXML build with explicit Arial 10 black runs, reference page and margins, no header or footer, borderless 567/8505 terms table | `src/content/service-agreement/oaktree-service-agreement-reference-*.ts`, `oakdoc-reference-ooxml.ts` |
| G04 | Done: Word scope partials for both services with native lettered lists, nested Wingdings register bullets and per-subsection restarts | `oaktree-service-agreement-reference-sows.ts` |
| G05 | Done, revised on 27 September 2026 at the firm's request: one 7265/1800 SOW/Amount table for the whole agreement, with a repeating header. Each company with fees adds a blank row and a bold, underlined name row. Each SOW then adds a "Statement of Work – <service>" row and one row per charge with its amount, even for a single charge. A blank row closes the table, and every cell is vertically centred. The group, SOW and charge rows are template-owned row prototypes; masters with the earlier heading-per-company prototype or none still render | `oakdoc-renderer.ts` (`renderFeePrototype`) |
| G06 | Done: whole amounts print without cents in the prototype layout (`S$1,500 per year`, `S$800.50 per year`); date controls carry a Word date format (`9 July 2026`); `agreement.term` prints `1 year`, `2 years`, `18 months` | `oakdoc-context.ts`, `oakdoc-fields.ts`, `renderer.ts` |
| G07 | Done: effective date (empty uses the agreement date) and term inputs in agreement setup; schema rejects impossible dates such as `2026-02-30` | `service-agreement-config.tsx`, `validations/service-agreement.ts` |
| G08 | Done as decided on 27 September 2026: the firm name is fixed text; the signatory name is the preparer (`system.preparerName`, looked up from the user when a caller passes an id); the appointment line stays "Director" because users have no job title | master, `resolvePreparerName` |
| G09 | Done: multi-line values write `w:br` line breaks in the field's own run; placeholder breaks are removed; email fields keep a live `mailto:` link, retargeted or removed with the value | `writeOakDocControlValue` |
| G12 | Done in markup: every signer block is a keep-with-next chain ended explicitly, rows cannot split, and the representative contact prints `email / phone` only when both exist | master, `phoneAfterEmail` |
| G13 | Done: the service slot's placeholder breaks the page, so every service starts a page; the empty break line is folded into the service title after the scope is merged | `finalizeServiceAgreementPageBreaks` |
| G16 | Partly done: structural tests for page, typography, keep chains, fee grouping, dates, address, links and merged scopes. Rendered page comparison is not done because this environment has no Word or LibreOffice Writer renderer | `__tests__/services/oaktree-service-agreement-reference.test.ts` |
| G17 | Wording copied verbatim except the 8 slips the firm approved correcting, recorded in `REFERENCE_WORDING_CORRECTIONS` | wording module |
| G14 | Done: a partial keeps its own look when merged. A paragraph or character style that resolves differently from the master's style of the same name (document defaults plus basedOn chain) is added as a self-contained copy under its own ID, and unstyled paragraphs take the partial's default style explicitly. Only table style clashes still warn | `oakdoc-partial-styles.ts` |
| G10, G11, G15, G18 | Not started (P1) | |

Known deviations from the reference, deliberate or for review:

- Condensed character spacing on roughly 1,500 reference characters is not reproduced; line wrapping can therefore differ slightly.
- Fee rows are labelled "Statement of Work – <service>" so they match the scope headings.
- The letter address keeps Oakcloud's order, as the firm decided: building first, then street and unit, then the postal line, each on its own line. The reference prints the street first.
- A fee table continued on a new page repeats its SOW/Amount header but not the company name.
- Re-running the seed no longer resets whether a seeded master is active; that stays with whoever switched it in the app.


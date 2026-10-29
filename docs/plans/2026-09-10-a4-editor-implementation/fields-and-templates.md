# FIELDS agent plan: grammar, identity, values and authoring

Status: **not started**. Owner: F. Read [README](README.md), [contracts](contracts.md), review A4E-013–018, 023, 027, 030 and the template/field journeys. W owns the template route page and all batch components; coordinate typed adapters rather than editing those files yourself.

## Context and objective

15 September 2026 follow-up: custom-field Edit/Delete actions now show text labels and use the shared Button's `leftIcon` prop. Their previous `iconOnly` buttons passed icons as children, which the shared component suppresses, leaving empty controls. The existing confirmation and field/reference-removal callbacks are retained.

Fields are currently raw editable `{{...}}` text. Client validation and the resolver use different regex grammars: `<p>{{custom.<b>note</b>}}</p>` and spaced `{{ custom.note }}` were accepted without useful errors yet remained unresolved. Plain string values are interpolated as HTML. Field rename/delete updates separate state, adapters change unknown types, and partial key collisions rename input fields without reliably rebinding the partial's references.

Deliver one field meaning across discovery, editing, storage, preview and generation. Preserve legacy templates, advanced blocks and service definitions. Plain fields become atomic labeled decorations in the editor, while canonical storage stays compatible with expressions and explicitly versioned definition metadata.

## Owned scope and contracts

Own `template-editor/*` components/helpers, `src/types/placeholders.ts`, `template-placeholder-storage.ts`, `template-analysis.ts`, `placeholder-resolver.ts`, `document-generation-master-fields.ts`, and proposed shared parser/registry/content-policy modules. Do not edit `src/app/(dashboard)/template-partials/editor/page.tsx`, batch forms/workspace or server/API validation files; W owns them.

Export C05 field descriptors, parser/diagnostics, scoped bindings, typed-value adapters and atomic lifecycle operations; export C06 content-policy definitions. Consume C01 complete snapshot/history and C02 structural source positions. CORE owns chip decoration integration/selection; W owns render-test/service inputs, Zod/schema adapters, batch form rendering and persistence.

Read the current `PlaceholderPanel`, `validateTemplateSyntax`, catalog/builders/insertion helpers, both definition adapters, partial merge/extraction logic, `resolvePlaceholders/formatResolvedValue/processPartials`, master-field precedence and existing resolver/storage tests before editing.

## F0 — Grammar, legacy and trust-boundary inventory

Entry: this plan. Work can run beside the editor's boundary investigations.

- [ ] Build a fixture catalog of supported simple fields, spaced syntax, modifiers, loops/conditions, partials, attribute expressions and service blocks. Record which current parser/validator/resolver accepts each and whether it preserves meaning.
- [ ] Include malformed split fields, dangling braces, unknown keys/roots, nested/missing/circular partials and duplicate keys. Keep literal text and malformed syntax distinguishable; never silently rewrite a malformed key to a guessed field.
- [ ] Round-trip every stored type (`text`, `textarea`, `date`, `number`, `currency`, `boolean`, legacy `list`/`conditional`) and metadata key through editor **and API schema**, not just the local adapter. Ask W to test Zod stripping of stable IDs/options/unknown keys.
- [ ] Inventory ordinary text versus intentional rich-valued fields/partials. Use synthetic or approved redacted examples; do not dump production content into fixtures. Record legacy cases that need a specific compatibility binding before escaping changes.
- [ ] Demonstrate parent/partial note collisions and nested partial discovery through the actual canonical render path with W, not only a renamed input list.
- [ ] Publish C05 parser/type/lifecycle interfaces and C06 allowed document semantics. S supplies break/continuation details; F must not define a second break format.

**F0 output:** matrix of syntax/definitions/values and expected semantics, failing adapter/renderer fixtures, scope/binding design, policy definition and exact integration requests for CORE/W. No protected-field or escaping writer enabled yet.

## F1 — One parser, registry and lossless definition adapter

Entry: G0. Implement independent modules against C01/C02 types; direct route integration waits for W.

### Parser approach

1. Establish one parsing front end for supported template syntax, with source spans and explicit reference/block/partial nodes. HTML-aware token recognition must distinguish markup around a complete expression from formatting inserted inside the expression.
2. Reuse existing extraction/diagnostic logic where it represents the canonical grammar. Avoid replacing the resolver wholesale; migrate its regex entry points to consume shared parse/binding results incrementally with equivalence tests.
3. Define simple-expression whitespace normalization, modifier syntax and scope rules once. Treat malformed expressions as diagnostics with original source retained. Unknown fields should have a stable code and human label/key fallback, not a raw exception.
4. Export source locations that CORE can map to structural ranges. Include scope and occurrence identity; one flow ID for an entire page is not enough to navigate a field error.
5. Ensure system/service fields offered by the catalog are accepted in their supported context, and fields requiring company/contact/service context are labeled accordingly rather than globally available with mysterious failures.

### Definition and value contract

- [ ] Consolidate adapters around C05's lossless stored definition. Retain original unknown properties and source/path/category/linking/default/format semantics. Missing required defaults must have one documented legacy interpretation; do not silently flip existing definitions on open/save.
- [ ] Assign deterministic scoped identities to legacy fields; preserve stable persisted IDs where present. Keep label changes independent from immutable/default keys.
- [ ] Reject duplicate normalized keys within a scope, but allow different scopes to declare note. Use source labels for duplicate display names.
- [ ] Keep unsupported legacy types intact. Disable unsupported editing controls or require an intentional conversion with clear effects; do not write type text merely because a select control lacks list.
- [ ] Export typed input descriptors and validation: date, multiline text, numeric/currency exact strings and boolean. Define missing/empty/false/zero, default precedence and parse-error representation.
- [ ] Preserve current master precedence: item value, accepted prefixed legacy value, document override, shared master, default. Name explicit conversion boundaries to/from legacy string payloads.
- [ ] Define shared content policy data with S's break attributes and editor/output supported structures. CORE/W supply their DOMPurify environment adapters; F does not copy editor DOM logic into a server resolver.

**Acceptance:** no-change field save preserves all fixture semantics; parser/validator/resolver agree on supported syntax; missing/invalid fields produce stable diagnosable references; all known six typed inputs and preserved legacy types have tests. Shared policy does not strip quotes/captions/footers/start attributes or new explicit breaks.

## F2 — Scoped resolution, escaping and atomic field changes

Entry: F1; W integrates canonical service/render-test usage. No new resolver/preview service may bypass tenant-scoped canonical template/partial loading.

### Scope and binding

1. Resolve each reference in its owning template/partial scope. Expanding a partial carries that scope into its references; nested partials resolve recursively with cycle/missing-dependency checks.
2. Bind effective values by structured scoped identity. Do not solve collisions by renaming only the input key to `partialName_key`. Legacy flattened payloads require an explicit adapter with deterministic ambiguity errors.
3. Preserve intentional partial linkings as declared bindings. Repeated partial use normally shares its declared field values; do not manufacture per-occurrence values unless the existing template contract requires them.
4. Keep company/contact/selected-party/service context loading in DG/batch services. F resolves within the context supplied by W and never performs unscoped database fetches from a parser helper.

### Text versus rich output

- [ ] Escape all ordinary text values at the interpolation boundary, including modifier results. Test `A & B <em>literal</em>` as literal text across preview and PDF.
- [ ] Mark rich fragments by trusted origin/API type, then sanitize through C06. A caller-controlled string flag must not grant trusted-HTML status.
- [ ] Apply typed formatting deliberately: ISO-looking text stays text; an actual date uses the agreed date format; false does not become truthy because its string label is No.
- [ ] Preserve multiline values once; optional empty values do not delete neighboring author text. Required values use type-aware validation.
- [ ] Leave escaping activation behind the D2 compatibility gate until the rich-field inventory is covered. New templates may use explicit text semantics earlier only if all rendering paths share the contract.

### Lifecycle transaction API

Produce operations for create, relabel, intentional key migration, change type/default/required and delete. Each receives a complete document snapshot and returns updated content, definitions, dependent metadata and usage/diagnostic changes in one result.

Label rename preserves identity/key/path. Key migration rewrites all parsed references, stored path, title-date key and partial linkings or rejects an unsupported dependency with content unchanged. Delete-unused needs no confirmation. Delete-used returns a usage preview; after the selected action, one transaction either removes references or retains clearly unresolved references. Undo must restore both the definition and content; do not call independent parent setters that bypass session history.

**Acceptance:** parent and two partials can each resolve distinct note values; intentional shared linkings still share. All malformed/split field cases yield useful diagnostics. Plain values cannot create document HTML. Key migration leaves no old path; deleting then Undo restores every reference/definition. W's render/save tests close the service-side gate.

## F3 — Field authoring and discovery UX

Entry: C2 + F2. CORE provides atomic decoration hooks; W provides snapshot/lifecycle callbacks and applies route/batch form changes.

- [ ] Display ordinary references as recognizable inline fields with human labels. Clicking/selecting shows source, type, description and value/default information; put technical key in advanced details.
- [ ] Make whole-token formatting/deletion/copy/paste predictable. Do not store label markup; do not let pasted chip attributes spoof field identity. Keep advanced loop/partial builders in a separate accessible section, with valid serialization.
- [ ] Fix key generation: derive complete key at commit or until the user explicitly edits it. Creating a field may also insert it at the remembered caret; distinguish “Create” from “Create and insert” clearly.
- [ ] Feed W typed controls for defaults and batch inputs. Date uses date UI, multiline uses textarea, boolean uses Yes/No, numeric/currency inputs provide typed validation without silently changing precision.
- [ ] Add contextual registry grouping/search by business label and description. System/service fields only appear as applicable or explicitly unavailable with explanation; do not invent a new resolution source.
- [ ] Fix recents to use the shared identity catalog, including custom fields; deleted entries disappear. Modifier actions begin by choosing a valid field, not inserting an unresolved generic `{{field}}`.
- [ ] Show usage count and locations for referenced-field deletion. Wire diagnostic navigation to parser occurrence positions; CORE owns actual focus/selection restoration.
- [ ] Test keyboard operation, labels, focus return, long field labels and narrow panel widths. Use existing Oakcloud components/design tokens.

**Acceptance:** staff can find company/contact/custom fields and create/insert one without syntax knowledge; key creation works with ordinary sequential typing; fields cannot be partially corrupted; type/default/required meaning matches generation; errors have a clear location and repair. Test field+bold, heading, list, table, adjacent fields and page boundaries.

## Tests, compatibility and handoff

Extend existing `__tests__/components/template-editor/*`, `__tests__/lib/{template-placeholder-storage,placeholder-resolver,document-generation-master-fields}.test.ts` and service tests through W. Add fixtures for real clipboard grammar once Q captures authorized synthetic payloads. Do not claim Word/Docs/email coverage from invented HTML alone.

The migration is read-compatible first. Do not bulk rewrite template or generated content. Stable IDs and unknown metadata must survive W's API validation; existing partials lack contentJson, so field/format compatibility cannot depend solely on that column. Service/system definitions remain authoritative even when their controls are read-only in this panel.

Return parser/registry/lifecycle signatures, schema additions W must preserve, exact field-input descriptors, legacy mappings that remain unresolved, test commands/results, and the D2 activation checklist. F does not close A4E-014/017 from local resolver tests alone; require canonical generation and actual output evidence from W/Q.

## Dispatch prompt

> Implement packet **F0** using this plan and contracts v1. Inventory and fixture the actual supported grammar, field types, metadata and trusted-rich-output uses. Prove adapter loss/collision cases and define one scoped identity/parser contract for CORE/W. Stay within F-owned files; do not change template route pages, batch forms or server validation directly. Return the compatibility and API handoff for G0 before implementing F1 or enabling new field behavior.

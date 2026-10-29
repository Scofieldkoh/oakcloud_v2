# FIELDS handoff log

## FIELDS-F0-20260911-01 — READY FOR INTEGRATION

**Role:** FIELDS  
**Packet:** F0 — grammar, legacy and trust-boundary inventory  
**Assigned baseline:** `63aa75b6170766a3e3d1728feb5e5417f5632f20`  
**Branch base used for PR:** `80056fb7ab6e410ef2d2ddc17a830b068d263671` (CORE C0 already merged; its changed files were checked and do not overlap FIELDS production/test ownership)  
**Contract consumed:** proposed contracts v1; G0 remains open.  
**Initial implementation commit:** `7da9853d19b5861906fd79d0eb054b16328bd03c`  
**G0 correction implementation commit:** `051c97e9a8da2df8f5ad6ae255f645d6a85fce92`

FIELDS has completed only the released F0 assignment plus CORE's requested G0 corrections on the same PR. No F1/F2/F3 behavior, new production parser wiring, escaping policy, protected-token writer, route/API behavior, persistence change, migration, version bump or deployment capability has been enabled.

### G0 review correction — 2026-09-11

CORE requested five bounded corrections while keeping F0 ownership and behavior-neutrality. The same PR now contains the following additional proof:

1. **Executable lossless definition load/serialize fixtures.** `loadLosslessStoredFieldDefinition` and `serializeLosslessStoredFieldDefinition` round-trip all eight stored types (`text`, `textarea`, `date`, `number`, `currency`, `boolean`, legacy `list`, legacy `conditional`) without rewriting the source object. Fixtures cover stable `id`, `options`, `format`, `source`, `category`, `path`, `linkedTo`, `sourcePartial`, `defaultValue`, explicit/omitted `required`, and arbitrary forward-compatible `futureMetadata`. Supported editor types receive a typed view; legacy types remain `supportedType: null` and `legacy-preserve-only` without changing their stored type.
2. **Completed F0 grammar fixture catalog.** Executable proof now covers current `data-template-each="service.entities"` attribute grammar, `service.familyName`, `service.fields.*`, `{{#each service.entities}}`, loop `this.*`, unknown roots, unknown keys, duplicate scoped keys, and nested/missing/circular partial dependency diagnostics. These are isolated F0 contract probes only; the production resolver/parser remains untouched.
3. **Unambiguous C06 trust capability.** Stored/loaded `renderMode` is now typed only as `text | legacy-preserve-only`; it has no `trusted-rich` variant. Client/pasted/token metadata is accepted only by a declarative text-fragment constructor that always produces `{ kind: 'text' }`. Runtime trusted-rich fragments require one of the canonical in-process singleton capabilities in `C06_TRUSTED_RICH_ORIGINS`; a JSON-shaped spoof such as `{ name: 'canonical-builder' }` is rejected by the runtime factory. A raw legacy/forward metadata key named `renderMode` is preserved losslessly but remains inert.
4. **WORKFLOW schema contract is explicit below.** No W-owned Zod/API/route file was edited.
5. **Node 24 execution evidence is recorded below.** The exact requested Vitest command was invoked under Node 24.11.1, but this local execution environment cannot resolve the npm registry and had no preinstalled Oakcloud dependencies, so Vitest bootstrap failed with `EAI_AGAIN` before test collection. This is explicitly **not** counted as a test pass. Independent Node-24 contract smoke and repository CI/typecheck evidence are also recorded.

### Exact WORKFLOW API/Zod preservation contract

WORKFLOW must preserve the following top-level definition fields across document-template and partial request validation, persistence and response serialization. Presence is significant where noted; the preservation boundary must not silently coerce, default, drop or rename these keys:

| Field | Required preservation semantics |
| --- | --- |
| `id` | Stable persisted field identifier when present. Legacy definitions may omit it; a present ID must round-trip unchanged. |
| `key` | Stored key exactly as supplied by the compatible definition contract. |
| `label` | Business/display label. Label changes must not redefine identity. |
| `type` | Preserve all existing stored types: `text`, `textarea`, `date`, `number`, `currency`, `boolean`, `list`, `conditional`. Unknown future types must not be rewritten to `text` by a no-change pass. |
| `source` | Preserve source namespace. |
| `category` | Preserve grouping/category metadata when present. |
| `path` | Preserve stored resolver path when present; do not regenerate it merely from the UI key during a no-change pass. |
| `required` | Preserve both value **and presence**. Explicit `false`, explicit `true`, and omitted are distinct compatibility states. A validation-time `.default(false)` must not erase the omitted state in the lossless preservation path. |
| `defaultValue` | Preserve the stored value exactly; type-aware interpretation belongs behind the typed adapter, not the API preservation boundary. |
| `format` | Preserve exact stored format metadata. |
| `options` | Preserve exact JSON-compatible option metadata, including existing/future option shapes. |
| `linkedTo` | Preserve declared conditional linking when present. |
| `sourcePartial` | Preserve declared source-partial metadata when present. |
| unknown top-level metadata | Preserve arbitrary JSON-compatible forward-compatible keys verbatim (for example `futureMetadata`). Validation may validate safety/JSON shape but must use a passthrough/explicit extension strategy rather than stripping unlisted keys. |

The current W-owned `placeholderDefinitionSchema` already enumerates the eight known `type` values and the fields `key`, `label`, `source`, `category`, `path`, `defaultValue`, `format`, `required`, `linkedTo`, and `sourcePartial`, but it currently has **no `id` field, no `options` field, defaults omitted `required` to `false`, and uses a normal `z.object` that strips unlisted metadata**. WORKFLOW must close those exact preservation gaps before stable IDs/options/forward metadata can be enabled in production. FIELDS did not modify that schema.

### Targeted F0 test evidence

Requested command:

```text
npx vitest run \
  __tests__/lib/template-field-contract.test.ts \
  __tests__/lib/template-field-f0-compatibility.test.ts \
  __tests__/lib/a4-content-policy.test.ts
```

Local runtime selected explicitly: `Node v24.11.1`, npm `10.9.2`.

Exact command result in this execution environment: **BLOCKED BEFORE VITEST STARTED / NOT A TEST PASS**. `npx` attempted to resolve the repository's missing local Vitest dependency and failed because outbound npm DNS is unavailable:

```text
npm error code EAI_AGAIN
npm error syscall getaddrinfo
npm error errno EAI_AGAIN
npm error request to https://registry.npmjs.org/vitest failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org
```

A separate Node 24.11.1 F0 contract smoke over the corrected C05/C06 proof modules passed (`F0 contract smoke OK`), covering lossless legacy round-trip, attribute grammar, unknown-root/circular-partial diagnostics, canonical trusted-rich minting and client-origin spoof rejection. This smoke is supplemental and is not represented as the requested Vitest run.

GitHub Actions run `34570950243` on correction commit `051c97e9a8da2df8f5ad6ae255f645d6a85fce92` uses Node 24 and successfully completed dependency installation, runtime-major verification, lint and repository typecheck at the time of this handoff update. The existing workflow does not contain the three-file targeted F0 Vitest command, so those unrelated CI tests are not substituted for it. CORE/G0 should require the exact targeted command to be rerun in a dependency-capable Node 24 checkout before treating that specific execution-evidence sub-gate as satisfied.

### Files changed by F0

- `src/lib/template-field-contract.ts` — executable C05 contract proof: stable scoped identity, lossless no-change load/serialize adapter, typed value distinctions, input descriptor, parser/diagnostic/lifecycle interfaces, attribute/service grammar probes, registry diagnostics and partial-dependency diagnostics.
- `src/lib/a4-content-policy.ts` — C06 policy definition only: canonical semantics, editor-only decoration attributes, structural attributes, legacy preserve-only content, ordinary-text boundary and canonical trusted-rich origin capabilities. It is intentionally not connected to DOMPurify or production resolution in F0.
- `__tests__/lib/template-field-contract.test.ts` — executable contract fixtures for supported/malformed/service/attribute grammar, unknown/duplicate/dependency diagnostics, all eight stored types, metadata preservation, stable identity, required presence and typed-value distinctions.
- `__tests__/lib/template-field-f0-compatibility.test.ts` — deliberate `it.fails` baseline proofs for current production compatibility defects; these freeze the gaps without activating later behavior.
- `__tests__/lib/a4-content-policy.test.ts` — policy/trust-capability coverage, including client/token spoof rejection.
- This handoff file.

No other owner's production, route, service, API validation, Prisma, package/configuration or generated-output file was modified.

### F0 grammar inventory and proposed normalization

| Fixture | Current behavior observed from source/baseline | C05 F0 contract |
| --- | --- | --- |
| `{{custom.note}}` | validator/resolver recognize | supported simple reference |
| `{{ custom.note }}` | editor validation trims/accepts; resolver leaves literal | normalize whitespace to `{{custom.note}}` through one parser |
| `{{PCASE(company.name)}}` | resolver supports | supported modifier |
| `PCASE({{company.name}})` | resolver supports, including editor-added inline wrappers | supported external modifier; parser owns expression meaning before rendering |
| `{{DESIGNATION({{selectedDirector.role}})}}` | resolver has special normalization | supported legacy nested modifier syntax |
| `{{#each directors}}…{{/each}}` | resolver supports | supported block |
| `{{#if path …}}`, `{{#unless path}}`, `{{#with path}}` | resolver supports more than editor validator | supported blocks; one grammar must cover all four |
| `{{> partial-name}}` / encoded `>` form | resolver/analysis support | supported partial; hyphenated names retained |
| `{{@index}}`, `{{@number}}`, `{{@first}}`, `{{@last}}` | resolver supports in loops | supported loop variables |
| `data-template-each="service.entities"` | resolver expands valid `tbody`/`div` attribute builders into an each block | explicit `attribute-each` proof using current path grammar |
| `{{service.familyName}}`, `{{service.fields.engagementCode}}`, `{{#each service.entities}}`, `{{this.name}}` | current resolver context exposes service scalar/field/entity data and loop item context | executable service-context grammar fixtures |
| unknown root such as `mystery.note` | grammar can recognize a syntactic path while context is invalid | `unknown-root` diagnostic |
| unknown scoped/custom or catalog key | grammar and availability were previously conflated | `unknown-field` diagnostic after scoped registry/known-path binding |
| duplicate key in same scope | legacy merge behavior can flatten/collide | `duplicate-key-in-scope`; same key remains legal in another owner scope |
| nested partial dependencies | resolver/analysis recurse but definition discovery is incomplete | dependency proof accepts valid nested graph without flattening scope |
| missing partial | resolver/analysis report in different forms | `missing-partial` diagnostic |
| circular partial | resolver logs/rewrites and analysis tracks cycles | `circular-partial` diagnostic |
| `{{custom.<b>note</b>}}` | validator silently skips; resolver leaves literal | `formatted-expression` diagnostic; original source retained |
| dangling braces | analysis only counts some mismatch forms | explicit `dangling-expression` diagnostic |

The isolated grammar/diagnostic helpers are F0 proof code only. F1 must implement the full HTML-aware parser with source spans and registry binding after CORE freezes G0; production regex entry points remain untouched in this packet.

### Definition/type/API compatibility inventory

1. `src/lib/template-placeholder-storage.ts` currently converts unsupported stored types to editor `text`. Therefore stored `list` and `conditional` definitions can be rewritten as `text` on a no-change editor round-trip even though the document-template API schema accepts those legacy types.
2. The same storage adapter generates a fresh `crypto.randomUUID()` every time definitions are loaded. Runtime identity therefore is not stable across reopen/reload.
3. Missing `required` defaults disagree: the storage/editor adapter uses `true`; the template-analysis adapter uses `false`.
4. `template-analysis.ts` has a second definition adapter and does not preserve the same complete unknown metadata contract as `template-placeholder-storage.ts`.
5. The document-template Zod `placeholderDefinitionSchema` enumerates `list`/`conditional`, but has no stable `id` or `options` field, defaults `required`, and uses a normal `z.object`, so unlisted forward-compatible definition keys are stripped at that API boundary. FIELDS did not edit this W/integration-owned validation file.
6. C05 F0 now includes an executable lossless no-change adapter carrying `storedType`, nullable `supportedType`, owner scope, resolver path plus exact stored path, explicit-vs-omitted required state, persisted ID, format/options, linking metadata, safe declarative render mode, unknown metadata and the complete original object. Unsupported types remain preserve-only until intentional conversion.
7. Typed values distinguish missing, empty, boolean `false`, exact numeric/currency strings, ISO date values and legacy structured values. Appearance does not coerce text: an ISO-looking text string remains text; string `"false"` is not automatically boolean `false`.

### Scoped identity and partial collision proof

Current `mergeTemplateAndPartialPlaceholders` resolves a parent/partial collision by exposing the partial field as `${partialName}_${baseKey}` while the partial content still references `{{custom.<baseKey>}}`. This changes the input key without rebinding the reference and can select the wrong value. It also walks definitions of directly referenced partials only, so nested-partial field discovery is incomplete.

F0 proposes structured identity as `(owner kind, owner stable ID, persisted field ID when available else scoped stored key)`. Display names and underscore concatenation never define identity. A parent and two partials may therefore each declare `custom.note` and remain distinct; repeated use of the same partial shares that partial's declared identity unless an explicit existing linking says otherwise. Resolver/value binding for this design belongs to F2 + W integration, not F0.

### Text versus trusted-rich inventory / C06

Source inspection confirms ordinary values flow through `formatResolvedValue` as raw strings; only letter-address paths currently escape HTML and deliberately convert newlines to `<br>`. Thus benign `A & B <em>literal</em>` can become document markup for an ordinary text field. Partial expansion, canonical builders and service-composition structures are intentional rich producers and cannot be fixed by escaping the entire template.

The F0 C06 policy data therefore separates:

- ordinary/declarative field text: cannot become trusted HTML from stored `renderMode`, client input, pasted metadata or token attributes;
- trusted rich: only canonical partial/builder/service-composition code holding one of C06's canonical origin capabilities may construct the runtime fragment;
- legacy rich: only an inventoried explicit compatibility binding may retain rich meaning;
- unknown legacy rich: preserve the source and block destructive conversion rather than silently changing it.

No escaping behavior changes in F0. Activation remains behind the D2/G3 compatibility gate.

### Sanitizer compatibility inventory

The baseline editor sanitizer preserves `blockquote`, `caption`, `tfoot`, `scope` and `ol[start]` but does not allow legacy `img`, `sup`, `sub` or section `id`. The export sanitizer does the reverse for several of these: it allows `img`/`sup`/`sub`/`id` while dropping `blockquote`/`caption`/`tfoot`/`scope`/`start`. C06 records one proposed semantic set for G0 review, while keeping runtime `data-flow-*` attributes explicitly non-canonical.

`data-a4-break` is included only as the SEMANTICS-owned C03 structural attribute. FIELDS does not define a second break format.

### Field UI contracts exported for later consumers

`FieldInputDescriptor` provides W with stable identity/scope, business label, description/source, stored type, control kind, required/default semantics and an explicit disabled reason for preserve-only legacy types. This supports date, multiline, boolean and exact numeric/currency forms without forcing FIELDS to edit W-owned batch/route components.

Parser nodes carry source spans and occurrence identity so CORE can later decorate a complete field atomically and navigate diagnostics. Token markup remains view-only and cannot become trusted identity or rich-content authority when pasted. `FieldLifecycleSnapshot` / `FieldLifecycleIntent` / `FieldLifecycleResult` define the atomic create/relabel/key-migrate/change/delete boundary for later F2; CORE history and W persistence must consume the complete snapshot rather than independent setters.

### Exact integration requests

**CORE / G0**

- Freeze how parser source spans/occurrences map to C02 structural positions and C01 complete snapshot/history.
- When protected-token integration is later dispatched, decoration must serialize the original expression exactly; pasted token attributes are not identity/trust authority.
- Field definition/layout/content lifecycle must be one history transaction once F2 is integrated.
- Treat the local `EAI_AGAIN` result above as a blocked execution environment, not a passing targeted test. Re-run the exact three-file Vitest command under a dependency-capable Node 24 checkout before closing that specific G0 evidence item.

**WORKFLOW / G0 and later F1 integration**

- Preserve the exact schema table above: stable `id`, all eight stored `type` values, `key`, `label`, `source`, `category`, `path`, `required` presence/value, `defaultValue`, `format`, `options`, `linkedTo`, `sourcePartial`, and arbitrary JSON-compatible unknown top-level metadata.
- Add service/API regression coverage proving those fields survive document-template and partial validation/persistence. Do not enable persisted IDs until this boundary is explicitly lossless/validated.
- Demonstrate parent + two partials with colliding `custom.note` values and a nested partial through the canonical tenant-scoped render path; FIELDS local fixtures alone do not close A4E-017.
- Inventory any intentional HTML-valued custom/service fields before enabling escaped ordinary-text semantics. Unknown cases remain a compatibility blocker.
- Consume `FieldInputDescriptor` instead of inventing route-specific type coercion. Keep current effective-value precedence while replacing flattened collision aliases with explicit scoped bindings after contract freeze.

**SEMANTICS**

- Confirm C03's final structural break attribute/shape for the shared C06 policy. FIELDS will consume it and will not create a competing break codec.

### A4E coverage from F0

- **A4E-013:** grammar divergence, formatted/split expression gaps, attribute/service constructs and unknown/dependency diagnostics are frozen as executable contract fixtures; production parser remains unchanged.
- **A4E-014:** raw ordinary-text interpolation inventoried; text/trusted-rich authority boundary is now explicit but escaping is not activated.
- **A4E-015:** unstable identity/path/lifecycle boundaries inventoried; stable scoped identity and atomic lifecycle interface proposed only.
- **A4E-016:** typed input/value descriptor contract defined; no UI behavior changed in F0.
- **A4E-017:** legacy type/default disagreement, partial collision aliasing and nested discovery gaps frozen as compatibility failures; all eight stored definition types now have lossless contract round-trip fixtures.
- **A4E-018:** editor/export schema mismatch inventoried; C06 policy definition/trust capability proposed only.
- **A4E-023/027/030:** parser occurrence/UI descriptors establish later integration contracts; no paste/preview/catalog behavior advanced beyond F0.

### Compatibility / rollout implications

This packet remains intentionally read/behavior neutral: it adds proof contracts and fixtures only. It performs no migration, bulk rewrite, API enforcement, production field serialization, sanitization change, generation change or deployment. Existing generated documents remain snapshots. D2/G3 field behavior stays disabled until later explicitly dispatched packets plus W/CORE integration evidence pass.

### Known risks and remaining dependencies

- The C05/C06 names and exact signatures remain proposed until CORE's G0 decision.
- The W-owned API-schema lossiness around stable IDs/options/required omission/unknown keys blocks persistence of new definition metadata.
- Rich-valued legacy fields must be inventoried before ordinary-text escaping can be activated.
- Scoped resolution cannot be declared complete until canonical generation proves parent/nested-partial collision behavior.
- Final content policy must consume SEMANTICS' frozen C03 break contract and W/CORE environment adapters.
- The exact requested three-file Vitest run is still missing a successful execution result because this local environment cannot reach npm; do not misread the Node-24 smoke or unrelated GitHub CI tests as that pass.

**FIELDS state:** `READY FOR INTEGRATION — F0 only`. Do not dispatch or begin F1 from this handoff alone. Wait for CORE to freeze/publish G0 and a new FIELDS assignment in `coordination/dispatch.md`.

---

## FIELDS-F1-20260911-01 — READY FOR INTEGRATION

**Role:** FIELDS  
**Packet:** F1 — one parser, registry and lossless definition adapter  
**Stage-1 common baseline:** `bfdc4f95594b73ce4d20bff45f320bdb53837c37`  
**Implementation head before this coordination-only handoff commit:** `513f3b960a83a16c21a1af666e98b29860d97043`  
**Branch:** `codex/a4-editor-fields-f1`  
**PR:** `#38` — `A4Editor: implement F1 unified field parser and lossless registry`  
**Frozen contracts consumed:** C05/C06 G0 decisions; no F2/F3 work has started.

### F1 parser / registry / type APIs

The F1 canonical field front end is `src/lib/template-field-parser.ts`:

- `parseTemplateFields(input)` is the HTML-aware source-preserving parser. Each supported occurrence produces a `FieldGrammarNode` with `kind`, exact `span`, normalized semantic `expression`, owner `scope`, and deterministic `occurrenceId`; applicable nodes also carry `path`, `modifier`, `partialName` and/or `block`.
- `normalizeTemplateFieldSyntax(content, parsed?)` rewrites only expressions the parser already accepted. Malformed expressions remain byte-for-byte recoverable and no replacement key is guessed.
- `extractTemplateFieldPaths(parsed)` and `extractTemplatePartialNames(parsed)` are the shared discovery helpers.
- `ParseTemplateFieldsInput` accepts a scoped registry, an optional explicit known-path set, partial sources and explicit legacy-binding candidates. Nested partial syntax is parsed in each partial's own owner scope; a parent registry is not reused as child authority.

The production definition/value boundary is `src/lib/template-field-registry.ts`:

- `loadStoredFieldRegistry({ scope, definitions })` consumes the frozen lossless definition loader while containing ordinary malformed stored definitions as stable diagnostics plus preserved source rather than leaking implementation exceptions to UI consumers.
- `serializeStoredFieldDefinition(definition)` is the no-change exact serializer contract.
- `createFieldInputDescriptor(definition)` exports the later WORKFLOW form descriptor.
- `validateTypedFieldValue(value)` validates exact typed values without number/date/boolean appearance coercion.
- `typedFieldValueToLegacyPayloadValue(value)` is the explicit typed-to-legacy conversion boundary.
- `resolveTypedFieldValueByPrecedence(input)` implements the frozen precedence without conflating missing, empty, false or zero.
- `FIELD_VALUE_PRECEDENCE_V1` is exactly `item-value -> accepted-prefixed-legacy-value -> document-override -> shared-master -> default`.

`src/lib/template-field-runtime.ts` publishes `resolveTemplateFields(...)`, the F1 parser-backed render/generation adapter. It parses and normalizes supported syntax, then delegates to the established `resolvePlaceholders` implementation. It intentionally does not introduce F2 ordinary-value escaping, new scoped runtime binding or appearance-based coercion.

### Supported parser grammar

F1 recognizes through the shared front end:

- simple and frozen-normalized spaced references;
- internal/external modifiers, including editor HTML around the referenced expression;
- `each`, `if`, `unless`, and `with` blocks;
- `else` and loop variables;
- partial references including supported encoded `>` forms;
- `data-template-each` attribute constructs;
- service roots including service scalars, `service.fields.*`, service collection blocks and loop item context.

Formatting around a complete expression remains markup; HTML inserted inside/breaking the expression yields a recoverable formatted-expression diagnostic.

### Stable F1 diagnostic codes

The shared diagnostic surface uses the frozen codes where applicable:

- `dangling-expression`
- `formatted-expression`
- `invalid-expression`
- `unknown-root`
- `unknown-field`
- `duplicate-key-in-scope`
- `missing-partial`
- `circular-partial`
- `ambiguous-legacy-binding`
- `mismatched-block`
- `unclosed-block`

Every parser diagnostic includes exact source span and owner scope. Template-editor validation keeps its legacy panel-level issue codes for compatibility and exposes the stable F1 code as `diagnosticCode` for CORE navigation.

### Lossless serializer contract

`storagePlaceholdersToEditorResult`, `storagePlaceholdersToEditor` and `editorPlaceholdersToStorage` now share the F registry boundary instead of maintaining a second reinterpretive definition model. A no-change round trip preserves:

- persisted `id` when present;
- exact stored key and label semantics;
- exact stored `type`, including preserve-only legacy `list` / `conditional` and unknown future types;
- exact `source`, including forward-compatible unknown source strings;
- category and path;
- explicit-vs-omitted `required` state;
- default value, format and options through the original stored definition;
- `linkedTo` and `sourcePartial`;
- arbitrary JSON-compatible forward metadata.

The authoring view may expose an unsupported type with a read-only/preserve-only descriptor, but a no-change save does not reinterpret that stored type. Invalid stored definitions returned by `storagePlaceholdersToEditorResult` are preserved separately with diagnostics rather than throwing into authoring UI.

### Scoped identity

The registry identity is deterministic from owner kind + stable owner ID + persisted field ID when present, otherwise the scoped normalized stored key. Display labels, partial display names and underscore concatenation are not identity inputs.

`mergeTemplateAndPartialPlaceholders` now recursively discovers nested partial definitions and keeps colliding logical keys unchanged across owner scopes. The historical `${partialName}_${key}` form is accepted only as a compatibility linking lookup and is never minted as the new field identity/key.

Callers loading a concrete template or partial must pass its stable owner ID through the adapter `scope`. The deterministic `legacy-template-editor` fallback exists only so older unscoped callers do not regain random IDs; CORE/WORKFLOW integration must replace that fallback at concrete top-level editor/load boundaries.

### Typed value / input descriptor contract

The frozen discriminated value model remains authoritative for:

- text;
- multiline text;
- date;
- exact number string;
- exact currency string;
- boolean;
- missing;
- empty;
- legacy structured value.

`FieldInputDescriptor` exposes identity, scope, key, label, stored type, control, required/default semantics and preserve-only disabled reason. ISO-looking text remains text when the stored type is text. Exact decimal strings are not converted through floating-point values at this boundary. Missing, `''`, `false`, `'0'`/zero-like exact strings and default absence remain distinguishable.

### C06 production policy exports

`src/lib/a4-content-policy.ts` now publishes shared production policy data/helpers while leaving F2 escaping disabled:

- `A4_CANONICAL_TAGS` retains semantic authored structures including `blockquote`, `caption`, `tfoot`, lists/tables, `sup` and `sub`;
- `A4_CANONICAL_ATTRIBUTES` includes list `start`, safe table attributes and the frozen structural attributes;
- `A4_SEMANTIC_PAGE_BREAK_HTML` is exactly `<span data-a4-break="page"></span>` and consumes the C03 semantic break rather than introducing a second codec;
- `isA4ProjectionOnlyAttribute` treats listed and future `data-flow-*` metadata as projection-only/non-canonical;
- `A4_ALWAYS_REJECTED_TAGS` and `getA4SanitizerPolicy()` expose the shared executable/form exclusion policy to environment adapters;
- `createDeclarativeFieldContentFragment(...)` cannot mint trusted-rich authority from stored `renderMode`, client metadata or pasted/token metadata;
- `createTrustedRichContentFragment(...)` still requires a canonical singleton in `C06_TRUSTED_RICH_ORIGINS`, so JSON-shaped spoof attempts fail.

### Exact integration requests

**CORE**

1. Consume `parseTemplateFields` once per canonical source snapshot for token decoration/navigation; decorate by `node.occurrenceId`, `node.scope` and exact `node.span`, and keep `node.span.raw` as the recovery/navigation source. Do not reconstruct identity from labels or editor token attributes.
2. Map `TemplateValidationIssue.diagnosticCode` plus the parser node `scope/span` into the CORE diagnostic navigator. Ordinary malformed authoring input is a diagnostic state, not an exception path.
3. At concrete template/partial load boundaries, pass the stable database owner ID to `storagePlaceholdersToEditor(..., { scope: { kind, id } })`; do not rely on the compatibility fallback scope.

**WORKFLOW — API/Zod preservation**

1. Update W-owned request/response schemas to preserve `id`, all stored types, `options`, explicit-vs-omitted `required`, and arbitrary JSON-compatible forward metadata. Use a passthrough/explicit-extension strategy; do not reconstruct definitions from an allow-listed subset.
2. Feed persisted definitions through the F lossless registry/serializer contract. Preserve exact strings for number/currency form payloads and the discriminated missing/empty/boolean states; do not add visual/appearance coercion.
3. Keep stable owner IDs with every definition set so scoped identities survive reload and relabel.

**WORKFLOW — render/generation**

1. Replace direct new integrations with `resolveTemplateFields` rather than adding another regex parser in W-owned render/generation paths. Existing raw `resolvePlaceholders` remains the compatibility implementation underneath F1.
2. When applying document values, use `resolveTypedFieldValueByPrecedence`; provide `acceptedPrefixedLegacyKey` only for an explicitly supported legacy binding. Do not infer aliases from labels/partial display names.
3. Do not enable ordinary-field escaping or scoped runtime rebinding from this PR. Those remain F2 plus W integration work.

**SEMANTICS**

1. When a field occurrence must be treated atomically for structural positioning, consume the F parser's exact `span`, `occurrenceId` and owner `scope`; do not scan/re-tokenize the source with a separate field regex.
2. Consume `A4_SEMANTIC_PAGE_BREAK_HTML` / `data-a4-break` as the shared C03 boundary and keep `data-flow-*` strictly projection-only.

### Incremental adoption completed in F1

- `template-analysis.ts` field/partial extraction, syntax checks and dependency graph diagnostics now consume the shared parser.
- `template-placeholder-storage.ts` and template-analysis field conversion share the lossless adapter instead of divergent definition rewriters.
- template-editor syntax validation consumes parser nodes/diagnostics while preserving existing UI issue codes.
- `resolveTemplateFields` provides the parser-backed generation adapter and reuses the existing resolver instead of rewriting it.
- Existing legacy partial replacement regex remains only inside the established resolver compatibility implementation; F1 does not pretend the later runtime rewrite is complete.

### F1 tests and execution evidence

Added/promoted test coverage:

- `__tests__/lib/template-field-f1.test.ts` — frozen grammar, source spans, occurrence IDs, malformed-source recovery, safe normalization, registry diagnostics, missing/circular partials, stable scoped identity, lossless legacy/forward metadata, typed descriptors and precedence.
- `__tests__/lib/a4-content-policy-f1.test.ts` — semantic C06 structures, C03 break, projection-only metadata, unsafe-tag exclusion and trusted-rich spoof rejection.
- `__tests__/lib/template-field-f0-compatibility.test.ts` — F1-owned baseline defects are promoted to passing expectations; the two F2 defects remain explicit `it.fails` cases.

Requested minimum command for F1:

```text
npx vitest run \
  __tests__/lib/template-field-contract.test.ts \
  __tests__/lib/template-field-f0-compatibility.test.ts \
  __tests__/lib/a4-content-policy.test.ts
```

This execution environment cannot produce a valid local F1 Vitest result: its available container runtime is Node 22 and the dependency-capable Node 24 checkout used in the earlier F0 evidence is not available here; outbound GitHub/npm resolution is unavailable from the container. I therefore do **not** record the requested focused Vitest command as passed. The PR's repository workflow uses Node 24 and is the authoritative lint/typecheck/build evidence available from this instance; it does not contain the requested F1-focused Vitest command and is not represented as a substitute for that command.

Affected existing suites to rerun in a dependency-capable Node 24 checkout before integration are:

```text
__tests__/lib/template-placeholder-storage.test.ts
__tests__/lib/template-analysis.test.ts
__tests__/lib/placeholder-resolver.test.ts
__tests__/lib/document-generation-master-fields.test.ts
```

plus template-editor parser/helper tests present on the integration baseline and the F1-specific suites above.

### Unresolved / intentionally deferred compatibility cases

- F2 ordinary-field HTML escaping remains intentionally unimplemented; the compatibility test stays `it.fails`.
- F2 declared-type runtime formatting/scoped binding remains intentionally unimplemented; ISO-looking text can still be appearance-formatted by the legacy resolver and the compatibility test stays `it.fails`.
- Raw legacy callers of `storagePlaceholdersToEditor` that do not yet supply a stable owner scope use the deterministic compatibility owner `legacy-template-editor`; CORE/WORKFLOW must supply real owner IDs at concrete boundaries during integration.
- Legacy partial records without persisted IDs use `legacy-partial:<stored name>` as the deterministic preservation fallback. No display label is used.
- W-owned API/Zod losslessness and final canonical generation adoption remain integration work; FIELDS did not edit those owned files.

### F1 ownership confirmation

F1 changed only F-owned parser/registry/adapters/types/analysis/editor-helper/content-policy files, F tests and this F coordination log. It did not edit W-owned API/routes/forms, SEMANTICS-owned structural modules, Prisma/schema files, deployment/configuration files or version metadata.

**FIELDS state:** `READY FOR INTEGRATION — F1 only`. F2 and F3 have not started.
---

## FIELDS-F2-20260912-01 — READY FOR INTEGRATION — F2 ONLY

**Role:** Parallel Agent 3 / FIELDS / F2 owner only
**Packet:** `FIELDS-F2-20260912-01`
**Starting merged main:** `6f1ab8d3cb90056c556771936f4c763d9596efdf`
**Recorded G1 Stage-2 source baseline:** `ad7285ace280f0b4002f119f923a8e2166b9475f` (historical programme record only; not used as the branch base)
**Branch:** `codex/a4-editor-fields-f2-20260912`
**PR:** `#45` — https://github.com/Scofieldkoh/oakcloud/pull/45
**Validated implementation head before this coordination-only handoff:** `8b64420ddd75386a3162b8d2dfa6eb6276703934`
**Frozen contract:** `v1 frozen at G0` unchanged; G1 remains `FROZEN / PASSED`; C05/C06 unchanged.
**Stop state:** `READY FOR INTEGRATION — F2 ONLY`.

### F2 implementation completed

1. Added `src/lib/template-field-resolution.ts` as the explicit F2 scoped-resolution and interpolation boundary. Owner/source scope remains structured and independent from the active render/value context (`company`, `contact`, `invoice`, `employee`, `global`, `loop_item`). Values resolve by exact field identity, with cross-field sharing allowed only through explicit identity-to-identity bindings.
2. Added deterministic legacy flattened-value adaptation. A legacy key may bind implicitly only when it resolves to exactly one scoped definition; collisions produce an explicit ambiguity error and require an exact identity binding. No label/display-name or underscore-concatenation identity is introduced.
3. Added ordinary-text escaping at interpolation: `&`, `<`, `>`, double quotes and single quotes are escaped exactly once; multiline values normalize CRLF/CR and emit `<br>` only after text escaping. Modifier results are escaped after transformation. Replacement is single-pass so braces introduced by ordinary field text are inert and are not reparsed as template syntax.
4. Preserved the C06 trust boundary. Declarative/stored/client render metadata cannot mint rich authority. Canonical trusted-rich fragments require a canonical C06 origin capability plus a WORKFLOW-supplied sanitizer. Legacy rich fragments require an explicitly approved compatibility binding plus a sanitizer. Forged trusted origins are rejected.
5. Unsupported legacy structured field values remain preserve-only and are never silently flattened or stringified to `[object Object]`.
6. Added `src/lib/template-field-lifecycle.ts` with pure all-or-nothing semantic transactions for create, relabel, definition change, key/path migration, insert-reference and delete. Applied transactions carry `before`/`after` snapshots, changed occurrence IDs and parser diagnostics so CORE can treat them as one undo/history unit and WORKFLOW can persist one revision/CAS result.
7. Key migration atomically updates parser-recognised references/modifiers, tracked path, same-scope key/path `linkedTo` references, exact identity links and a caller-projected dependent-metadata snapshot while retaining unknown/forward metadata.
8. Delete requires explicit confirmation before destructive reference removal. It also detects linked dependent definitions and requires an independent explicit dependent-unlink confirmation so deletion cannot silently leave dangling `linkedTo`; confirmed unlink removes only the link and preserves all other stored/forward metadata.
9. Insert-reference validates exactly one parser-recognised scoped reference and creates the definition plus source reference in one transaction. Cross-scope insertion is rejected.
10. `src/lib/template-field-runtime.ts` exports the new F2 APIs but leaves the existing `resolveTemplateFields` compatibility path unchanged. F2 is **not activated** in the legacy renderer by this packet; D2/W2 renderer/persistence activation remains WORKFLOW-owned.

### C05/C06 identity, legacy and losslessness evidence

- Stable persisted IDs remain the field identity authority across relabel and key migration.
- Equal semantic keys can coexist in parent and multiple partial owner scopes without renaming or flattening.
- Explicit identity linking can cross owner scopes; key/path-form linking migrates only within the target owner scope, so a same-named foreign-scope field is not rewritten accidentally.
- Unknown/forward metadata is retained through insert, relabel, definition change, key migration and dependent unlink.
- The F1 lossless parser/registry/storage suites remain green together with F2.
- The two F2 `it.fails` sentinels in `template-field-f0-compatibility.test.ts` deliberately remain expected failures for the old D2-inactive compatibility renderer. They must remain so until WORKFLOW performs the authorised D2 renderer switch; the new F2 APIs have separate executable passing coverage and this packet does not claim the legacy renderer is activated.

### Escaping and trust-boundary evidence

Executable F2 tests prove:

- plain text containing ampersands, angle brackets, double/single quotes and apparent HTML is escaped once;
- multiline text is normalized once and markup characters remain escaped;
- modifier output stays ordinary escaped text;
- inserted `{{...}}` text is inert because resolved field text is not reparsed;
- declarative client/stored rich-looking metadata cannot elevate text authority;
- canonical trusted-rich content is blocked without a sanitizer and accepted only with the canonical C06 origin capability plus sanitizer;
- forged trusted origins are rejected;
- already-safe trusted-rich content is not double-encoded by the field boundary;
- legacy-rich content is blocked unless both an approved compatibility binding and sanitizer are supplied.

### Exact Node 24 validation

An isolated validation-only branch was used solely because the local execution container exposes Node 22 and has no dependency/network access. It is not part of the F2 PR diff.

Validation run: https://github.com/Scofieldkoh/oakcloud/actions/runs/34667965526
Runtime: Node `v24.20.0`, npm `11.19.0`.

Commands/steps passed:

```text
npm ci
node -e "if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(1); console.log(process.version)"
npm run db:generate
npm run lint
npm run typecheck
npm run test:run -- \
  __tests__/lib/template-field-f2.test.ts \
  __tests__/lib/template-field-f2-edge.test.ts \
  __tests__/lib/template-field-f2-linking.test.ts \
  __tests__/lib/template-field-contract.test.ts \
  __tests__/lib/template-field-f0-compatibility.test.ts \
  __tests__/lib/template-field-f1.test.ts \
  __tests__/lib/a4-content-policy.test.ts \
  __tests__/lib/a4-content-policy-f1.test.ts \
  __tests__/lib/template-placeholder-storage.test.ts \
  __tests__/lib/template-analysis.test.ts \
  __tests__/lib/placeholder-resolver.test.ts \
  __tests__/lib/document-generation-master-fields.test.ts \
  --reporter=verbose
```

Result: **12 test files passed / 133 tests passed**. `npm run lint` completed with **0 errors / 10 pre-existing unrelated warnings**. `npm run typecheck` passed.

The normal PR Node 24 compatibility run for the validated code head also passed all jobs: https://github.com/Scofieldkoh/oakcloud/actions/runs/34667958776. This includes Node 24 static checks, `npm run build`, the production Docker image build/runtime/Chromium verification, and the repository's existing PostgreSQL recovery/authorization job.

### Exact CORE integration request

1. Consume an applied `SemanticFieldTransaction` as one editor history/undo unit. Do not replay its content, registry and dependent-metadata changes as separate editor mutations.
2. Project CORE-owned field-panel, token/data-attribute, title-date and related editor metadata through the transaction `metadataAdapter` so those changes are committed/reverted with the same semantic operation. FIELDS does not take ownership of the editor implementation.
3. When a transaction returns `needs-confirmation`, expose both source-usage information and `linkedFieldIdentities`; resubmit only after the user explicitly confirms the applicable reference removal and/or dependent unlink.
4. Keep navigation/token identity keyed by the F1 parser's structured identity, owner scope, occurrence ID and exact span. Do not infer identity from labels or presentation token attributes.

### Exact WORKFLOW integration request

1. Behind the authorised D2/W2 integration only, load lossless definitions with stable persisted owner IDs and construct the active `ScopedFieldValueContext` from the actual company/contact/invoice/employee/global/loop item. Do not flatten scopes into renamed keys.
2. Invoke `resolveScopedTemplateFieldSource` separately for the parent template and for each partial using that source's own owner scope/definitions, with the full definition set available for explicit identity bindings. Do not run resolved ordinary field text back through the template parser.
3. Recursive partial composition remains WORKFLOW-owned. Use the F1 parser/dependency information and pass composed partial output through the canonical C06 trusted-rich origin plus the renderer's allowlist sanitizer. Request/form/database text never becomes trusted HTML merely because metadata says so.
4. Use `renderResolvedFieldFragment` as the F2 trust boundary for any W-owned trusted/legacy-rich adapter: trusted-rich requires a canonical C06 origin plus sanitizer; legacy-rich requires an approved compatibility binding plus sanitizer.
5. Persist an applied lifecycle transaction's `after.content`, `after.definitions` and projected `after.dependentMetadata` atomically through the existing WORKFLOW revision/CAS path. Do not create partial writes across those units.
6. Use one canonical resolved HTML path for preview/HTML/PDF consumers; do not add a renderer-specific alternate field resolver.
7. Preserve all unknown/legacy definition metadata through W-owned API/Zod serialization; do not rebuild definitions from a narrow allow-list.

### Blocked dependencies and remaining risks

- **F2 implementation blocker:** none.
- **Activation dependencies:** CORE must wire the semantic transaction into editor history/UI confirmation/metadata projections; WORKFLOW must perform the authorised D2/W2 renderer/sanitizer/persistence integration. Those are intentionally outside FIELDS ownership.
- A legacy definition without a persisted ID can have its deterministic key-derived C05 identity change during an explicit key migration; the transaction exposes previous/new identity semantics so external consumer metadata can be remapped. Persisted-ID definitions remain stable.
- End-to-end renderer sanitization/HTML/PDF parity is not claimed here because the canonical sanitizer/renderer is WORKFLOW-owned and was deliberately not modified.
- Stable owner IDs must be supplied at concrete template/partial load boundaries; compatibility fallback owner IDs are not a substitute for production ownership.

### Ownership confirmation

F2 changed only FIELDS-owned library/test surfaces plus this FIELDS coordination log. It did not modify CORE editor production files, WORKFLOW routes/APIs/services, SEMANTICS production files, Prisma/schema/migrations, package/CI configuration, version metadata, deployment configuration or `main`. No F3, W2, deployment, version bump or merge was performed.

**FIELDS state:** `READY FOR INTEGRATION — F2 ONLY`.

# Business Assistant conversational expansion coordination

Date: 2026-09-16
Agent 0 baseline main SHA: `8e3901f90ada763fceb7d42f7d8c65b60204a9d5`
Agent 0 scope: contract/shared baseline only
Production status: all Business Assistant production gates remain disabled

## Purpose

This change establishes the smallest shared contract needed for the next conversational-expansion wave. It lets an explicitly selected registered Business Assistant capability receive its own validated domain input instead of requiring every run to start from the legacy chat envelope `{ message, context }`.

The change is intentionally backward compatible. Existing ordinary turns, `assistant.answer@1.0`, `workspace.resource_lookup@1.0`, capability cards, and callers that omit capability input continue using the current chat-envelope behavior. No routing intelligence, company-profile read capability, BizFile upload UI, conversation resource context, read-result redesign, P16 staging validation, production enablement, or worker refactor is included here.

## Invocation-envelope contract frozen by Agent 0

`BusinessAssistantTurnRequest` now accepts optional `capabilityInput`.

Contract rules:

1. `capabilityInput` is accepted only when `context.capabilityId` explicitly selects a capability registered in the generated Business Assistant registry.
2. The server resolves the capability from the generated registry. Browser input cannot provide a handler, module path, tool definition, SQL, Prisma instruction, or unregistered capability.
3. When `capabilityInput` is present, the selected capability's registered `inputSchema` parses and normalizes it before persistence.
4. Only the parsed, JSON-safe normalized capability input is persisted as `BusinessAssistantRun.input`; raw unvalidated capability input is never the executable run artifact.
5. When `capabilityInput` is absent, existing behavior is preserved and `BusinessAssistantRun.input` continues to receive `{ message, context }`.
6. Idempotency hashes include normalized `capabilityInput`. Equivalent normalized inputs replay the existing request; materially different capability input under the same `clientRequestId` conflicts with `ACTION_CONFLICT`.
7. Explicit capability input uses the existing Business Assistant bounded-artifact limit (`BUSINESS_ASSISTANT_LIMITS.maxProposalArtifactBytes`, currently 1,000,000 bytes) after canonical JSON normalization.
8. Workspace isolation, fresh workspace authorization, registry checks, operation identity, approval policy, mutation boundaries, and all existing production gates are unchanged.
9. The existing JSON run-input field is reused; no database migration is required.
10. `worker.ts` remains unchanged in this baseline so Agent 3 retains exclusive ownership during the parallel wave.

## Frozen shared interfaces for the next wave

The following identifiers and interfaces are frozen after this Agent 0 change and must not be changed independently by Agents 1-4 without integration-owner coordination:

- `BusinessAssistantTurnRequest` invocation envelope, including optional `capabilityInput`.
- `ResourceRef` shape: `{ resourceType, resourceId, role }`.
- `CapabilityDescriptor` shape.
- `BusinessAssistantCapability` base contract and its registered `inputSchema` authority.
- `bizfile.import_and_review@1.0` capability identity/version remains unchanged.
- Reserved future company read capability ID: `company.profile_read@1.0`.

Agent 0 does **not** add or register `company.profile_read@1.0`.

## Parallel workstreams and exclusive ownership

### Agent 1 - direct BizFile upload

Exclusive ownership:

- `src/components/business-assistant/workspace.tsx`
- new Business Assistant upload/attachment UI
- new Business Assistant BizFile upload hooks

Agent 1 consumes the frozen turn invocation envelope but must not alter the shared capability contract or Agent 3 routing/worker files.

### Agent 2 - company read capability

Exclusive ownership:

- `src/services/company/assistant-capabilities.ts`
- company assistant read application/helper modules
- generated Business Assistant capability registry changes produced by this wave

Agent 2 owns implementation of the reserved `company.profile_read@1.0` capability. The capability must use the frozen `BusinessAssistantCapability` contract and its own registered `inputSchema`.

### Agent 3 - routing and conversation context

Exclusive ownership:

- `src/services/business-assistant/conversation.service.ts`
- `src/services/business-assistant/worker.ts`
- new routing/context services

Agent 3 starts from this baseline and may build intelligent routing/conversation-resource context around the frozen invocation envelope. It must preserve explicit capability input validation, normalized run-input persistence, idempotency semantics, and backward compatibility established here.

### Agent 4 - read-result UX

Exclusive ownership:

- `src/components/business-assistant/run-card.tsx`
- new read-result detail components

Agent 4 consumes existing/future read outputs without changing the frozen capability descriptor/base contract.

## Integration order

The intended integration order after Agent 0 is:

1. Agent 0 shared contract baseline.
2. Agents 1, 2, 3, and 4 implement in parallel from the same Agent 0 baseline.
3. Integrate Agent 2 registry/capability changes before validating Agent 3 routing against the new company-read capability.
4. Integrate Agent 3 routing/context after resolving any registry-facing conflicts with Agent 2.
5. Agent 1 and Agent 4 UI work may integrate independently once their frozen API assumptions remain satisfied.
6. Run integrated Business Assistant contract, type, lint, registry, and relevant end-to-end checks after all four workstreams converge.
7. P16 staging validation remains a separate later activity; this wave does not satisfy or bypass P16.

## Production gates remain disabled

This conversational-expansion baseline does not change and does not authorize changes to:

- `BUSINESS_ASSISTANT_ENABLED`
- `BUSINESS_ASSISTANT_PROVIDER_ENABLED`
- `BUSINESS_ASSISTANT_MUTATIONS_ENABLED`
- learning/promotion gates
- deployment configuration
- credentials or secrets

Production enablement remains outside this wave and still requires the existing release/P16 process.

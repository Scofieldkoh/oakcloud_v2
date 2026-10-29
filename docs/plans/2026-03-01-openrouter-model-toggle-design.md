# OpenRouter Model Enable/Disable UI — Design

**Date:** 2026-03-01
**Status:** Approved

## Goal

Allow admins to enable or disable individual OpenRouter models per connector via a "Models" section inside the OpenRouter connector edit modal. State is persisted in a new `connector_model_configs` DB table.

## Architecture

### Data Model

New Prisma table `connector_model_configs` stores per-connector model overrides:

```prisma
model ConnectorModelConfig {
  id          String    @id @default(uuid())
  connectorId String
  connector   Connector @relation(fields: [connectorId], references: [id], onDelete: Cascade)
  modelId     String    // e.g., "qwen3-vl-235b-a22b-thinking"
  isEnabled   Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([connectorId, modelId])
  @@index([connectorId])
  @@map("connector_model_configs")
}
```

`Connector` gets a new relation: `modelConfigs ConnectorModelConfig[]`.

**Default behavior:** A model with no row in this table is considered enabled (consistent with the `enabled !== false` pattern in `AIModelConfig`). Only explicit `isEnabled: false` rows disable a model.

### Runtime Enforcement

In `callAIWithConnector()` (or a helper it calls), after resolving the OpenRouter connector, fetch its `modelConfigs` and verify the requested model is not disabled. If disabled, throw an error indicating the model is unavailable.

This check only applies to OpenRouter — other providers (OpenAI, Anthropic, Google) are single-model-per-call and don't need this layer.

## API

### `GET /api/connectors/[id]/models`

Returns all registered OpenRouter models from `AI_MODELS` merged with their DB override state for this connector:

```json
[
  {
    "modelId": "qwen3-vl-235b-a22b-thinking",
    "name": "Qwen3 VL 235B Thinking",
    "description": "Qwen3 large vision-language model with extended thinking",
    "providerModelId": "qwen/qwen3-vl-235b-a22b-thinking",
    "isEnabled": true,
    "hasOverride": false
  }
]
```

- Only works for `AI_PROVIDER` connectors (returns 400 for other types)
- Access control: SUPER_ADMIN or TENANT_ADMIN for their own tenant's connector
- Returns 404 if connector not found or not accessible

### `PUT /api/connectors/[id]/models`

Upserts a single model override:

**Request body:**
```json
{ "modelId": "qwen3-vl-235b-a22b-thinking", "isEnabled": false }
```

**Response:** The updated model entry (same shape as GET item).

- Uses Prisma `upsert` on `[connectorId, modelId]` unique key
- Same access control as GET
- Returns 400 if `modelId` is not a valid OpenRouter model

## UI

A **"Models" section** appears inside the edit modal **only for OpenRouter connectors**. It sits between the credentials section and the enabled toggle.

```
┌─────────────────────────────────────────┐
│ Edit OpenRouter Connector               │
├─────────────────────────────────────────┤
│ Display Name  [___________________]     │
│ API Key       [● ● ● ● ● ● ●]  👁       │
│                                         │
│ Models                                  │
│ ┌─────────────────────────────────────┐ │
│ │ ● Qwen3 VL 235B Thinking  [Toggle] │ │
│ │   qwen/qwen3-vl-235b-a22b-thinking │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ◉ Enabled                               │
├─────────────────────────────────────────┤
│ [Cancel]              [Save Changes]    │
└─────────────────────────────────────────┘
```

- Each model row shows: name, provider model ID, and a toggle switch
- Toggle calls `PUT /api/connectors/[id]/models` immediately (optimistic update — no "Save Changes" needed for model toggles)
- The section fetches via `useQuery` only when `editingConnector?.provider === 'OPENROUTER'`
- Loading state: skeleton rows while fetching
- Error state: inline error message if fetch or toggle fails

## Key Files

| Layer | File |
|-------|------|
| DB schema | `prisma/schema.prisma` |
| Migration | `prisma/migrations/` (new) |
| API routes | `src/app/api/connectors/[id]/models/route.ts` (new) |
| React hook | `src/hooks/use-connectors.ts` (add `useConnectorModels`, `useToggleConnectorModel`) |
| Page UI | `src/app/(dashboard)/admin/connectors/page.tsx` (add Models section to edit modal) |
| Runtime enforcement | `src/lib/ai/index.ts` (add model-disabled check in `callAIWithConnector`) |

## Out of Scope

- Model toggles for non-OpenRouter providers (they use the `enabled` flag in `AIModelConfig`)
- Per-tenant model overrides (this is per-connector, not per-tenant)
- Adding new models to the registry (still done in `src/lib/ai/models.ts`)

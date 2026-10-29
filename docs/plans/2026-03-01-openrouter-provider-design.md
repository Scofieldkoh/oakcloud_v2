# OpenRouter Provider — Design Doc

**Date:** 2026-03-01
**Status:** Approved

## Overview

Add OpenRouter as a first-class AI provider alongside OpenAI, Anthropic, and Google. OpenRouter uses an OpenAI-compatible API, so the implementation reuses the OpenAI SDK with a custom `baseURL`. Models are registered in the central model registry with an `enabled` flag for easy toggling. Usage (tokens, cost, latency, operation) is tracked via the existing `logConnectorUsage` pipeline.

## Decisions

| Question | Decision |
|---|---|
| Provider style | First-class provider (not an adapter) |
| API key source | Connector (DB) with `OPENROUTER_API_KEY` env var fallback |
| DB migration | Yes — add `OPENROUTER` to Prisma `ConnectorProvider` enum |
| Model toggling | `enabled: boolean` flag on `AIModelConfig` |

## Initial Models

| Model ID | OpenRouter path | Vision | Pricing ($/M) |
|---|---|---|---|
| `qwen3-vl-235b-a22b-thinking` | `qwen/qwen3-vl-235b-a22b-thinking` | Yes | TBD from OpenRouter pricing page |

## Files Changed

### 1. `prisma/schema.prisma`
- Add `OPENROUTER` to `ConnectorProvider` enum
- Generate migration

### 2. `src/lib/ai/types.ts`
- Add `'openrouter'` to `AIProvider` union
- Add `'qwen3-vl-235b-a22b-thinking'` to `AIModel` union
- Add `enabled?: boolean` to `AIModelConfig`
- Add `openrouter: { apiKey: string }` to `AICredentials`

### 3. `src/lib/ai/models.ts`
- Add OpenRouter model entry for `qwen3-vl-235b-a22b-thinking` with `enabled: true`
- Filter `enabled !== false` in `getAvailableModels()` and `getUsableModels()`
- Add `'openrouter'` to `PROVIDER_NAMES`, `PROVIDER_ICONS`, `getModelsGroupedByProvider()`

### 4. `src/lib/ai/providers/openrouter.ts` (new file)
- OpenAI SDK instance with `baseURL: 'https://openrouter.ai/api/v1'`
- Required headers: `HTTP-Referer` (from `OPENROUTER_SITE_URL`), `X-Title` (from `OPENROUTER_APP_NAME`)
- `isOpenRouterConfigured()` — checks `OPENROUTER_API_KEY`
- `callOpenRouter(options, credentials?)` — full vision support, usage tracking fields returned

### 5. `src/lib/ai/index.ts`
- Add `openrouter` to `getProviderStatus()`, `getAllProviderStatuses()`
- Add `openrouter` → `'OPENROUTER'` in `mapProviderToConnectorProvider()`
- Add `callOpenRouter` case in `callAI()` and `callAIWithConnector()`
- Add `openrouter` to `getAvailableProvidersForTenant()`

### 6. `src/lib/validations/connector.ts`
- Add `'OPENROUTER'` to `connectorProviderEnum`
- Add `openrouterCredentialsSchema: { apiKey: string }`
- Update `validateCredentials()`, `getProviderType()`, `getProvidersForType()`, `getProviderDisplayName()`

### 7. `src/services/connector.service.ts`
- Add `'OPENROUTER'` to `providersPerType.AI_PROVIDER`
- Add `case 'OPENROUTER'` in `testConnector()` switch
- Add `testOpenRouter()` helper (list models via OpenAI SDK at OpenRouter baseURL)

## Usage Tracking

No changes to `connector-usage.service.ts`. The existing `callAIWithConnector()` already:
- Records `inputTokens`, `outputTokens`, `totalTokens`
- Calls `calculateCost()` using the model's `inputPricePerMillion` / `outputPricePerMillion`
- Records `latencyMs`, `operation`, `success`, `errorMessage`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | No (env fallback) | OpenRouter API key |
| `OPENROUTER_SITE_URL` | No | Sent as `HTTP-Referer` header (improves OpenRouter ranking) |
| `OPENROUTER_APP_NAME` | No | Sent as `X-Title` header |

## Adding / Removing Models in Future

To add a new OpenRouter model: add an entry to `AI_MODELS` in `models.ts` with `provider: 'openrouter'` and `enabled: true`.
To disable a model: set `enabled: false` (keeps the entry for historical cost tracking).

# OpenRouter Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OpenRouter as a first-class AI provider with connector support, env-var fallback, model registry with `enabled` flag, and full usage tracking.

**Architecture:** OpenRouter uses the OpenAI SDK with a custom `baseURL` (`https://openrouter.ai/api/v1`), so a new provider file wraps that SDK call. A new `OPENROUTER` enum value is added to the Prisma `ConnectorProvider` enum via migration. Models are registered in the central `AI_MODELS` registry with an `enabled` flag to toggle them without deleting entries.

**Tech Stack:** Next.js, TypeScript, Prisma (PostgreSQL), OpenAI SDK (`openai` npm package, already installed), Zod.

---

### Task 1: Prisma migration — add OPENROUTER enum value

**Files:**
- Modify: `prisma/schema.prisma:218-226`

**Step 1: Add `OPENROUTER` to the `ConnectorProvider` enum**

In `prisma/schema.prisma`, find the `ConnectorProvider` enum and add `OPENROUTER`:

```prisma
enum ConnectorProvider {
  // AI Providers
  OPENAI
  ANTHROPIC
  GOOGLE
  OPENROUTER
  // Storage Providers
  ONEDRIVE
  SHAREPOINT
}
```

**Step 2: Run the migration**

```bash
npx prisma migrate dev --name add-openrouter-provider
```

Expected: migration file created in `prisma/migrations/`, Prisma client regenerated.

**Step 3: Verify generated client has the new enum**

```bash
grep -r "OPENROUTER" src/generated/prisma
```

Expected: matches found in the generated enum types.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add OPENROUTER to ConnectorProvider enum"
```

---

### Task 2: Update AI types

**Files:**
- Modify: `src/lib/ai/types.ts`

**Step 1: Add `openrouter` to `AIProvider` union (line 8)**

```typescript
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';
```

**Step 2: Add `qwen3-vl-235b-a22b-thinking` to `AIModel` union (lines 11-21)**

```typescript
export type AIModel =
  // OpenAI models
  | 'gpt-5.2'
  | 'gpt-4.1'
  // Anthropic models
  | 'claude-opus-4.5'
  | 'claude-sonnet-4.5'
  // Google models
  | 'gemini-3.1'
  | 'gemini-3-flash'
  // OpenRouter models
  | 'qwen3-vl-235b-a22b-thinking';
```

**Step 3: Add `enabled` to `AIModelConfig` interface (after `isDefault?`)**

```typescript
export interface AIModelConfig {
  id: AIModel;
  name: string;
  provider: AIProvider;
  providerModelId: string;
  description: string;
  maxTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsJson: boolean;
  supportsVision: boolean;
  supportsTemperature?: boolean;
  isDefault?: boolean;
  enabled?: boolean; // When false, model is hidden from available/usable lists (default: true)
}
```

**Step 4: Add `openrouter` to `AICredentials` interface**

```typescript
export interface AICredentials {
  openai: {
    apiKey: string;
    organization?: string;
  };
  anthropic: {
    apiKey: string;
  };
  google: {
    apiKey: string;
  };
  openrouter: {
    apiKey: string;
  };
}
```

**Step 5: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only about missing provider implementations (will be fixed in later tasks), not type errors in `types.ts` itself.

**Step 6: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "feat: add openrouter to AIProvider, AIModel, AIModelConfig types"
```

---

### Task 3: Register OpenRouter models in the model registry

**Files:**
- Modify: `src/lib/ai/models.ts`

**Step 1: Add OpenRouter model entry to `AI_MODELS`**

After the Google models block (around line 115), add:

```typescript
  // OpenRouter Models
  'qwen3-vl-235b-a22b-thinking': {
    id: 'qwen3-vl-235b-a22b-thinking',
    name: 'Qwen3 VL 235B Thinking',
    provider: 'openrouter',
    providerModelId: 'qwen/qwen3-vl-235b-a22b-thinking',
    description: 'Qwen3 large vision-language model with extended thinking',
    maxTokens: 131072,
    inputPricePerMillion: 0.0, // Update from https://openrouter.ai/qwen/qwen3-vl-235b-a22b-thinking
    outputPricePerMillion: 0.0, // Update from https://openrouter.ai/qwen/qwen3-vl-235b-a22b-thinking
    supportsJson: true,
    supportsVision: true,
    enabled: true,
  },
```

> **Note:** Check https://openrouter.ai/qwen/qwen3-vl-235b-a22b-thinking for current pricing and update `inputPricePerMillion` / `outputPricePerMillion`.

**Step 2: Update `getAvailableModels()` to filter by `enabled`**

The current implementation (line 94-103) maps all models. Update the filter:

```typescript
export function getAvailableModels(): ModelAvailability[] {
  return Object.values(AI_MODELS)
    .filter((model) => model.enabled !== false)
    .map((model) => {
      const providerStatus = getProviderStatus(model.provider);
      return {
        ...model,
        available: providerStatus.available,
        providerConfigured: providerStatus.configured,
      };
    });
}
```

**Step 3: Add `openrouter` to `PROVIDER_NAMES`, `PROVIDER_ICONS`, and `getModelsGroupedByProvider()`**

```typescript
export const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
};

export const PROVIDER_ICONS: Record<AIProvider, string> = {
  openai: '🤖',
  anthropic: '🔮',
  google: '✨',
  openrouter: '🔀',
};
```

Update `getModelsGroupedByProvider()`:

```typescript
export function getModelsGroupedByProvider(): Record<AIProvider, AIModelConfig[]> {
  return {
    openai: getModelsByProvider('openai'),
    anthropic: getModelsByProvider('anthropic'),
    google: getModelsByProvider('google'),
    openrouter: getModelsByProvider('openrouter'),
  };
}
```

**Step 4: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors in `models.ts`.

**Step 5: Commit**

```bash
git add src/lib/ai/models.ts
git commit -m "feat: register Qwen3 VL OpenRouter model with enabled flag support"
```

---

### Task 4: Create the OpenRouter provider implementation

**Files:**
- Create: `src/lib/ai/providers/openrouter.ts`

**Step 1: Create the provider file**

```typescript
/**
 * OpenRouter Provider
 *
 * Implementation for OpenRouter models using the OpenAI-compatible API.
 * Uses the OpenAI SDK with a custom baseURL.
 */

import type { AIRequestOptions, AIResponse, AICredentials } from '../types';
import { getModelConfig } from '../models';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Lazy-loaded instances keyed by API key (connector-based calls use different keys)
const instanceCache = new Map<string, import('openai').default>();

async function getOpenRouter(credentials?: AICredentials['openrouter']) {
  const apiKey = credentials?.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';

  if (instanceCache.has(apiKey)) {
    return instanceCache.get(apiKey)!;
  }

  const OpenAI = (await import('openai')).default;
  const instance = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'https://localhost',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'OakCloud',
    },
  });

  instanceCache.set(apiKey, instance);
  return instance;
}

/**
 * Check if OpenRouter is configured (via env var)
 */
export function isOpenRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Call OpenRouter API (supports vision)
 * @param options - Request options
 * @param credentials - Optional custom credentials (from connector)
 */
export async function callOpenRouter(
  options: AIRequestOptions,
  credentials?: AICredentials['openrouter']
): Promise<AIResponse> {
  if (!isOpenRouterConfigured() && !credentials?.apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const modelConfig = getModelConfig(options.model);
  if (modelConfig.provider !== 'openrouter') {
    throw new Error(`Model ${options.model} is not an OpenRouter model`);
  }

  const client = await getOpenRouter(credentials);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  } else if (options.jsonMode) {
    messages.push({ role: 'system', content: 'You are a helpful assistant. Respond with valid JSON.' });
  }

  if (options.images && options.images.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentParts: any[] = [];

    for (const image of options.images) {
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${image.mimeType};base64,${image.base64}`,
          detail: 'high',
        },
      });
    }

    contentParts.push({ type: 'text', text: options.userPrompt });
    messages.push({ role: 'user', content: contentParts });
  } else {
    messages.push({ role: 'user', content: options.userPrompt });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestOptions: any = {
    model: modelConfig.providerModelId,
    messages,
    max_tokens: options.maxTokens,
    ...(options.jsonMode && { response_format: { type: 'json_object' } }),
  };

  if (modelConfig.supportsTemperature !== false) {
    requestOptions.temperature = options.temperature ?? 0.1;
  }

  const response = await client.chat.completions.create(requestOptions);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenRouter');
  }

  return {
    content,
    model: options.model,
    provider: 'openrouter',
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
    finishReason: response.choices[0]?.finish_reason ?? undefined,
  };
}
```

**Step 2: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in the new file.

**Step 3: Commit**

```bash
git add src/lib/ai/providers/openrouter.ts
git commit -m "feat: add OpenRouter provider implementation"
```

---

### Task 5: Wire OpenRouter into the AI service index

**Files:**
- Modify: `src/lib/ai/index.ts`

**Step 1: Add import at the top (after the google import, around line 27)**

```typescript
import { callOpenRouter, isOpenRouterConfigured } from './providers/openrouter';
```

**Step 2: Add `openrouter` case in `getProviderStatus()` (inside the switch, after `google` case, before `default`)**

```typescript
    case 'openrouter':
      return {
        provider: 'openrouter',
        available: isOpenRouterConfigured(),
        configured: isOpenRouterConfigured(),
      };
```

**Step 3: Add `openrouter` to `getAllProviderStatuses()` return array**

```typescript
export function getAllProviderStatuses(): ProviderStatus[] {
  return [
    getProviderStatus('openai'),
    getProviderStatus('anthropic'),
    getProviderStatus('google'),
    getProviderStatus('openrouter'),
  ];
}
```

**Step 4: Add `openrouter` → `'OPENROUTER'` in `mapProviderToConnectorProvider()` (inside switch, before `default`)**

```typescript
    case 'openrouter':
      return 'OPENROUTER';
```

Note: also update the return type annotation of this function to include `'OPENROUTER'`:

```typescript
function mapProviderToConnectorProvider(provider: AIProvider): 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'OPENROUTER' {
```

**Step 5: Add `callOpenRouter` case in `callAI()` (inside switch, before `default`)**

```typescript
    case 'openrouter':
      return callOpenRouter(options);
```

**Step 6: Add `callOpenRouter` case in `callAIWithConnector()` (inside the `resolved` branch switch, before `default`)**

```typescript
      case 'openrouter':
        response = await callOpenRouter(options, {
          apiKey: credentials.apiKey as string,
        });
        break;
```

**Step 7: Add `openrouter` to `getAvailableProvidersForTenant()` connector switch (inside the for loop, before the closing brace)**

```typescript
        case 'OPENROUTER':
          availableProviders.add('openrouter');
          break;
```

**Step 8: Add env-var fallback for openrouter in `getAvailableProvidersForTenant()` (after the other env checks)**

```typescript
  if (isOpenRouterConfigured()) availableProviders.add('openrouter');
```

**Step 9: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 10: Commit**

```bash
git add src/lib/ai/index.ts
git commit -m "feat: wire OpenRouter into AI service index"
```

---

### Task 6: Update connector validation

**Files:**
- Modify: `src/lib/validations/connector.ts`

**Step 1: Add `'OPENROUTER'` to `connectorProviderEnum` (line 16)**

```typescript
export const connectorProviderEnum = z.enum(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENROUTER', 'ONEDRIVE', 'SHAREPOINT']);
```

**Step 2: Add `openrouterCredentialsSchema` (after `googleCredentialsSchema`)**

```typescript
export const openrouterCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

export type OpenRouterCredentials = z.infer<typeof openrouterCredentialsSchema>;
```

**Step 3: Add to the `ConnectorCredentials` union type**

```typescript
export type ConnectorCredentials =
  | OpenAICredentials
  | AnthropicCredentials
  | GoogleCredentials
  | OpenRouterCredentials
  | OneDriveCredentials
  | SharePointCredentials;
```

**Step 4: Add `OPENROUTER` case to `validateCredentials()`**

Inside the switch (after `GOOGLE` case):

```typescript
    case 'OPENROUTER': {
      const result = openrouterCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        errors.push(...result.error.issues.map((i) => i.message));
      }
      break;
    }
```

**Step 5: Add `OPENROUTER` to `getProviderType()`**

```typescript
    case 'OPENAI':
    case 'ANTHROPIC':
    case 'GOOGLE':
    case 'OPENROUTER':
      return 'AI_PROVIDER';
```

**Step 6: Add `OPENROUTER` to `getProvidersForType()`**

```typescript
    case 'AI_PROVIDER':
      return ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENROUTER'];
```

**Step 7: Add `OPENROUTER` to `getProviderDisplayName()`**

```typescript
  const names: Record<ConnectorProvider, string> = {
    OPENAI: 'OpenAI',
    ANTHROPIC: 'Anthropic',
    GOOGLE: 'Google AI',
    OPENROUTER: 'OpenRouter',
    ONEDRIVE: 'OneDrive',
    SHAREPOINT: 'SharePoint',
  };
```

**Step 8: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 9: Commit**

```bash
git add src/lib/validations/connector.ts
git commit -m "feat: add OPENROUTER to connector validation schemas"
```

---

### Task 7: Update connector service

**Files:**
- Modify: `src/services/connector.service.ts`

**Step 1: Add `'OPENROUTER'` to `providersPerType.AI_PROVIDER` (line ~580)**

```typescript
  const providersPerType: Record<ConnectorType, ConnectorProvider[]> = {
    AI_PROVIDER: ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENROUTER'],
    STORAGE: ['ONEDRIVE', 'SHAREPOINT'],
  };
```

**Step 2: Add `OPENROUTER` case to `testConnector()` switch (after `GOOGLE` case)**

```typescript
      case 'OPENROUTER':
        await testOpenRouter(connector.credentials as { apiKey: string });
        break;
```

**Step 3: Add `testOpenRouter()` helper function (after `testGoogle()`)**

```typescript
async function testOpenRouter(credentials: { apiKey: string }): Promise<void> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: credentials.apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  });
  await client.models.list();
}
```

**Step 4: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/services/connector.service.ts
git commit -m "feat: add OpenRouter to connector service provider list and test function"
```

---

### Task 8: Add environment variables to .env.example / docs

**Files:**
- Modify: `.env.example` (or equivalent env docs file in the repo)

**Step 1: Find where other AI keys are documented**

```bash
grep -n "OPENAI_API_KEY\|ANTHROPIC_API_KEY" .env.example
```

**Step 2: Add OpenRouter env vars next to the other AI keys**

```env
# OpenRouter (optional - AI models via OpenRouter)
OPENROUTER_API_KEY=
OPENROUTER_SITE_URL=https://your-app-domain.com
OPENROUTER_APP_NAME=OakCloud
```

**Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add OpenRouter environment variables to .env.example"
```

---

### Task 9: Final verification

**Step 1: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

**Step 2: Build check**

```bash
npm run build
```

Expected: build succeeds.

**Step 3: Verify the models API endpoint returns OpenRouter models**

Start the dev server and hit the models endpoint (or check via code):

```bash
npm run dev
```

Then check: `GET /api/ai/models` — should include `qwen3-vl-235b-a22b-thinking` in the response.

**Step 4: Manual connector test**
- Navigate to the connector settings page in the UI
- Create a new AI Provider connector, select "OpenRouter", enter an API key
- Click "Test connection" — should succeed

**Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: openrouter provider final cleanup"
```

---

## Adding Future OpenRouter Models

To add a new model (e.g., `meta-llama/llama-4-maverick`):

1. Add to `AIModel` union in `src/lib/ai/types.ts`
2. Add entry to `AI_MODELS` in `src/lib/ai/models.ts` with `provider: 'openrouter'`, `enabled: true`, and the correct `providerModelId`
3. Check pricing on https://openrouter.ai and set `inputPricePerMillion` / `outputPricePerMillion`

To disable a model without removing it: set `enabled: false` in its `AI_MODELS` entry.

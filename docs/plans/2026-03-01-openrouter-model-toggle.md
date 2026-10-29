# OpenRouter Model Enable/Disable UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Models" section to the OpenRouter connector edit modal that lets admins toggle individual OpenRouter models on/off, persisted in a new `connector_model_configs` DB table.

**Architecture:** New `ConnectorModelConfig` Prisma model (one row per connector+model override) with a `GET/PUT /api/connectors/[id]/models` route. The edit modal fetches model configs and sends immediate PUT calls on toggle. Runtime enforcement in `callAIWithConnector` rejects calls to disabled models.

**Tech Stack:** Prisma (PostgreSQL), Next.js 14 App Router, TanStack Query (React Query), TypeScript, Tailwind CSS.

---

### Task 1: Prisma migration — add `ConnectorModelConfig` table

**Design doc:** `docs/plans/2026-03-01-openrouter-model-toggle-design.md`

**Files:**
- Modify: `prisma/schema.prisma` (after the `ConnectorUsageLog` model, around line 1132)
- Create: `prisma/migrations/20260301000001_add_connector_model_configs/migration.sql`

**Step 1: Add the model to schema.prisma**

In `prisma/schema.prisma`, find the `Connector` model's relations block (around line 1059) and add `modelConfigs ConnectorModelConfig[]` after `usageLogs ConnectorUsageLog[]`:

```prisma
  // Relations
  tenantAccess TenantConnectorAccess[]
  usageLogs    ConnectorUsageLog[]
  modelConfigs ConnectorModelConfig[]
```

Then add the new model after the `ConnectorUsageLog` model (after the `@@map("connector_usage_logs")` line):

```prisma
model ConnectorModelConfig {
  id          String    @id @default(uuid())
  connectorId String
  connector   Connector @relation(fields: [connectorId], references: [id], onDelete: Cascade)
  modelId     String
  isEnabled   Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([connectorId, modelId])
  @@index([connectorId])
  @@map("connector_model_configs")
}
```

**Step 2: Create the migration SQL file**

Create `prisma/migrations/20260301000001_add_connector_model_configs/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "connector_model_configs" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connector_model_configs_connectorId_idx" ON "connector_model_configs"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_model_configs_connectorId_modelId_key" ON "connector_model_configs"("connectorId", "modelId");

-- AddForeignKey
ALTER TABLE "connector_model_configs" ADD CONSTRAINT "connector_model_configs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**Step 3: Apply migration and regenerate Prisma client**

Run:
```bash
npx prisma db execute --file prisma/migrations/20260301000001_add_connector_model_configs/migration.sql --schema prisma/schema.prisma
npx prisma generate
```

Expected output from `prisma generate`: `✔ Generated Prisma Client` with no errors.

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors referencing `ConnectorModelConfig`.

**Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260301000001_add_connector_model_configs/
git commit -m "feat: add ConnectorModelConfig table for per-connector model overrides"
```

---

### Task 2: API route — `GET/PUT /api/connectors/[id]/models`

**Files:**
- Create: `src/app/api/connectors/[id]/models/route.ts`

**Context:** Other sub-routes in `src/app/api/connectors/[id]/` follow the same pattern — import `requireAuth` from `@/lib/auth`, check `session.isSuperAdmin || session.isTenantAdmin`, then call service logic. See `src/app/api/connectors/[id]/route.ts` for the exact pattern.

The `AI_MODELS` registry in `src/lib/ai/models.ts` exports a `Record<AIModel, AIModelConfig>` — filter by `provider === 'openrouter'` to get all OpenRouter models.

**Step 1: Create the route file**

Create `src/app/api/connectors/[id]/models/route.ts`:

```typescript
/**
 * Connector Model Configs API
 *
 * GET /api/connectors/[id]/models - List model configs for a connector
 * PUT /api/connectors/[id]/models - Toggle a model's enabled state
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AI_MODELS } from '@/lib/ai/models';
import { z } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin && !session.isTenantAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify connector exists and is accessible
    const connector = await prisma.connector.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(session.isSuperAdmin ? {} : { tenantId: session.tenantId }),
      },
    });

    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    // Get all models for this provider from the registry
    const registryModels = Object.values(AI_MODELS).filter(
      (m) => m.provider === connector.provider.toLowerCase()
    );

    if (registryModels.length === 0) {
      return NextResponse.json([]);
    }

    // Get existing overrides from DB
    const overrides = await prisma.connectorModelConfig.findMany({
      where: { connectorId: id },
    });

    const overrideMap = new Map(overrides.map((o) => [o.modelId, o.isEnabled]));

    const models = registryModels.map((m) => ({
      modelId: m.id,
      name: m.name,
      description: m.description,
      providerModelId: m.providerModelId,
      isEnabled: overrideMap.has(m.id) ? overrideMap.get(m.id)! : true,
      hasOverride: overrideMap.has(m.id),
    }));

    return NextResponse.json(models);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const toggleModelSchema = z.object({
  modelId: z.string().min(1),
  isEnabled: z.boolean(),
});

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin && !session.isTenantAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify connector exists and is accessible
    const connector = await prisma.connector.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(session.isSuperAdmin ? {} : { tenantId: session.tenantId }),
      },
    });

    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    const body = await request.json();
    const { modelId, isEnabled } = toggleModelSchema.parse(body);

    // Validate that modelId belongs to this connector's provider
    const modelConfig = AI_MODELS[modelId as keyof typeof AI_MODELS];
    if (!modelConfig || modelConfig.provider !== connector.provider.toLowerCase()) {
      return NextResponse.json({ error: 'Invalid model for this connector' }, { status: 400 });
    }

    // Upsert the override
    const config = await prisma.connectorModelConfig.upsert({
      where: { connectorId_modelId: { connectorId: id, modelId } },
      create: { connectorId: id, modelId, isEnabled },
      update: { isEnabled },
    });

    return NextResponse.json({
      modelId: config.modelId,
      name: modelConfig.name,
      description: modelConfig.description,
      providerModelId: modelConfig.providerModelId,
      isEnabled: config.isEnabled,
      hasOverride: true,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "models/route"
```

Expected: no output (no errors).

**Step 3: Commit**

```bash
git add src/app/api/connectors/[id]/models/route.ts
git commit -m "feat: add GET/PUT /api/connectors/[id]/models route"
```

---

### Task 3: React hooks — `useConnectorModels` and `useToggleConnectorModel`

**Files:**
- Modify: `src/hooks/use-connectors.ts` (append after the existing `useUpdateTenantAccess` hook)

**Context:** All hooks in `use-connectors.ts` use TanStack Query (`useQuery`/`useMutation`) from `@tanstack/react-query`. The `useQueryClient` pattern is: get client, invalidate relevant query keys on success. Query keys follow `['connector-X', id]` naming convention.

**Step 1: Add the `ConnectorModelConfig` type and hooks**

In `src/hooks/use-connectors.ts`, find the end of the file and append the following (before the last line if any, or just at the end):

First, add the type near the other interface definitions (after `UpdateConnectorData`):

```typescript
export interface ConnectorModelConfig {
  modelId: string;
  name: string;
  description: string;
  providerModelId: string;
  isEnabled: boolean;
  hasOverride: boolean;
}
```

Then at the end of the file, add the two hooks:

```typescript
// ============================================================================
// Connector Model Config Hooks
// ============================================================================

/**
 * Fetch model configs for a connector (only meaningful for OPENROUTER connectors)
 */
export function useConnectorModels(connectorId: string | undefined) {
  return useQuery<ConnectorModelConfig[]>({
    queryKey: ['connector-models', connectorId],
    queryFn: async () => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/models`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch model configs');
      }
      return res.json();
    },
    enabled: !!connectorId,
  });
}

/**
 * Toggle a model's enabled state for a connector
 */
export function useToggleConnectorModel(connectorId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<ConnectorModelConfig, Error, { modelId: string; isEnabled: boolean }>({
    mutationFn: async ({ modelId, isEnabled }) => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/models`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, isEnabled }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to toggle model');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-models', connectorId] });
    },
  });
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "use-connectors"
```

Expected: no output.

**Step 3: Commit**

```bash
git add src/hooks/use-connectors.ts
git commit -m "feat: add useConnectorModels and useToggleConnectorModel hooks"
```

---

### Task 4: UI — Models section in edit modal

**Files:**
- Modify: `src/app/(dashboard)/admin/connectors/page.tsx`

**Context:**
- The edit modal renders in `{/* Edit Modal */}` starting around line 1058.
- `editingConnector` is the selected `Connector | null`.
- The credentials section ends and the enabled toggle starts around line 1173.
- The pattern for the toggle switch already exists in the file (the enabled toggle uses `cn(...)` with `bg-oak-primary`/`bg-gray-300`).
- The import for `cn` already exists: `import { cn } from '@/lib/utils'` on line 62.
- Add the `useConnectorModels` and `useToggleConnectorModel` imports to the hook import block at the top.

**Step 1: Add hook imports**

In the import block at the top of the file (around line 6-24), add `useConnectorModels` and `useToggleConnectorModel` and `ConnectorModelConfig` to the `use-connectors` import:

Find:
```typescript
  useConnectorUsage,
  useExportUsage,
  getProviderDisplayName,
```

Replace with:
```typescript
  useConnectorModels,
  useToggleConnectorModel,
  useConnectorUsage,
  useExportUsage,
  getProviderDisplayName,
```

Also add `type ConnectorModelConfig` to the type imports at the bottom of that block:
Find:
```typescript
  type ConnectorSearchParams,
  type UsageSearchParams,
} from '@/hooks/use-connectors';
```

Replace with:
```typescript
  type ConnectorSearchParams,
  type UsageSearchParams,
  type ConnectorModelConfig,
} from '@/hooks/use-connectors';
```

**Step 2: Add hook calls in the component body**

In the component body, after the existing hook calls (around line 180-190 where the other hooks like `useCreateConnector`, `useUpdateConnector` etc. are called), add:

```typescript
  const { data: connectorModels, isLoading: isLoadingModels } = useConnectorModels(
    editingConnector?.provider === 'OPENROUTER' ? editingConnector?.id : undefined
  );
  const toggleModelMutation = useToggleConnectorModel(editingConnector?.id);
```

**Step 3: Add the Models section to the edit modal**

In the edit modal's `<div className="space-y-4">` section, add the Models section between the credentials block and the Options/enabled toggle block. Find the comment `{/* Options */}` and insert before it:

```tsx
              {/* Models — OpenRouter only */}
              {editingConnector?.provider === 'OPENROUTER' && (
                <div className="space-y-3">
                  <label className="label mb-0">Models</label>
                  {isLoadingModels ? (
                    <div className="space-y-2">
                      {[1, 2].map((i) => (
                        <div
                          key={i}
                          className="h-14 rounded-lg bg-bg-tertiary animate-pulse"
                        />
                      ))}
                    </div>
                  ) : connectorModels && connectorModels.length > 0 ? (
                    <div className="space-y-2">
                      {connectorModels.map((model: ConnectorModelConfig) => (
                        <div
                          key={model.modelId}
                          className="flex items-center justify-between p-3 rounded-lg border border-border-primary bg-bg-tertiary"
                        >
                          <div className="flex flex-col min-w-0 mr-3">
                            <span className="text-sm font-medium text-text-primary truncate">
                              {model.name}
                            </span>
                            <span className="text-xs text-text-muted truncate">
                              {model.providerModelId}
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={model.isEnabled}
                            disabled={toggleModelMutation.isPending}
                            onClick={() =>
                              toggleModelMutation.mutate({
                                modelId: model.modelId,
                                isEnabled: !model.isEnabled,
                              })
                            }
                            className={cn(
                              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-oak-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
                              model.isEnabled
                                ? 'bg-oak-primary border-oak-primary'
                                : 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
                            )}
                          >
                            <span
                              className={cn(
                                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out',
                                model.isEnabled ? 'translate-x-5' : 'translate-x-0'
                              )}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-text-muted">No models registered for this provider.</p>
                  )}
                </div>
              )}
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/app/(dashboard)/admin/connectors/page.tsx
git commit -m "feat: add Models section to OpenRouter connector edit modal"
```

---

### Task 5: Runtime enforcement in `callAIWithConnector`

**Files:**
- Modify: `src/lib/ai/index.ts` (inside `callAIWithConnector`, after `resolved` is found and before the provider switch)

**Context:** `callAIWithConnector` is in `src/lib/ai/index.ts` around line 264. After it resolves a connector (`if (resolved) {`), it grabs credentials and makes the call. We need to add a model-enabled check for OpenRouter connectors only. Use a lazy `prisma` import (like other lazy imports in the file) to avoid circular deps.

**Step 1: Add model-disabled check**

In `src/lib/ai/index.ts`, find the `if (resolved) {` block (around line 283). After the line:

```typescript
    const credentials = resolved.connector.credentials as Record<string, unknown>;
```

Add:

```typescript
    // For OpenRouter, verify the requested model is not disabled for this connector
    if (provider === 'openrouter') {
      const { prisma } = await import('@/lib/prisma');
      const modelOverride = await prisma.connectorModelConfig.findUnique({
        where: {
          connectorId_modelId: {
            connectorId: resolved.connector.id,
            modelId: options.model,
          },
        },
      });
      // A row with isEnabled: false means the model is explicitly disabled
      if (modelOverride && !modelOverride.isEnabled) {
        throw new Error(
          `Model "${options.model}" is disabled for this OpenRouter connector.`
        );
      }
    }
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/ai/index.ts
git commit -m "feat: enforce per-connector model disabled check in callAIWithConnector"
```

---

### Task 6: Final verification

**Step 1: Full TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 2: Build check**

```bash
npx next build 2>&1 | tail -20
```

Expected: build completes successfully.

**Step 3: Manual smoke test**

1. Start dev server: `npm run dev`
2. Navigate to Admin → Connectors
3. Find (or create) an OpenRouter connector
4. Click "Edit" on it
5. Verify the "Models" section appears between credentials and the Enabled toggle
6. Verify "Qwen3 VL 235B Thinking" appears with its toggle set to ON
7. Click the toggle to disable it — it should turn gray immediately
8. Close and reopen the modal — the toggle should still be OFF (persisted)
9. Re-enable and verify it turns green again

**Step 4: Commit (if any fixes needed)**

```bash
git add -p
git commit -m "fix: address verification issues"
```

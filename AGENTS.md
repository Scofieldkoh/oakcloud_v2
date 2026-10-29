# Oakcloud Agent Guide

This file is the default operating guide for coding agents working in this repository. It applies repo-wide unless a more specific `AGENTS.md` exists in a subdirectory.

## Core principles

- Make the smallest safe change that fully solves the requested problem.
- Keep code clean, modular, reusable, and consistent with nearby code.
- Prefer existing services, APIs, utilities, components, and patterns over introducing parallel implementations.
- Preserve authentication, authorization, tenant isolation, auditability, and existing business rules.
- Do not mix unrelated cleanup or speculative refactors into a task.
- Update relevant existing documentation under `docs/` when behavior changes; avoid creating documentation sprawl.
- Surface unrelated defects or improvements separately instead of silently expanding scope.

## Project snapshot

Oakcloud is a TypeScript application built primarily with:

- Next.js 15 and React 19
- Prisma 7 with PostgreSQL
- Vitest for automated tests
- Playwright/browser tooling for browser-level checks
- ESLint and TypeScript type checking
- Node.js `>=24 <25`

Useful source locations include:

- `src/app/` — application routes, pages, route handlers, and app-level entry points
- `src/components/` — reusable UI components
- `src/services/` — service-layer and domain workflow implementations
- `src/lib/` — shared libraries and utilities
- `src/hooks/` — React hooks
- `src/stores/` — client/state stores
- `src/types/` — shared TypeScript types
- `src/generated/` — generated code; do not hand-edit unless the repository explicitly requires it
- `prisma/` — database schema, migrations, and seed-related code
- `__tests__/` — automated tests, including integration coverage
- `scripts/` — maintenance, migration, smoke-test, and operational scripts

## Before editing

1. Read the nearest relevant implementation, tests, and existing documentation.
2. Search the repository for an existing service, route, helper, schema, or workflow that already owns the behavior.
3. Identify permission, tenant, persistence, external-integration, and side-effect boundaries before changing them.
4. Prefer extending the canonical workflow over reimplementing it in a new layer.
5. Keep public interfaces stable unless the task explicitly requires a contract change.

## Architecture and implementation rules

- Keep transport/UI concerns separate from domain and persistence logic where the existing architecture does so.
- Prefer calling canonical functions in `src/services/` or existing API/action boundaries instead of duplicating business workflows inside UI code or agent-specific code.
- Validate untrusted input at system boundaries and reuse existing Zod schemas or validation helpers where available.
- Preserve tenant scoping on reads and writes. Never weaken tenant filters for convenience.
- Preserve authorization checks for privileged or destructive actions.
- Do not expose secrets, access tokens, credentials, personal data, or sensitive document contents in logs or error messages.
- Avoid broad catch blocks that hide failures. Return or log actionable errors using existing repository patterns.
- Keep generated artifacts out of hand-written source unless they are intentionally versioned by the project.

## UI changes

- Follow existing Oakcloud components, spacing, typography, interaction, and responsive patterns visible in the surrounding feature.
- Reuse existing components before adding near-duplicates.
- Preserve accessibility semantics, keyboard behavior, labels, focus states, and meaningful loading/error states.
- Do not invent a new design system for a feature unless explicitly requested.
- Follow the [Design Guidelines](./docs/guides/DESIGN_GUIDELINE.md) for UI work.

## Database and Prisma

- Treat schema and migration changes as high-impact changes.
- Reuse existing models and relations where they represent the same domain concept.
- When changing the Prisma schema, regenerate the Prisma client and add or update migrations using the repository's established workflow.
- Never reset, drop, truncate, or destructively rewrite a database unless the user explicitly requests it and the target environment is confirmed safe.
- Do not edit historical migrations merely to make a new schema state convenient; add a forward migration unless project conventions clearly say otherwise.
- Account for existing data, nullability, defaults, uniqueness, indexes, and tenant isolation when changing persistence models.

## Validation and tests

Use the narrowest relevant checks while developing, then run the appropriate repository checks before presenting work as complete.

Common commands:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Additional integration and performance test scripts are defined in `package.json`. Run the relevant targeted suite when a change touches that subsystem and the required test environment is available.

When behavior changes:

- Add or update tests for the changed behavior and important failure paths.
- Prefer regression tests that fail before the fix and pass after it.
- Include tenant-isolation and permission coverage when relevant.
- Do not claim a test, build, migration, or smoke check passed unless it was actually run successfully.
- If a required environment or external dependency prevents a check, state that clearly.

Documentation-only changes generally do not require application test execution unless they alter executable examples, scripts, configuration, or generated artifacts.

## Git and pull-request discipline

- Keep diffs focused and easy to review.
- Do not commit `.env` files, credentials, local caches, build output, or unrelated generated files.
- Preserve unrelated user changes in a working tree.
- Use clear commit messages that describe the behavior or documentation changed.
- In the PR summary, state what changed, why, and what validation was performed.
- Call out migrations, compatibility concerns, new environment variables, permissions, or operational steps explicitly.
- Review the final diff for accidental edits before opening or updating a PR.

## Agent-specific guardrails

- Do not create new agent-only implementations of existing document generation, e-signing, filing, task-resource, billing, onboarding, or other established workflows when a canonical Oakcloud service/API can be called or adapted.
- If an agent needs a new capability, prefer a thin agent-facing adapter around the canonical action boundary rather than copying domain logic.
- Keep agent actions explicit about inputs, permissions, outputs, and side effects.
- Prefer read-only inspection before mutation when investigating an issue.
- For irreversible or externally visible actions, preserve existing confirmation/approval boundaries unless the task explicitly changes them.

## Definition of done

A change is ready when it is scoped to the request, consistent with repository architecture, protects security and tenant boundaries, updates relevant tests/documentation, passes the checks that can reasonably be run, and leaves a focused reviewable diff.

## Observations

- 2026-09-10 Business Assistant continuation: the earlier e-signing and correction-service type errors are resolved in the current workspace. Full Node 24 typecheck and production build pass; the focused assistant/BizFile run passes 301 tests, PostgreSQL 22, and Chromium 5. Preserve concurrent e-signing edits when preparing commits. Remaining release gates are recorded in the implementation handover.

- 2026-09-09 Business Assistant continuation: the focused assistant/BizFile run passes 230 tests, but full Node 24 typecheck reports e-signing errors outside this change: missing `completionCopyEmails` in `esigning-list-page.tsx`, and nullable email values in `esigning-envelope.service.ts` and `esigning-pdf.service.ts`. The workspace includes concurrent e-signing edits; preserve those changes and resolve/check them with their owning work before claiming a clean full build.

- 2026-09-07 Business Assistant migration validation: applying all 64 migrations to disposable PostgreSQL 16 succeeded, but Prisma migration diff also reports pre-existing index/constraint-name and database-default differences on unrelated tables (including billing, tasks, and ACRA). Do not apply the entire generated diff as a cleanup migration; isolate assistant changes and review unrelated drift separately. Details are recorded in the existing [implementation handover](./docs/plans/2026-09-05-business-assistant-implementation.md).

- 2026-09-05 Business Assistant documentation review: this shell reports Node 22.19.0 while `package.json` requires Node 24. The five focused BizFile baseline test files passed (65 tests), but implementation/release checks must use Node 24. Follow the existing [runtime migration record](./docs/plans/2026-09-05-node-24-runtime-migration.md); no runtime change was made in this review.

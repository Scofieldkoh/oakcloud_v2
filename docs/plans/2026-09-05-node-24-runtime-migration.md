# Oakcloud Node 24 Runtime Migration

> **Status**: Implementation record
> **Source**: `2026-09-05-oakcloud-node-24-runtime-migration.md`
> **Assessment baseline**: `a3e4066cb102c4be2d636df0f108bc4bd7fca320`

## Objective

Move Oakcloud's application and build runtime from Node.js 20 to Node.js 24
LTS on Alpine 3.24 while preserving application, database, and deployment
architecture. The migration adds resilient Chromium discovery, production
image PDF/PNG smoke coverage, developer runtime declarations, focused CI
compatibility checks, and updated runtime/deployment documentation.

## Scope and constraints

- Use the single-stage `node:24-alpine3.24` image with Alpine's `gcompat` and
  system `chromium` packages.
- Keep Next.js, Prisma, React, Puppeteer, Playwright, Vitest, Vite, Sharp, and
  all other application dependency versions unchanged.
- Do not modify Prisma schema or migration history, application data, business
  logic, external-service configuration, or PDF pagination behaviour.
- Preserve the `findChromePath` export from
  `src/services/document-export.service.ts` for existing callers.
- Keep production and staging credentials, client data, generated PDFs, and
  test output out of the repository.
- Treat Chromium/PDF generation as the highest-risk compatibility boundary.

## Implementation tasks

1. Add `src/lib/chrome-executable.ts`. Check a trimmed `CHROME_PATH` first,
   verify candidates with `fs.constants.X_OK`, deduplicate checks, fall back to
   platform-standard paths, and report all checked paths on failure.
2. Add focused resolver unit tests covering configured paths, fallback,
   whitespace, deduplication, actionable errors, and executable access mode.
3. Re-export the resolver from `document-export.service.ts` and import it
   directly in `pdf-rasterize.ts` without changing Puppeteer flags or PDF logic.
4. Add `scripts/smoke-chromium.ts` and `npm run test:chromium`. The smoke test
   launches Chromium, renders deterministic HTML to A4 PDF, reloads the PDF
   through a data URL, captures PNG output, validates signatures and sizes, and
   closes browser resources in `finally`.
5. Update the Docker image to create and expose
   `/usr/local/bin/oakcloud-chromium`, prove its version during build, and run
   the browser smoke test before the existing Prisma and Next.js build steps.
6. Declare Node 24 with `.nvmrc`, `package.json` engines, and a `typecheck`
   script. Keep the lockfile limited to matching root metadata.
7. Add `.github/workflows/node24-compatibility.yml` with read-only permissions,
   cancellation for superseded runs, Node 24 lint/typecheck/unit/build gates,
   and a separate pulled production-image/browser smoke gate.
8. Update the getting-started, architecture, staging/deployment, index, and
   project overview documentation. Production rollout remains gated on staging
   image verification and real external TLS/integration smoke tests.

## Verification gates

The required verification sequence is:

- `npm ci`, `npm run lint`, `npm run typecheck`, the full unit suite, and the
  Next.js production build under Node 24.
- Browser and A4 smoke suites on an isolated host with the required browser.
- PostgreSQL integration suites against a disposable, verified test database.
- A no-cache, pull-enabled production Docker build and final-image checks for
  Node 24, the stable Chromium path, Chromium version, and
  `npm run test:chromium`.
- Staging checks for authentication, database, storage, PDF generation and
  rasterisation, ZIP export, E-signing, Graph/SharePoint, email, HTTPS S3,
  enabled AI providers, Redis, scheduler, and the normal Cloudflare route.
- PDF parity by page count, page size/orientation, pagination, tables,
  headers/footers, fonts, images, reopening, rasterisation, and ZIP filenames;
  byte-for-byte equality is not required.

Do not lower global TLS security or weaken tests to work around a failure. Keep
the pre-migration commit and image available until post-deployment verification
passes; rollback is an application source/image rollback and requires no
database rollback.

## Deferred follow-ups

- Upgrade `@types/node` to major version 24 separately.
- Require the compatibility workflow jobs through repository administration.
- Evaluate image digest pinning, multi-stage builds, and non-root Chromium
  execution as separate changes.
- Expand CI coverage only after the existing full suite is deterministic and
  safe to run in the hosted environment.

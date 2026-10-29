## Development Guidelines

**Key Principles:**
- Keep code clean, efficient, modular, reusable, and consistent
- Update documentation under `docs/` instead of creating new files
- Follow [Design Guidelines](./guides/DESIGN_GUIDELINE.md) for UI work
- Log unrelated errors or improvements here
## Known Unrelated Issues

- A cold `tsc --noEmit` needs about 5.2 GB of heap, above Node's default limit, so `npm run typecheck` now runs tsc with `--max-old-space-size=8192` (the same limit as the CI build step). (2026-09-26)
- Vitest runs in `Asia/Singapore` time so date assertions match the firm's time zone. (2026-09-27)
- All PostgreSQL integration suites pass as of 2026-09-30. To run them in a cloud session, start Postgres (`pg_ctlcluster 16 main start`), apply migrations with `DATABASE_URL=<url> npx prisma migrate deploy`, then run `TEST_DATABASE_URL=<url> DATABASE_URL=<url> BUSINESS_ASSISTANT_TEST_DATABASE_URL=<url> npx vitest run postgres.test --maxWorkers=1` (about 5 minutes). (2026-09-30)
- In a full `vitest run` on a busy box, `company-create-workspace` ("renders enum-backed profile fields as searchable dropdowns") and `oaktree-service-agreement-reference` ("writes long dates, the term in words and the effective date fallback") can fail under load but pass when run alone. (2026-09-28)
- `oakdoc-template-preview` ("renders the same document as generation from the same master and context") can also fail in a full non-database run under load and pass alone. (2026-09-30)
- Browser tests (`npm run test:browser`) all pass as of 2026-09-30. In a cloud session the pinned Playwright browser is missing; run them with `BROWSER_TEST_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:browser`. (2026-09-30)
- In `client-service-manual-creation.postgres.test.ts`, "allows exactly one simultaneous unconfirmed create and returns a duplicate for the serialization loser" failed once in several full database runs: the losing create rejected with a raw `PrismaClientKnownRequestError` instead of `DuplicateClientServiceError`. It did not reproduce alone or in a 40-iteration stress loop, so the error code is unknown. `isSerializationConflict` (src/lib/prisma-transaction.ts) does not recognise P2028 (transaction timeout), which is one suspect. (2026-09-30)

# QA harness

Safety net for money math and the demo UI. Demo data only — nothing here
talks to Supabase (the client is mocked in unit tests; e2e runs with a dummy,
unroutable Supabase URL and stubs every non-localhost request).

| Command | What |
|---|---|
| `npm test` | all vitest suites (incl. `src/test/qa`) |
| `npm run test:qa` | only the QA unit/integration suites |
| `npx playwright install chromium` | one-time browser download |
| `npm run test:e2e` | Playwright smoke against `vite` dev on :4317 (`QA_E2E_SERVER=preview` for the prod build) |
| `scripts/qa/run-against.sh <tree>` | run tsc/lint/test/build/e2e + this harness against another checkout (temp worktree) |

## Layout
- `src/test/qa/expose-internals.plugin.ts` — vitest-only plugin that exposes module-private helpers
  (e.g. `detectInternalTransfers`, `isIncomeCategory`) as `__qa_internals__` so they can be tested
  without editing components. Missing helpers produce a clear "helper missing" failure.
- `src/test/qa/home-vs-spending.test.tsx` — renders the real `LivePlaidDashboard` in demo mode with
  fixture transactions (`fixtures.ts`) and reads the figures users see.
- `e2e/` — smoke: every main view loads on `/demo` with no console errors, no spinner after 10s,
  no visible `null`/`undefined`/`NaN`, Home "Spent this month" == Spending "Total spent".

## Known bugs (expected-fail)
Tests named `KNOWN BUG …` use `it.fails` / `test.fail`. They assert the *correct* behavior, so
when a fix lands they report "expected to fail but passed" — delete the `.fails`/`test.fail` then.

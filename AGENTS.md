# Japanese Verb Master Agent Guide

This file defines the default workflow for coding agents working in this repository.
Keep changes scoped, preserve unrelated user edits, and avoid repeating expensive checks.

## Repository Map

- `frontend/`: Vue 3 + Vite client.
- `backend/server.ts`: Express routes and application bootstrap.
- `backend/userStore.ts`: SQLite/PostgreSQL user data adapters.
- `backend/payments/`: payment providers.
- `backend/knowledge/`: local RAG ingestion, retrieval, and evaluation.
- `backend/tests/`: Node test suite.
- `docs/`: maintenance and integration notes.

## Editing Rules

- Read the affected module and its tests before editing.
- Do not modify or commit unrelated dirty files.
- Never commit API keys, passwords, database URLs, `.env` files, tokens, or real
  payment identifiers.
- Keep provider secrets server-side. Browser responses may expose only public
  data such as a deposit address.
- Preserve user isolation: user-owned reads and writes must be scoped by
  `req.userId`.
- Payment settlement must be idempotent and verified server-side.
- Use the existing architecture before adding new abstractions or dependencies.

## Verification Matrix

Run only the smallest check that covers the change. Do not run the same check
again unless code changed after it passed.

| Change | Required check |
| --- | --- |
| Markdown/docs only | `git diff --check` |
| Vue/CSS only | `cd frontend && npm run build` |
| One backend module | Relevant test file, then `npx tsc --noEmit` for edited JS |
| Payment/auth/storage | Relevant tests plus `backend/tests/user-store-isolation.test.ts` |
| Shared backend or cross-layer change | Full backend tests and frontend build |
| Deployment configuration | Full backend tests, frontend build, then production smoke |

Useful commands:

```bash
cd backend
npx tsx --test tests/payments.test.ts
npx tsx --test tests/user-store-isolation.test.ts
npm test

cd ../frontend
npm run build

git diff --check
```

Some route tests open a temporary local port. If a sandbox reports `listen
EPERM`, rerun the same test with local-listen permission instead of changing
application code.

## Deployment

Do not deploy for ordinary local edits unless the user explicitly asks to push
or publish.

Before a production push:

1. Confirm `git status --short` and stage only task files.
2. Run the checks required by the matrix once.
3. Scan staged files for obvious secret patterns.
4. Commit with a scoped message and push the current branch.
5. Confirm Render reaches `live`.
6. Check startup logs for the expected storage and payment providers.
7. Perform a zero-funds smoke test. Never submit a real transfer or mark an
   order paid manually.

## Production Smoke Scope

- Load the homepage.
- Create an isolated guest identity.
- Verify one protected endpoint accepts the guest token.
- For payments, create one pending order and check only provider, currency,
  chain, public address presence, QR presence, and pending status.
- Check one desktop and one mobile viewport only when UI layout changed.

Do not repeat full builds after production smoke unless code changed.

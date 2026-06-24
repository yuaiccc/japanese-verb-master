# Postgres user storage

The application uses a hybrid storage model:

- Local SQLite: dictionary data, FTS, `sqlite-vec`, knowledge chunks, and shared runtime settings.
- Postgres: users, practice records, SRS cards and review logs, agent memory, payment orders, and entitlements.

This keeps the existing local RAG pipeline intact while making account data durable on Render's free web service.

## Supabase

1. Create a Supabase project.
2. Open **Project Settings -> Database -> Connect**.
3. Copy the **Transaction pooler** URI. It normally uses port `6543`.
4. In Render, add the secret environment variable `DATABASE_URL`.
5. Keep `DATABASE_SSL=true` unless the database explicitly does not require TLS.
6. Redeploy the service.

The backend creates the required tables and indexes on startup. Do not expose the connection string to the frontend.

## Neon

Neon's pooled Postgres connection string also works as `DATABASE_URL`; no code changes are required.

## Local fallback

When `DATABASE_URL` is absent, the app continues to use `backend/dictionary.db` for user data. This is convenient for local development, but it is not durable on Render's free web service.

## Current boundary

Agent run traces and shared application settings remain in local SQLite. The account-facing durable data listed above is stored in Postgres.

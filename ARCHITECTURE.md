# Architecture

## Goal

Centralize business rules and sensitive mutations without rewriting the existing database schema.

## Layers

- `lib/core`
  Common constants, date helpers, formatting helpers, route access rules, auth helpers.
- `lib/domain`
  Pure business logic. No Supabase, no React, no fetch.
- `lib/server`
  Server-only env loading, request auth, Supabase admin client, repositories, services.
- `app/api`
  Thin HTTP entrypoints that call `lib/server`.
- `app/*`
  UI only. Pages should fetch or call routes and use pure helpers from `lib/core` / `lib/domain`.

## Current centralized modules

- Salary calculations:
  `lib/domain/salary.ts`
- Admin Supabase access:
  `lib/server/supabase.ts`
- Admin/operator request guards:
  `lib/server/request-auth.ts`
- Shared access map for middleware:
  `lib/core/access.ts`
- Shared login helpers:
  `lib/core/auth.ts`

## Migration rule for next refactors

If a page contains:

- direct `.from('table')` mutations
- repeated date/format helpers
- duplicated calculations
- role checks

move that logic into:

1. `lib/domain` for pure math/rules
2. `lib/server/repositories` for data loading
3. `lib/server/services` for orchestration
4. `app/api` for mutations / secure server entrypoints

# Module Structure

## Goal

The project should be organized by responsibility, not by page size.
Large pages are acceptable temporarily, but the target shape is modular.

## Current Layering

- `app/*`
  UI routes, layouts, and page orchestration.
- `app/api/*`
  Thin server entrypoints for secure mutations and server reads.
- `components/*`
  Shared UI blocks and layout pieces.
- `hooks/*`
  Client-side composition helpers.
- `lib/core/*`
  Shared app rules and utilities.
- `lib/domain/*`
  Pure business rules and calculations.
- `lib/server/*`
  Secure server-side auth, repositories, and services.
- `lib/ai/*`
  Assistant orchestration, snapshots, and site context.

## Target Feature Shape

Each heavy area should gradually move toward this structure:

- route page
- feature components
- feature hooks
- server loader or API handler
- domain calculators
- shared formatting and UI primitives

## Heaviest Current Pages To Split Next

- `app/analysis/page.tsx`
- `app/reports/page.tsx`
- `app/expenses/page.tsx`
- `app/income/page.tsx`
- `app/operator-analytics/page.tsx`

## Refactor Rule

If a page contains two or more of the patterns below, it should be split:

- more than one data source
- repeated transformation logic
- repeated role checks
- repeated chart preparation
- server mutation code
- AI snapshot assembly

## Preferred Split Pattern

For a heavy route:

1. Keep page as orchestration only
2. Move pure calculations to `lib/domain` or local feature helpers
3. Move secure reads and writes to `app/api` plus `lib/server`
4. Move visual sections into `components` or feature-local blocks
5. Keep role checks centralized through shared access helpers

## Current Structural Priority

1. `analysis`
2. `reports`
3. `expenses`
4. `income`
5. operator analytics flows

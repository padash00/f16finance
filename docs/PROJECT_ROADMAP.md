# Project Roadmap

## Current State

The project already has a strong operational base:

- Next.js app router structure with separate admin, operator, and AI flows.
- Centralized route access rules in `lib/core/access.ts`.
- Middleware protection in `proxy.ts`.
- Shared AI assistant layer with page snapshots and server-side enrichment.
- Stable build pipeline through `typecheck`, `lint`, and `build`.

## What Was Recently Strengthened

### AI Platform

- Removed unstable server-action coupling for AI analysis.
- Added shared assistant infrastructure in `lib/ai/*`.
- Added fallback behavior for empty or failed AI responses.
- Localized assistant wording and aligned user-facing AI language.

### Access And Navigation

- Centralized owner access rules.
- Aligned owner navigation with business structure instead of raw technical grouping.
- Preserved hard route protection for restricted areas.

### Reliability

- `npm run typecheck` passes.
- `npm run lint` passes with warnings only.
- `npm run build` passes.

## Priority Roadmap

### Phase 1: Platform Integrity

1. Finish role matrix validation for all personas:
   - super admin
   - owner
   - manager
   - marketer
   - operator
2. Add repeatable smoke scenarios for role-based access.
3. Remove local duplicated permission checks where centralized access helpers should be used instead.

### Phase 2: Quality And Maintainability

1. Reduce lint warnings in large pages and legacy screens.
2. Split oversized page files into feature modules, hooks, and server helpers.
3. Normalize duplicated formatting, chart, and table utilities.

### Phase 3: Release Discipline

1. Enforce CI verification on every push and PR.
2. Run release checklist before production deploys.
3. Add live smoke validation after deployment.

### Phase 4: Product Maturity

1. Expand AI assistant into more guided workflows.
2. Add cross-page insights and navigation recommendations.
3. Add operational dashboards for role-specific priorities.

## Suggested Next Execution Order

1. Role smoke tests and access audit completion.
2. Lint debt cleanup in the heaviest pages.
3. Modularization of `analysis`, `reports`, `expenses`, `income`.
4. Release automation and deployment guardrails.
5. AI workflow expansion.

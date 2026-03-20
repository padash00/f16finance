# Quality System

## Goal

The project needs a repeatable quality loop, not only ad-hoc manual checking.

## Current Quality Baseline

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `.github/workflows/verify.yml`
- `docs/RELEASE_CHECKLIST.md`
- `npm run smoke:live`

## Release Flow

### Before Merge

- review scope against role matrix
- check route protection impact
- verify AI fallback behavior where relevant
- run typecheck, lint, and build

### Before Deploy

- use the release checklist
- review changed routes and APIs
- review environment-sensitive features

### After Deploy

- open main dashboard
- test analysis
- test reports
- test expenses
- test AI assistant
- test owner navigation
- confirm restricted routes still block correctly

## Quality Debt Still Present

- lint warnings remain in legacy and heavy pages
- large route files still combine too many responsibilities
- role smoke tests are not yet fully automated
- AI request quality is not yet logged as a first-class signal

## Next Quality Priorities

1. Reduce warning count in the heaviest pages.
2. Add repeatable role smoke scenarios.
3. Add post-deploy smoke run discipline.
4. Add error and fallback telemetry for AI endpoints.
5. Continue modularization of the largest routes.

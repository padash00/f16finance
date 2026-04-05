# Release Checklist

## Before Merge

1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. Check role-sensitive changes against the role matrix.
5. Confirm AI-related changes have fallback behavior.

## Before Production Deploy

1. Run `npm run verify:release`
2. Review changed routes and APIs.
3. Check that restricted routes are still protected by `proxy.ts`
4. Check environment-dependent features:
   - Supabase
   - OpenAI
   - Telegram
5. Review user-facing text for language consistency.

## After Deploy

1. Open main dashboard
2. Open `analysis`
3. Open `reports`
4. Open `expenses`
5. Test AI assistant request
6. Test owner navigation
7. Confirm forbidden routes still redirect to `/unauthorized`

## Hotspots

- `app/analysis/page.tsx`
- `app/reports/page.tsx`
- `app/expenses/page.tsx`
- `components/sidebar.tsx`
- `lib/core/access.ts`
- `lib/ai/*`

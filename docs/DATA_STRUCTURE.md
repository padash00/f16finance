# Data Structure

## Goal

The project should have a clear distinction between:

- source-of-truth entities
- derived metrics
- reporting aggregates
- AI-ready snapshots

## Core Business Entities

- `company`
  Operational unit or point of business ownership.
- `income`
  Revenue records by date, company, payment type, and context.
- `expense`
  Expense records by date, company, category, operator, and payment split.
- `operator`
  Operational employee profile and work identity.
- `staff`
  Administrative or managerial account identity.
- `shift`
  Scheduled operational work interval and assignment.
- `salary`
  Compensation view, calculation result, and payout context.
- `task`
  Operational or management workflow item.
- `kpi`
  Performance indicators and plans.
- `tax`
  Tax-related calculations and reporting numbers.
- `point-device`
  Device and point-side operational access unit.

## Data Categories

### Source Of Truth

These are records that should come directly from database-backed admin or operator flows:

- incomes
- expenses
- operators
- staff
- shifts
- tasks
- salary rules
- structure assignments

### Derived Data

These are calculated from source data and should not become a second source of truth:

- totals by period
- cashless share
- expense category distribution
- operator productivity metrics
- KPI achievement ratios
- salary projections
- forecast values

### Snapshot Data

Snapshots are safe packaged summaries for AI and analytics screens.
They should be:

- read-only
- generated server-side when possible
- detached from secrets
- explicit about period and route

Current snapshot sources:

- `lib/ai/server-snapshots.ts`
- per-page client snapshot assembly in heavy analytic pages

## Data Rules

1. Mutation should always hit a secured API or server layer.
2. Derived values should be recalculated, not manually edited.
3. AI should never receive raw secrets or unrestricted admin clients.
4. Reporting pages should consume normalized data, not rebuild the same logic repeatedly.

## Data Debt To Reduce

- duplicated chart transformation logic
- duplicated money and date formatting
- repeated page-level aggregation code
- large pages mixing data fetch, transformation, and UI in one file

# Process Map

## Goal

The project should be understood as a set of repeatable business processes.
Pages are only interfaces into those processes.

## Core Business Processes

### 1. Revenue Intake

Flow:

- operator or admin creates income
- income is tied to company, date, and payment type
- reports and analysis include it in totals
- AI uses it in explanation and diagnostics

Key screens:

- `/income`
- `/income/add`
- `/reports`
- `/analysis`

### 2. Expense Control

Flow:

- expense is created
- expense is categorized and assigned
- totals and category distributions are recalculated
- analysis and assistant identify overspend patterns

Key screens:

- `/expenses`
- `/expenses/add`
- `/expenses/analysis`
- `/analysis`

### 3. Team And Salary Management

Flow:

- operator and staff records are maintained
- salary rules are configured
- salary results are reviewed
- management uses analytics and shifts for staffing decisions

Key screens:

- `/staff`
- `/operators`
- `/salary`
- `/salary/rules`
- `/shifts`

### 4. Operational Execution

Flow:

- work is distributed through tasks and shifts
- point devices support point-side activity
- management monitors execution quality

Key screens:

- `/tasks`
- `/shifts`
- `/point-devices`

### 5. Operator Performance Review

Flow:

- operator activity is aggregated
- KPI and behavioral signals are reviewed
- management decisions follow from analytics

Key screens:

- `/operator-analytics`
- `/kpi`
- `/operator-achievements`

### 6. Management Reporting

Flow:

- period is selected
- revenue and expenses are aggregated
- anomalies and trends are highlighted
- AI or management prepares a decision summary

Key screens:

- `/reports`
- `/analysis`
- `/weekly-report`

## Structural Rule

Every new screen should belong to one of these processes.
If it does not clearly belong anywhere, it is usually a sign the feature is not yet framed well enough.

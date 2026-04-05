# Action Matrix

## Goal

Roles answer "who".
The action matrix answers "what exactly they are allowed to do".

## Standard Action Types

Each feature should be evaluated against the same action vocabulary:

- `view`
- `create`
- `edit`
- `delete`
- `approve`
- `assign`
- `export`
- `manage`

## Current Enforcement Layers

- Navigation filtering in `components/sidebar.tsx`
- Route protection in `proxy.ts`
- Capability enforcement in `lib/server/request-auth.ts`
- Role source of truth in `lib/core/access.ts`

## Current Practical Action Groups

### Finance

- view incomes and expenses
- create finance records
- edit finance records
- delete finance records
- export finance views

### Team And Access

- view staff
- manage staff operationally
- manage privileged access
- create staff accounts

### Operators

- view operators
- create and edit operators
- assign operators to companies
- review operator analytics

### Operations

- manage tasks
- manage shifts
- work with point devices

### System

- view logs
- change settings
- run diagnostics
- manage protected integrations

## Target Next Step

The next maturity step is to convert broad role summaries into a true action matrix table:

- feature
- route or API
- action type
- allowed roles
- enforcement layer

That table should become the reference for smoke tests.

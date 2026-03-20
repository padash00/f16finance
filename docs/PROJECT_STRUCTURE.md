# Project Structure

## Purpose

This document is the top-level map of the project structure.
It answers one question: how the project should be organized as a system, not only as a set of pages.

## Structural Layers

The project now has 7 structural axes:

1. Role structure
2. Module structure
3. Data structure
4. Action structure
5. AI structure
6. Business process structure
7. Release and quality structure

## Current Core Sources

- Route and role access: `lib/core/access.ts`
- Route protection: `proxy.ts`
- Shared architecture rules: `ARCHITECTURE.md`
- AI layer: `lib/ai/*`
- Server auth and permissions: `lib/server/request-auth.ts`
- Release verification: `.github/workflows/verify.yml`

## Document Map

- [ROLE_MATRIX.md](./ROLE_MATRIX.md)
  Role visibility, route scope, and enforcement layers.
- [MODULE_STRUCTURE.md](./MODULE_STRUCTURE.md)
  How code should be split into UI, domain, server, and APIs.
- [DATA_STRUCTURE.md](./DATA_STRUCTURE.md)
  Main business entities, source-of-truth rules, and derived data.
- [ACTION_MATRIX.md](./ACTION_MATRIX.md)
  Which action types exist in the system and how they should be enforced.
- [AI_STRUCTURE.md](./AI_STRUCTURE.md)
  How the assistant, snapshots, prompts, and fallbacks are organized.
- [PROCESS_MAP.md](./PROCESS_MAP.md)
  Main end-to-end business flows of the platform.
- [QUALITY_SYSTEM.md](./QUALITY_SYSTEM.md)
  Verification, release discipline, smoke checks, and technical debt control.
- [PROJECT_ROADMAP.md](./PROJECT_ROADMAP.md)
  Delivery order and roadmap.
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)
  Pre-merge, pre-deploy, and post-deploy checks.

## What This Means In Practice

When a new feature is added, it should be checked against all 7 structures:

1. Who sees it
2. Where its code lives
3. Which entities it touches
4. Which actions it enables
5. Whether AI should understand it
6. Which business process it belongs to
7. How it will be verified and deployed

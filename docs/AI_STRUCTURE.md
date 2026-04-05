# AI Structure

## Goal

The AI layer should behave like a safe business assistant, not like a free-form database client.

## Current AI Building Blocks

- `lib/ai/assistant.ts`
  Main orchestration for assistant requests and prompt assembly.
- `lib/ai/server-snapshots.ts`
  Server-side data packaging for reports, analysis, and expenses.
- `lib/ai/site-context.ts`
  Site rules and operating context for the assistant.
- `app/api/ai/assistant/route.ts`
  Safe HTTP entrypoint for the assistant.
- `lib/ai-analysis.ts`
  AI analysis generation with fallback support.
- `app/api/analysis/ai/route.ts`
  Safe analysis endpoint.

## AI Request Flow

1. User opens a page assistant or the global assistant.
2. Client sends page, question, and current page snapshot.
3. Server enriches the request with additional safe snapshots.
4. Prompt is assembled with site rules and context.
5. OpenAI receives only packaged business data.
6. If the model response is weak or empty, fallback logic returns a usable result.

## AI Safety Rules

1. No direct Supabase service key exposure.
2. No unrestricted DB exploration from the client.
3. Use snapshots and server-side enrichment only.
4. Prefer explanation, diagnosis, and next steps over raw text generation.
5. Return graceful fallback text instead of user-facing crashes.

## AI Structural Parts

### Site Context

Describes what the product is, how it should talk, and what it must avoid.

### Snapshots

Provide bounded, route-specific data packages.

### Server Enrichment

Adds safe cross-page or cross-period data when useful.

### Prompt Contracts

Keep answers grounded in facts, business framing, and limits.

### Fallback Layer

Protects the user experience when upstream AI output is poor.

## Next AI Step

The next maturity step is not "more prompts".
It is adding:

- AI request logging
- fallback reason logging
- route-specific answer templates
- quality review for recurring weak questions

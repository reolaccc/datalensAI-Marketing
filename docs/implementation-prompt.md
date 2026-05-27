# Implementation Prompt

Use this prompt before making the next architecture-sensitive changes in DataLens.

## Goal

Inspect the current codebase and propose a safe interface-first plan for tightening the trust boundaries between:

- Executive Insight
- Ask
- Chart selection and chart generation
- Suggested Questions
- LLM narrative layers

Do not begin with a broad refactor.

## Required workflow

1. Start with code inspection only.
2. Identify the current module boundaries and the current data flow between them.
3. Propose a small interface sketch for a shared trusted computed-facts layer.
4. Highlight where the current code duplicates business interpretation across modules.
5. Recommend the smallest safe first step.
6. Wait to implement until the interface direction is explicit.

## Constraints

- Do not redesign the UI.
- Do not add a chatbot agent.
- Do not replace deterministic analytics with LLM logic.
- Do not silently substitute metrics.
- Do not force operations or weak-CRM datasets into attribution semantics.
- Do not change KPI math unless a clear dependency requires it.
- Avoid large cross-cutting rewrites in the first pass.

## Trust rules

- Trust is more important than verbosity.
- Correctness is more important than polish.
- Missing spend, revenue, qualified, converted, or denominator fields must stay missing, not become zero.
- Unavailable or unreliable metrics must produce refusal or caveat behavior, not adjacent-metric answers.
- LLM may rewrite trusted facts, but must not create facts.

## What to inspect

Inspect these areas first:

- `backend/src/services/analysisService.ts`
- `backend/src/analytics/answerQuestion.ts`
- `backend/src/analytics/queryPlanner.ts`
- `backend/src/analytics/queryEngine.ts`
- `backend/src/analytics/kpiCards.ts`
- `backend/src/analytics/semanticContract.ts`
- `backend/src/analytics/normalization/*`
- `backend/src/services/analytics/chart-selection/*`
- `backend/src/services/analytics/chart-config/*`
- `backend/src/analytics/suggestedQuestions.ts`
- `backend/src/llm/insightService.ts`
- `backend/src/llm/prompts.ts`

## Expected output

Produce a short written inspection note with:

1. Current responsibilities of each module
2. Where trusted facts are computed today
3. Where interpretation is duplicated
4. A proposed interface sketch for a shared trusted computed-facts layer
5. A minimal first implementation step
6. Risks to avoid during implementation

## Interface direction to evaluate

Evaluate whether the code should move toward something like:

- `buildTrustedDatasetFacts(...)` for upload-time default facts
- `buildTrustedQuestionFacts(...)` for Ask-specific answer facts
- `buildChartEvidence(...)` that takes trusted facts instead of reinterpreting raw intent independently

This is only an interface direction for discussion, not an instruction to implement immediately.

## Non-goals for the first implementation

- no large semantic-core rewrite
- no new chart families
- no dataset-specific hardcoding
- no broad migration of every call site in one pass

## Success condition

The first implementation step should make future trust-safe refactoring easier without destabilizing working KPI, semantic, or chart behavior.

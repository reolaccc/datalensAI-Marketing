# DataLens Architecture Note

## Purpose

This note describes the current responsibilities and boundaries of the main analytics-facing modules in DataLens:

- Executive Insight
- Ask
- Chart selection and chart generation
- Suggested Questions
- LLM narrative usage

It is intended to help future implementation stay trust-first while the product continues moving toward reliable call-tracking and attribution analytics.

## Product principles

- Trust is more important than verbosity.
- Correctness is more important than flashy AI behavior.
- Graceful fallback is better than fake certainty.
- Unavailable metrics should be explained, not silently substituted.
- Missing spend, revenue, qualified, or denominator fields must not be treated as zero.
- Operations and weak-CRM datasets must not be forced into attribution answers they do not support.

## Current flow

Current high-level flow:

1. Upload dataset
2. Parse rows and profile the dataset
3. Build normalization warnings and Data Summary notes
4. Build semantic contract and dataset capabilities
5. Build KPI candidates and KPI cards
6. Select default dashboard charts
7. Build analytics facts for narrative layers
8. Generate Executive Insight
9. Ask handles user-specific questions separately
10. Ask also selects recommended charts separately

Important current detail:

- Executive Insight and Ask both use `insightService` for wording and narrative shaping.
- Their upstream computed facts are only partially shared today.
- Chart selection is rule-based and deterministic, but not yet fully sourced from the same answer-facts layer as Ask.

## Executive Insight

### Responsibility

Executive Insight should be the default business summary shown after dataset upload.

It should:

- summarize the strongest trusted business signals
- highlight concentration, efficiency, trend, and risk where supported
- avoid acting like a conversational assistant
- avoid inventing new metrics or unsupported claims

It should not:

- behave like free-form Q&A
- answer speculative business questions
- create facts from chart wording alone

### Current design

Current generation path:

- upload analysis runs through `backend/src/services/analysisService.ts`
- default charts are selected
- `buildAnalyticsFactsFromAnalysis(...)` builds narrative facts
- `generateExecutiveInsights(...)` creates the narrative

Current behavior is hybrid:

- deterministic fallback bullets exist
- optional LLM bullets may be used when a provider is enabled
- the final output merges LLM-style bullets with deterministic fallback themes

### Current inputs

Executive Insight currently depends on:

- KPI candidates and KPI cards
- semantic contract and profile metadata
- selected default charts
- chart summaries derived from those charts
- recommended actions and warnings from the analytics facts layer

Important limitation:

- some Executive Insight facts are currently inferred from selected charts rather than from a dedicated canonical facts object

## Ask

### Responsibility

Ask should answer a specific user question using trusted computed facts.

It should:

- parse user intent
- resolve metric and dimension targets
- determine whether the requested question is answerable
- return a direct answer with supporting evidence
- refuse or caveat when trust is insufficient

It should not:

- silently replace the requested metric with a different business concept
- force unsupported datasets into attribution-style answers
- let AI rewrite the meaning of deterministic trust decisions

### Current design

Current Ask path:

- `planQuery(...)`
- `executePlannedQuery(...)`
- separate `selectRuleBasedCharts(...)`
- narrative rewrite through `insightService`

Current behavior is mixed:

- computation is deterministic and rule-based
- wording can be deterministic fallback or optional LLM rewrite

### Current Ask inputs

Ask currently uses:

- semantic contract
- dataset profile
- conversation history
- selected context controls such as metric, dimension, date, and threshold
- deterministic query results
- separate recommended charts

### Current Ask risks

- metric substitution can still happen indirectly when semantic business intent broadens the metric set
- composite ranking can answer a broad business intent even when the requested metric is not cleanly available
- fallback narrative can rewrite unsupported cases too optimistically
- Ask answer facts and Ask recommended charts are not yet guaranteed to come from the exact same computed-facts object

## Chart Selection And Chart Generation

### Responsibility

Charts should act as evidence and explanation aids.

They should:

- visualize trusted facts clearly
- help explain a default summary or a specific Ask answer
- respect trust and reliability rules

They should not:

- become the source of truth for business conclusions
- override deterministic answer logic
- imply support for metrics that were refused upstream

### Current design

Current chart selection is rule-based:

- dataset capability analysis
- intent detection
- candidate generation
- chart data aggregation
- ranking of chart candidates
- fallback to general-overview charts when coverage is thin

Chart data generation already respects several trust rules:

- ratio metrics can return `null`
- invalid ROAS and CPQC groups are filtered or preserved as null appropriately
- aggregated call datasets do not default to row-count call volume

### Current limitation

Charts are still selected through a parallel logic path rather than being generated strictly from the same answer-facts object used by Ask.

That means charts may sometimes feel adjacent to the answer instead of being a direct evidence view of it.

## Suggested Questions

### Responsibility

Suggested Questions should offer safe, capability-aware next steps.

They should:

- reflect what the dataset can support
- prefer trusted commercial follow-ups when the domain is clear
- avoid nudging users into unsupported attribution or efficiency claims

They should not:

- hallucinate unsupported metric paths
- push operations datasets toward marketing questions without evidence
- act as a hidden workaround for unsupported Ask answers

### Current design

Suggested Questions are currently generated from facts and capability heuristics.

They partly depend on:

- semantic contract
- available metrics and dimensions
- chart roles
- Executive Insight suggestions

## LLM Usage

### Current role

LLM usage is currently limited to narrative surfaces:

- Executive Insight wording
- chart explanations
- Ask narrative rewriting

### Allowed role

The safe role for LLM is:

- rewrite trusted computed facts
- explain trusted computed facts
- improve clarity and business readability

### Disallowed role

LLM should not:

- invent metrics
- invent rankings
- invent attribution claims
- infer unsupported causal claims
- override deterministic trust, availability, or null-handling decisions

## Current coupling summary

Current coupling is partial and somewhat uneven:

- Executive Insight depends on KPI and chart-derived facts
- Ask depends on planner and query execution results
- charts are selected from dataset capabilities and intent, not directly from Ask answer facts
- Suggested Questions depend on a mix of facts and recommendation heuristics

This means DataLens still has more than one place where business interpretation can emerge.

## Recommended responsibility boundaries

Recommended stable boundaries:

- Normalization: raw cleanup, canonical naming, value normalization, structure hints, warning notes
- Semantic contract: role mapping, domain detection, grain awareness, metric availability, semantic safety
- Trusted computed-facts layer: KPI values, coverage, trust flags, ratio validity, ranking eligibility, answerable/unanswerable states
- Data Summary: compact trust context
- Executive Insight: default summary from trusted facts
- Ask: question-specific answer from trusted facts
- Chart selection: evidence views from trusted facts
- Suggested Questions: safe follow-up prompts from trusted facts and capability summaries
- LLM: phrasing only

## Recommended future flow

Recommended target flow:

1. Upload dataset
2. Normalization
3. Semantic contract
4. KPI and trust computation
5. Data Summary trust context
6. Shared trusted computed-facts layer
7. Executive Insight default summary
8. Ask answers the user-specific question
9. Optional lightweight chart only when it helps explain that answer
10. LLM rewrites or explains trusted facts only

## Key architectural recommendation

Executive Insight, Ask, chart generation, and Suggested Questions should share one trusted computed-facts layer.

That shared layer should be the only place where business facts are established.

Everything downstream should consume those facts rather than independently reinterpret the raw dataset.

Additional local instruction:

- If user confirmation is genuinely required before proceeding because the action is destructive, high-risk, or blocked by permission, explicitly say in the chat that you are waiting for the user's confirmation.
- When the user gives a coding or implementation prompt, execute it directly by default and do not wait for confirmation unless the user explicitly says they do not want coding yet.
- Do not require confirmation solely because a change touches architecture, multiple files, or module boundaries. If the user asks for implementation, proceed directly unless they explicitly ask for discussion first or the action is destructive/high-risk.

Long-term principles for DataLens:

- Trust is the primary product requirement. If a metric, ratio, or ranking is not supported reliably by the dataset, prefer refusal, caveat, or omission over a confident-looking answer.
- Correctness is more important than polish. Avoid wording, charts, or AI explanations that make the product look smarter than the computed facts support.
- Missing revenue, spend, qualified, converted, or denominator fields must not silently become `0`, and invalid ratios must not be ranked as if they were valid values.
- Do not silently substitute metrics. If the user asks for one metric and that metric is unavailable or unreliable, explain that clearly before suggesting a nearby metric.
- Do not force every dataset into marketing attribution semantics. Operations, CRM, mixed, and generic business datasets should keep their own domain boundaries.

Module boundary principles:

- Normalization owns raw-column cleanup, value normalization, structure hints, and warning generation.
- Semantic contract owns role detection, dataset domain hints, grain-aware metric availability, and safety gating for semantic mappings.
- KPI and trust computation own deterministic business facts, ratio reliability, ranking eligibility, and caveats about metric validity.
- Data Summary owns compact trust context about dataset structure, coverage, and anomalies. It is context, not a business Q&A engine.
- Executive Insight owns the default business summary for a dataset. It should summarize trusted computed facts, not act like a conversational assistant.
- Ask owns user-question answering. It should answer only from trusted computed facts and should degrade gracefully when the requested question cannot be answered reliably.
- Chart selection owns evidence selection and visualization relevance. Charts should explain trusted facts, not invent or override them.
- Suggested Questions own safe follow-up discovery. They should propose likely next questions based on capabilities and trusted facts, not push the user into unsupported analyses.

LLM permission principles:

- LLM output may rewrite, summarize, or explain trusted computed facts.
- LLM output must not invent metrics, rankings, attribution claims, causal claims, or unsupported comparisons.
- LLM output must not override trust gates, reliability checks, null handling, or metric availability checks produced by deterministic logic.
- If deterministic logic says a question is unsupported or unreliable, LLM output must preserve that boundary and may only restate it more clearly.
- Prefer deterministic fallbacks over speculative AI behavior whenever there is any doubt about factual support.

Coupling principles:

- Prefer one shared trusted computed-facts layer consumed by Executive Insight, Ask, chart selection, and Suggested Questions.
- Avoid having multiple modules independently reinterpret the raw dataset to reach separate business conclusions.
- Avoid using chart selection as the source of truth for business facts. Charts should be downstream evidence of computed facts, not the authority that creates them.
- Keep interfaces explicit and narrow. Pass computed facts, trust flags, and capability summaries between modules instead of passing broad raw dataset context unless it is truly needed.

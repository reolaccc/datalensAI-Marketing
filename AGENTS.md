Additional local instruction:

- If user confirmation is genuinely required before proceeding because the action is destructive, high-risk, or blocked by permission, explicitly say in the chat that you are waiting for the user's confirmation.
- When the user gives a coding or implementation prompt, execute it directly by default and do not wait for confirmation unless the user explicitly says they do not want coding yet.
- Do not require confirmation solely because a change touches architecture, multiple files, or module boundaries. If the user asks for implementation, proceed directly unless they explicitly ask for discussion first or the action is destructive/high-risk.

Default safety boundaries:

- Use localhost-only testing by default. Automated QA should target the local frontend/backend dev server unless the user explicitly asks for another environment.
- Do not deploy to Render, production, or any hosted environment unless the user explicitly requests deployment.
- Do not push to GitHub or any remote repository unless the user explicitly requests a push.
- Do not read, print, modify, or regenerate `.env` files, API keys, tokens, or provider secrets.
- Do not change API provider settings unless the user explicitly asks for that configuration change.
- Use test, fixture, synthetic, sandbox, or explicitly provided local datasets for automated QA. Do not use real customer data for automated testing unless the user explicitly provides and authorizes it for that purpose.

Long-term principles for DataLens:

- Trust is the primary product requirement. If a metric, ratio, or ranking is not supported reliably by the dataset, prefer refusal, caveat, or omission over a confident-looking answer.
- Correctness is more important than polish. Avoid wording, charts, or AI explanations that make the product look smarter than the computed facts support.
- Missing revenue, spend, qualified, converted, or denominator fields must not silently become `0`, and invalid ratios must not be ranked as if they were valid values.
- Do not silently substitute metrics. If the user asks for one metric and that metric is unavailable or unreliable, explain that clearly before suggesting a nearby metric.
- Do not force every dataset into marketing attribution semantics. Operations, CRM, mixed, and generic business datasets should keep their own domain boundaries.

Blind QA and Anti-Overfitting Principles:

- Blind QA datasets are used to expose semantic drift, metric substitution, trustworthiness failures, ratio or coverage bugs, domain over-assumption, UI wording problems, and generalization risks. They must not be used to hardcode behavior for one dataset.
- When reporting blind QA results, classify the dataset type: targeted regression stress-test, realistic messy blind dataset, domain transfer dataset, or adversarial / edge-case dataset.
- Separate findings into generalizable findings, dataset-specific findings, overfitting risks, recommended fixes, and what should not be changed.
- Treat highly engineered datasets as regression stress-tests, not proof of real-world generalization.
- Do not hardcode blind QA field names unless the feature is explicitly field-specific.
- Prefer semantic roles, grounding confidence, coverage, and ratio validity over exact column-name rules.
- Reject or redesign fixes that only work because a column has a particular test name, exact schema shape, hardcoded value, or curated blind QA example.
- Do not loosen trust validation just to make one blind QA answer look better.
- Do not broaden domain assumptions because one dataset happens to include revenue, spend, or channel fields.
- Validate important fixes against at least one differently structured dataset when practical.
- Prefer safe partial answers over fake confident answers.

Module boundary principles:

- Normalization owns raw-column cleanup, value normalization, structure hints, and warning generation.
- Semantic contract owns role detection, dataset domain hints, grain-aware metric availability, and safety gating for semantic mappings.
- KPI and trust computation own deterministic business facts, ratio reliability, ranking eligibility, and caveats about metric validity.
- Data Summary owns compact trust context about dataset structure, coverage, and anomalies. It is context, not a business Q&A engine.
- Executive Insight owns the default business summary for a dataset. It should summarize trusted computed facts, not act like a conversational assistant.
- Ask owns user-question answering. It should answer only from trusted computed facts and should degrade gracefully when the requested question cannot be answered reliably.
- Chart selection owns evidence selection and visualization relevance. Charts should explain trusted facts, not invent or override them.
- Suggested Questions own safe follow-up discovery. They should propose likely next questions based on capabilities and trusted facts, not push the user into unsupported analyses.

Executive Insight Principles:

- Executive Insight and Suggested Questions are sibling consumers of trusted facts, grounding context, domain profile, KPI summaries, and chart summaries. Executive Insight must not generate Suggested Questions, rewrite Suggested Questions into insight bullets, or use Suggested Questions as fallback insight filler.
- Preferred flow: trusted facts / grounding / domain profile -> Executive Insight, Suggested Questions, and Ask as separate consumers. Avoid Executive Insight -> Suggested Questions and Suggested Questions -> Executive Insight filler loops.
- Executive Insight must be grounded in computed KPI facts, chart summaries, domain profile, grounding confidence, reliability warnings, and validated semantic signals. It must not invent business conclusions, unsupported causality, optimization advice, or promote weak metrics as strong conclusions.
- LLMs may organize and explain grounded Executive Insight facts, but must not invent unsupported business meaning, choose winners from weak evidence, use external knowledge, or expose unsupported composite scores as public insight.
- Executive Insight must be domain-aware. Do not assume every dataset is performance marketing: call tracking / attribution can use performance marketing framing; operations / support should use operations framing; retail / inventory should use commercial operations framing; energy / solar should use operational or usage framing; generic / unknown should use cautious business analyst framing.
- Avoid campaign optimization language on energy data, budget allocation language on operations data, and ROAS language on generic datasets unless those meanings are strongly grounded.
- Prefer 2-4 strong grounded insights over 6 weak filler bullets. If insight quality is low, show fewer bullets rather than padding with row counts, column counts, obvious chart restatements, generic trend advice, or recommendations without grounded business meaning.
- Keep Data Summary and Executive Insight separated. Data Summary owns row count, column count, date range, missingness, and schema/profile metadata. Executive Insight owns business implications, operational risk, concentration, decision-relevant reliability caveats, and grounded investigation direction.
- Metadata should not leak into Executive Insight unless it directly affects decision confidence.
- Future architecture should move toward a lightweight `ExecutiveInsightFacts` adapter built from trusted KPIs, chart summaries, grounding confidence, trust warnings, domain profile, and validated semantic signals. Avoid raw chart/profile -> direct LLM narrative flows.
- Executive Insight fixes should improve generalized behavior, avoid dataset-specific wording hacks, avoid giant taxonomy systems, and avoid overfitting to synthetic blind QA datasets.

Executive Insight <-> Chart Interaction Principles:

- Existing dashboard chart highlighting is the primary behavior. When a user interacts with an Executive Insight, first try to match and highlight an existing dashboard chart; prefer navigation and highlighting over creating new charts.
- Default flow: Executive Insight -> existing chart highlight. Avoid Executive Insight -> automatically generated dashboard charts.
- Lightweight contextual charts are fallback-only when no suitable dashboard chart exists. They are temporary, contextual support and must not permanently modify the dashboard layout, enter dashboard chart ranking, replace upload-time chart selection, or become part of dashboard orchestration.
- Contextual charts should stay simple: one active contextual chart at a time is preferred, using a simple bar chart, trend line, or comparison chart. Avoid multi-chart dashboards, autonomous chart generation, complex orchestration, or chart flooding.
- Insight-to-chart linkage must be deterministic and grounded. Preferred flow: `ExecutiveInsightFacts` -> grounded metric/dimension -> existing chart match -> highlight -> optional contextual fallback.
- Do not allow hallucinated chart evidence, freeform LLM chart selection, or unsupported metric/dimension chart generation.
- Executive Insight should not directly control dashboard chart ranking, dashboard chart orchestration, or upload-time chart selection. Contextual visualization is a support layer, not a replacement chart system.
- Trustworthiness is more important than visual richness. No chart is better than a misleading chart, especially when grounding is weak, metric/dimension linkage is unclear, relationship evidence is unsupported, or domain interpretation is uncertain.
- Avoid giant chart ontology systems, autonomous chart reasoning agents, and excessive chart lifecycle complexity. Prefer lightweight linkage metadata, deterministic chart matching, and a simple contextual visualization fallback.

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

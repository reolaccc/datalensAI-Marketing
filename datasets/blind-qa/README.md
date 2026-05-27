This folder contains blind QA datasets used to validate trustworthiness, semantic robustness, and graceful fallback behavior across Layer 1-4 analytics logic.

These datasets are for QA and regression testing only.

Do not:
- hardcode semantic mappings based on these files
- tune KPI assumptions specifically to these datasets
- expand channel taxonomies from these examples
- use them as production logic fixtures by default

The goal is generalized trustworthiness testing.

These datasets intentionally include:
- messy field naming
- partial coverage
- missing metrics
- invalid ratio cases
- mixed reliability edge cases

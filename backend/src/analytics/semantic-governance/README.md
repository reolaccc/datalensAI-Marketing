# Semantic Governance

This folder defines the semantic governance model for DataLens.

The rule of thumb is:

- Core semantic layer: reusable analytics primitives only.
- Domain packs: bounded domain wording and safe metric interactions.
- Patch layer: temporary dataset/customer handling only.

What belongs in core:

- trend detection
- concentration analysis
- variance and stability
- ratio safety
- ranking safety
- grouping safety
- grounding validation
- trust calibration

What belongs in domain packs:

- domain wording packs
- domain-safe KPI labels
- domain-safe relationship primitives
- allowed domain metric interactions

What belongs in patches:

- one-off export quirks
- customer-specific aliases
- malformed source handling that is not safely reusable

What does not belong anywhere:

- silent metric substitution
- uncontrolled cross-domain leakage
- blind-QA-only hardcoding in core logic
- giant business ontology growth without budget review

Before adding a rule, evaluate:

1. Is this broadly reusable?
2. Is it only safe inside one domain?
3. Is it really a temporary patch?
4. Does it increase contamination risk?
5. Does it reduce explainability?

If the answer points to domain or dataset scope, do not put it in the core layer.

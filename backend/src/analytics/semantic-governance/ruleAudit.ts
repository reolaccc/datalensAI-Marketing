import type { SemanticGovernanceRule } from "./types.js";

// This inventory is intentionally lightweight. It gives developers one place to
// classify existing semantic logic before adding more rules or aliases.
export const CURRENT_SEMANTIC_RULE_AUDIT: SemanticGovernanceRule[] = [
  {
    id: "core-role-scoring",
    tier: "core_capability",
    summary: "Column name/value scoring for semantic-role inference.",
    rationale: "Reusable deterministic matching logic is a shared capability, not a domain story.",
    currentLocation: "backend/src/analytics/semanticContract.ts",
    contaminationRisk: "medium",
    explainabilityImpact: "positive",
    reuseScope: "broad"
  },
  {
    id: "core-ratio-safety",
    tier: "core_capability",
    summary: "ROAS/CPQC row reliability and denominator safety checks.",
    rationale: "Trust gating belongs in the core layer because every domain needs safe ratio handling.",
    currentLocation: "backend/src/analytics/semanticContract.ts",
    contaminationRisk: "low",
    explainabilityImpact: "positive",
    reuseScope: "broad"
  },
  {
    id: "domain-call-tracking-aliases",
    tier: "domain_pack",
    summary: "Call-tracking and attribution alias families such as channel/source/campaign/call outcome.",
    rationale: "These rules are business-domain-specific and should not define generic business meaning.",
    currentLocation: "backend/src/analytics/semanticContract.ts",
    contaminationRisk: "high",
    explainabilityImpact: "neutral",
    reuseScope: "domain",
    notes: "Currently co-located with core role scoring; this is the main semantic complexity hotspot."
  },
  {
    id: "domain-executive-insight-packs",
    tier: "domain_pack",
    summary: "CRM, retail, energy, operations, and call-tracking wording/relationship primitives.",
    rationale: "These are bounded domain packs that should stay isolated from one another.",
    currentLocation: "backend/src/llm/executiveInsightFacts.ts",
    contaminationRisk: "high",
    explainabilityImpact: "positive",
    reuseScope: "domain"
  },
  {
    id: "patch-dataset-blackout-overfit",
    tier: "temporary_patch",
    summary: "Any future blind-QA-only schema exception or customer export workaround.",
    rationale: "Dataset-specific fixes must remain removable and must not be merged into core routing by default.",
    currentLocation: "not allowed in core modules",
    contaminationRisk: "high",
    explainabilityImpact: "negative",
    reuseScope: "dataset",
    notes: "Current policy is to avoid adding these unless explicitly tagged."
  }
];

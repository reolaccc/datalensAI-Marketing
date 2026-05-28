import type { CoreSemanticCapability } from "./types.js";

// Core capabilities are the reusable, deterministic analytics primitives.
// They answer "what reasoning is safely allowed?" and should not encode
// domain-specific business stories, customer quirks, or temporary schema fixes.
export const CORE_SEMANTIC_CAPABILITIES: CoreSemanticCapability[] = [
  {
    key: "trend_detection",
    summary: "Detect direction, stability, and temporal movement from grounded metrics.",
    allowedOutputs: ["trend direction", "peak/trough movement", "period-over-period change"],
    bannedBehaviors: ["domain-specific optimization advice", "causal attribution"]
  },
  {
    key: "concentration_analysis",
    summary: "Measure narrowness, top-share dominance, and distribution concentration.",
    allowedOutputs: ["top-share concentration", "top-3 contribution", "portfolio narrowness"],
    bannedBehaviors: ["winner narratives without coverage checks"]
  },
  {
    key: "variance_and_stability",
    summary: "Describe spread, strongest/weakest segments, and unevenness.",
    allowedOutputs: ["strongest vs weakest segment", "spread across groups", "stability notes"],
    bannedBehaviors: ["unsupported root-cause claims"]
  },
  {
    key: "missingness_and_coverage",
    summary: "Report whether metrics and dimensions are partially covered or absent.",
    allowedOutputs: ["coverage warnings", "missingness notes", "partial-support caveats"],
    bannedBehaviors: ["silently treating missing values as zero"]
  },
  {
    key: "ratio_safety",
    summary: "Control when ratios are computable, rankable, or only directional.",
    allowedOutputs: ["directional vs decision-grade distinction", "denominator safety checks"],
    bannedBehaviors: ["ranking unsafe ratios", "zero-denominator masking"]
  },
  {
    key: "ranking_safety",
    summary: "Allow rankings only when denominator, coverage, and metric meaning are valid.",
    allowedOutputs: ["safe rankings", "ranking suppressions", "coverage-limited caveats"],
    bannedBehaviors: ["silent metric substitution", "confidence-blind rankings"]
  },
  {
    key: "grouping_safety",
    summary: "Validate that dimensions are fit for comparison and grouping.",
    allowedOutputs: ["group-level comparisons", "grouping suppression when unsafe"],
    bannedBehaviors: ["meaningless segment narratives"]
  },
  {
    key: "trust_calibration",
    summary: "Map evidence quality to directional vs decision-grade confidence.",
    allowedOutputs: ["confidence calibration", "reliability-aware suppression"],
    bannedBehaviors: ["LLM override of deterministic trust gates"]
  },
  {
    key: "grounding_validation",
    summary: "Ensure every public claim remains tied to trusted computed facts.",
    allowedOutputs: ["grounded relationship synthesis", "fact-linked summaries"],
    bannedBehaviors: ["freeform business meaning", "hallucinated metric interactions"]
  }
];

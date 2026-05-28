import type { OntologyBudgetDecision, OntologyBudgetProposal } from "./types.js";

export function evaluateOntologyBudget(proposal: OntologyBudgetProposal): OntologyBudgetDecision {
  const reasons: string[] = [];

  if (proposal.introducesSilentSubstitution) {
    reasons.push("Silent metric substitution is not allowed in the semantic layer.");
    return {
      approved: false,
      decision: "reject",
      reasons
    };
  }

  if (proposal.dependsOnExactDatasetShape) {
    reasons.push("Exact-schema dependence indicates a temporary patch, not reusable semantic logic.");
    return {
      approved: proposal.proposedTier === "temporary_patch",
      decision: proposal.proposedTier === "temporary_patch" ? "mark_as_patch" : "reject",
      reasons
    };
  }

  if (proposal.reuseScope === "dataset") {
    reasons.push("Dataset-scoped behavior belongs in the patch layer.");
    return {
      approved: proposal.proposedTier === "temporary_patch",
      decision: proposal.proposedTier === "temporary_patch" ? "mark_as_patch" : "reject",
      reasons
    };
  }

  if (proposal.contaminationRisk === "high" && proposal.proposedTier === "core_capability") {
    reasons.push("High contamination risk should not be promoted into core capability logic.");
    return {
      approved: false,
      decision: "move_to_domain_pack",
      reasons
    };
  }

  if (proposal.reuseScope === "domain") {
    reasons.push("Domain reuse indicates the rule should live in an isolated domain pack.");
    return {
      approved: proposal.proposedTier === "domain_pack",
      decision: "move_to_domain_pack",
      reasons
    };
  }

  reasons.push("Broadly reusable, explainable behavior is safe for the core semantic layer.");
  return {
    approved: proposal.proposedTier === "core_capability",
    decision: "keep_in_core",
    reasons
  };
}

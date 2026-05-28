export type SemanticRuleTier = "core_capability" | "domain_pack" | "temporary_patch";

export type GovernedSemanticPack =
  | "call_tracking"
  | "crm_pipeline"
  | "retail_inventory"
  | "ops_support"
  | "energy_solar"
  | "generic";

export type SemanticContractDomain =
  | "call_tracking"
  | "call_operations"
  | "marketing_attribution"
  | "mixed_call_tracking_attribution"
  | "generic_business"
  | "unknown";

export type ExecutiveInsightDomain =
  | "call_tracking"
  | "marketing"
  | "operations"
  | "retail"
  | "energy"
  | "crm"
  | "generic";

export interface SemanticGovernanceRule {
  id: string;
  tier: SemanticRuleTier;
  summary: string;
  rationale: string;
  currentLocation: string;
  contaminationRisk: "low" | "medium" | "high";
  explainabilityImpact: "positive" | "neutral" | "negative";
  reuseScope: "broad" | "domain" | "dataset";
  notes?: string;
}

export interface CoreSemanticCapability {
  key: string;
  summary: string;
  allowedOutputs: string[];
  bannedBehaviors: string[];
}

export interface DomainPackDefinition {
  key: GovernedSemanticPack;
  summary: string;
  analystFrame: string;
  supportedDomains: {
    semanticContract?: SemanticContractDomain[];
    executiveInsight?: ExecutiveInsightDomain[];
  };
  safeCapabilities: string[];
  forbiddenLeakage: string[];
  exampleVocabulary: string[];
}

export interface PatchLayerPolicy {
  requiredFields: string[];
  bannedBehaviors: string[];
  removalExpectation: string;
}

export interface OntologyBudgetProposal {
  ruleId: string;
  summary: string;
  proposedTier: SemanticRuleTier;
  reuseScope: "broad" | "domain" | "dataset";
  contaminationRisk: "low" | "medium" | "high";
  explainabilityImpact: "positive" | "neutral" | "negative";
  introducesSilentSubstitution: boolean;
  dependsOnExactDatasetShape: boolean;
}

export interface OntologyBudgetDecision {
  approved: boolean;
  decision: "keep_in_core" | "move_to_domain_pack" | "mark_as_patch" | "reject";
  reasons: string[];
}

import type { DomainPackDefinition, ExecutiveInsightDomain, GovernedSemanticPack, SemanticContractDomain } from "./types.js";

export const DOMAIN_PACKS: Record<GovernedSemanticPack, DomainPackDefinition> = {
  call_tracking: {
    key: "call_tracking",
    summary: "Performance and attribution-safe semantics for call-driven acquisition datasets.",
    analystFrame: "performance marketing analyst",
    supportedDomains: {
      semanticContract: ["call_tracking", "marketing_attribution", "mixed_call_tracking_attribution"],
      executiveInsight: ["call_tracking", "marketing"]
    },
    safeCapabilities: ["channel quality", "missed-call leakage", "attribution concentration", "qualified/conversion quality"],
    forbiddenLeakage: ["pipeline stage narratives", "inventory framing", "solar/load language"],
    exampleVocabulary: ["traffic source", "marketing medium", "qualified calls", "missed calls", "revenue", "coverage"]
  },
  crm_pipeline: {
    key: "crm_pipeline",
    summary: "Pipeline-safe semantics for lead, journey, and closed-won reasoning.",
    analystFrame: "pipeline operations analyst",
    supportedDomains: {
      executiveInsight: ["crm"]
    },
    safeCapabilities: ["lead volume", "journey stage progression", "follow-up pressure", "closed-won outcomes", "pipeline value"],
    forbiddenLeakage: ["missed-call leakage", "campaign mix", "ROAS optimization"],
    exampleVocabulary: ["lead volume", "journey stage", "owner team", "follow-up", "closed-won outcomes", "estimated value"]
  },
  retail_inventory: {
    key: "retail_inventory",
    summary: "Commercial operations semantics for stock, fulfillment, and assortment pressure.",
    analystFrame: "commercial operations analyst",
    supportedDomains: {
      executiveInsight: ["retail"]
    },
    safeCapabilities: ["inventory concentration", "fulfillment cost", "margin pressure", "stockout exposure"],
    forbiddenLeakage: ["campaign performance", "call quality", "grid import/export language"],
    exampleVocabulary: ["warehouse", "category", "fulfilled orders", "fulfillment cost", "margin", "stockout"]
  },
  ops_support: {
    key: "ops_support",
    summary: "Service operations semantics for queues, response pressure, and handling load.",
    analystFrame: "operations analyst",
    supportedDomains: {
      semanticContract: ["call_operations"],
      executiveInsight: ["operations"]
    },
    safeCapabilities: ["service pressure", "queue imbalance", "handling load", "callback backlog"],
    forbiddenLeakage: ["budget allocation", "campaign optimization", "pipeline health"],
    exampleVocabulary: ["service line", "queue", "talk time", "callback", "resolved count", "escalation count"]
  },
  energy_solar: {
    key: "energy_solar",
    summary: "Operational usage semantics for solar generation, load, and grid reliance.",
    analystFrame: "operational usage analyst",
    supportedDomains: {
      executiveInsight: ["energy"]
    },
    safeCapabilities: ["generation vs load", "grid import/export dependence", "site behavior"],
    forbiddenLeakage: ["campaign mix", "acquisition", "pipeline progression"],
    exampleVocabulary: ["solar output", "load", "grid import", "grid export", "site"]
  },
  generic: {
    key: "generic",
    summary: "Cautious fallback semantics when no stronger domain pack is safely grounded.",
    analystFrame: "cautious business analyst",
    supportedDomains: {
      semanticContract: ["generic_business", "unknown"],
      executiveInsight: ["generic"]
    },
    safeCapabilities: ["neutral trend", "neutral concentration", "structural observations", "coverage context"],
    forbiddenLeakage: ["unearned marketing framing", "unearned CRM framing", "unsupported business jargon"],
    exampleVocabulary: ["records", "segment", "observed value", "coverage", "structure"]
  }
};

export function mapSemanticContractDomainToPack(domain?: SemanticContractDomain | null): GovernedSemanticPack {
  if (domain === "call_tracking" || domain === "marketing_attribution" || domain === "mixed_call_tracking_attribution") {
    return "call_tracking";
  }
  if (domain === "call_operations") {
    return "ops_support";
  }
  return "generic";
}

export function mapExecutiveInsightDomainToPack(domain?: ExecutiveInsightDomain | null): GovernedSemanticPack {
  if (domain === "call_tracking" || domain === "marketing") {
    return "call_tracking";
  }
  if (domain === "operations") {
    return "ops_support";
  }
  if (domain === "retail") {
    return "retail_inventory";
  }
  if (domain === "energy") {
    return "energy_solar";
  }
  if (domain === "crm") {
    return "crm_pipeline";
  }
  return "generic";
}

export function getExecutiveAnalystFrame(domain?: ExecutiveInsightDomain | null) {
  return DOMAIN_PACKS[mapExecutiveInsightDomainToPack(domain)].analystFrame as
    | "performance marketing analyst"
    | "operations analyst"
    | "commercial operations analyst"
    | "pipeline operations analyst"
    | "operational usage analyst"
    | "cautious business analyst";
}

export function isKnownGovernedPack(pack: string): pack is GovernedSemanticPack {
  return pack in DOMAIN_PACKS;
}

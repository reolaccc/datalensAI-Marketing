import type { ExecutiveInsightSignal } from "./executiveInsightFacts.js";

function normalize(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function sentenceCase(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function pluralDimension(value: string) {
  const normalized = normalize(value);
  if (!normalized) {
    return "segments";
  }
  if (normalized.endsWith("s")) {
    return normalized;
  }
  if (normalized.endsWith("y") && !/[aeiou]y$/.test(normalized)) {
    return `${normalized.slice(0, -1)}ies`;
  }
  return `${normalized}s`;
}

function analystSubject(signal: ExecutiveInsightSignal) {
  const metric = normalize(signal.metric);
  const evidence = normalize(signal.evidence);
  const text = `${metric} ${evidence}`;

  if (signal.domain === "generic") {
    if (text.includes("observed value") || text.includes("measured result")) {
      return "Measured results";
    }
    return "Observed activity";
  }

  if (signal.domain === "operations") {
    if (text.includes("case count") || text.includes("case volume")) {
      return "Support demand";
    }
    if (text.includes("resolved count") || text.includes("resolved activity")) {
      return "Resolved workload";
    }
    if (text.includes("escalation count") || text.includes("escalation activity")) {
      return "Escalation pressure";
    }
    if (text.includes("reopen")) {
      return "Reopen pressure";
    }
    return "Operational workload";
  }

  if (signal.domain === "crm") {
    if (text.includes("closed-won")) {
      return "Successful outcomes";
    }
    if (text.includes("lead volume")) {
      return "Lead volume";
    }
    if (text.includes("pipeline value") || text.includes("estimated value")) {
      return "Pipeline value";
    }
    return "Pipeline activity";
  }

  if (signal.domain === "retail") {
    if (text.includes("fulfillment cost")) {
      return "Fulfillment cost";
    }
    if (text.includes("fulfilled orders")) {
      return "Fulfilled orders";
    }
    if (text.includes("sales value")) {
      return "Sales value";
    }
    return "Retail activity";
  }

  if (signal.domain === "energy") {
    if (text.includes("solar")) {
      return "Solar output";
    }
    if (text.includes("grid import")) {
      return "Grid import";
    }
    if (text.includes("grid export")) {
      return "Grid export";
    }
    if (text.includes("load")) {
      return "Site load";
    }
    return "Energy usage";
  }

  return sentenceCase(signal.metric);
}

function polishTrendEvidence(evidence: string, signal: ExecutiveInsightSignal) {
  const subject = analystSubject(signal);
  return evidence.replace(/^([^,.]+?) fluctuated across the observed period,/i, `${subject} fluctuated across the observed period,`);
}

function polishDistributionEvidence(evidence: string, signal: ExecutiveInsightSignal) {
  const match = evidence.match(/^Across ([^,]+),\s+(.+?) runs strongest in (.+?) and weakest in (.+?)\.$/i);
  if (!match) {
    return evidence;
  }

  const [, dimension, metric, strongest, weakest] = match;
  const subject = analystSubject({ ...signal, metric });
  const dimensionText = pluralDimension(dimension);

  if (signal.domain === "generic") {
    return `${subject} are strongest in ${strongest} and weakest in ${weakest} across ${dimensionText}.`;
  }

  return `${subject} is highest in ${strongest} and lowest in ${weakest} across ${dimensionText}.`;
}

function polishOutcomeLeaderEvidence(evidence: string, signal: ExecutiveInsightSignal) {
  if (signal.domain !== "crm") {
    return evidence;
  }

  const match = evidence.match(/^(.+?) leads closed-won outcomes with ([\d,.]+), accounting for ([^.]+)\.$/i);
  if (!match) {
    return evidence;
  }

  const [, leader, count, share] = match;
  return `Successful outcomes are concentrated in ${leader}, which accounts for ${count} closed-won outcomes and ${share}.`;
}

function polishConcentrationEvidence(evidence: string, signal: ExecutiveInsightSignal) {
  if (signal.domain === "generic") {
    return evidence.replace(/\bcontributes\b/i, "accounts for");
  }

  if (signal.domain === "crm") {
    return evidence.replace(/\bcontributes\b/i, "accounts for");
  }

  return evidence;
}

function polishImplication(implication: string, signal: ExecutiveInsightSignal) {
  if (signal.domain === "generic") {
    return implication
      .replace(/^Observed value appears/i, "Measured results appear")
      .replace(/\bObserved value\b/g, "Measured results")
      .replace(/\bobservation should stay close to the measured field\b/i, "interpretation should stay close to the measured field");
  }

  if (signal.domain === "operations") {
    return implication.replace(/^That pattern may indicate/i, "The pattern may indicate");
  }

  return implication;
}

export function polishExecutiveSignalForAnalyst(signal: ExecutiveInsightSignal): ExecutiveInsightSignal {
  let evidence = signal.evidence.trim();
  evidence = polishOutcomeLeaderEvidence(evidence, signal);
  evidence = polishDistributionEvidence(evidence, signal);
  evidence = polishTrendEvidence(evidence, signal);
  evidence = polishConcentrationEvidence(evidence, signal);

  return {
    ...signal,
    evidence,
    implication: polishImplication(signal.implication.trim(), signal)
  };
}

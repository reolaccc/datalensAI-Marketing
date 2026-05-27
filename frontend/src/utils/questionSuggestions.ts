import type { AnalysisResponse, SemanticDatasetContract } from "../types";

function uniq(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isDataQualityQuestion(question: string) {
  return /missing values|missing rows|duplicate rows|malformed|suspicious|invalid|anomal|quality|dirty data|outlier/i.test(question);
}

function isVisualLookupQuestion(question: string) {
  const text = normalize(question);
  return (
    (
      /^which\b/.test(text) &&
      /\b(highest|lowest|most|least|biggest|smallest|largest|fewest|best)\b/.test(text)
    ) ||
    /\bdriving the strongest performance\b/.test(text)
  ) &&
    !/\b(risk|reliab|caveat|limitation|inconsistent|imbalance|bottleneck|pressure|review|investigat)\b/.test(text)
  ;
}

function isMarketingDomain(contract: SemanticDatasetContract | null) {
  const domain = contract?.detectedDomain?.domain;
  return domain === "call_tracking" || domain === "marketing_attribution" || domain === "mixed_call_tracking_attribution";
}

function usesUngroundedMarketingLanguage(question: string, analysis: AnalysisResponse) {
  const contract = getSemanticContract(analysis);
  if (isMarketingDomain(contract)) {
    return false;
  }

  return /\b(roas|campaign efficiency|marketing attribution|qualified calls?|qualified call rate|qualified efficiency|cost per qualified|traffic source)\b/i.test(question);
}

function isUnsafeSuggestedQuestion(question: string, analysis: AnalysisResponse) {
  return (
    isVisualLookupQuestion(question) ||
    usesUngroundedMarketingLanguage(question, analysis) ||
    (!isMarketingDomain(getSemanticContract(analysis)) && /\b(spend|spending|budget)\b/i.test(question)) ||
    /\bclearest trade-off between scale and efficiency\b/i.test(question)
  );
}

function getSemanticContract(analysis: AnalysisResponse): SemanticDatasetContract | null {
  return analysis.profile.semanticContract ?? null;
}

function hasDatetime(analysis: AnalysisResponse) {
  return analysis.profile.datetimeColumns.length > 0;
}

function buildDataQualityFallbackQuestions(analysis: AnalysisResponse) {
  const suggestions = [
    `Which dates look malformed or suspicious?`,
    `What rows have the most missing values?`,
    `Are there any duplicate rows in this dataset?`
  ];

  if (!hasDatetime(analysis)) {
    return suggestions.filter((question) => !question.toLowerCase().includes("dates"));
  }

  return suggestions;
}

export function buildQuestionSuggestions(analysis: AnalysisResponse): string[] {
  const backendSuggestions = uniq(analysis.executiveSummary.suggestedQuestions)
    .filter((question) => !isDataQualityQuestion(question))
    .filter((question) => !isUnsafeSuggestedQuestion(question, analysis));
  return backendSuggestions.slice(0, 5);
}

export function buildDataQualityQuestionSuggestions(analysis: AnalysisResponse): string[] {
  const backendSuggestions = uniq(analysis.executiveSummary.suggestedQuestions).filter(isDataQualityQuestion);
  if (backendSuggestions.length > 0) {
    return backendSuggestions;
  }

  return buildDataQualityFallbackQuestions(analysis);
}

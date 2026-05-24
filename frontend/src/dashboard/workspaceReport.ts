import type { AnalysisResponse, PinnedInsight, QuestionAnswer } from "../types";

export interface WorkspaceReportSource {
  fileName: string;
  analysis: AnalysisResponse;
  questionAnswer: QuestionAnswer | null;
  questionHistory: QuestionAnswer[];
  pinnedInsights: PinnedInsight[];
  savedAt?: string;
}

function formatValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  return String(value);
}

function formatSavedAt(savedAt?: string) {
  if (!savedAt) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(savedAt));
}

function sectionDivider() {
  return "\n\n---\n\n";
}

function buildTableMarkdown(columns: string[], rows: Record<string, string | number | boolean | null>[]) {
  if (columns.length === 0 || rows.length === 0) {
    return "_No tabular rows available._";
  }

  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(0, 8)
    .map((row) => `| ${columns.map((column) => formatValue(row[column])).join(" | ")} |`)
    .join("\n");

  return [header, separator, body].join("\n");
}

function buildQuestionEntry(questionAnswer: QuestionAnswer, label: string) {
  const lines = [
    `### ${label}`,
    `**Question:** ${questionAnswer.question}`,
    `**Answer:** ${questionAnswer.answer}`
  ];

  if (questionAnswer.interpretation) {
    lines.push(`**Planner:** ${questionAnswer.interpretation}`);
  }

  if (questionAnswer.supportingData.length > 0) {
    lines.push(
      "**Supporting data:**",
      ...questionAnswer.supportingData.map((entry) => `- ${entry.label}: ${formatValue(entry.value)}`)
    );
  }

  if (questionAnswer.resultTable) {
    lines.push("**Result table:**", buildTableMarkdown(questionAnswer.resultTable.columns, questionAnswer.resultTable.rows));
  }

  if (questionAnswer.chartSuggestion) {
    lines.push(
      `**Chart:** ${questionAnswer.chartSuggestion.chartType} on ${questionAnswer.chartSuggestion.xKey} vs ${questionAnswer.chartSuggestion.yKey}`
    );
  }

  return lines.join("\n");
}

export function buildWorkspaceReportMarkdown(source: WorkspaceReportSource) {
  const savedAt = formatSavedAt(source.savedAt);
  const reportSections = [
    `# DataLens Report`,
    `**Dataset:** ${source.fileName}`,
    savedAt ? `**Saved:** ${savedAt}` : null,
    `**Rows:** ${source.analysis.datasetSummary.rowCount}`,
    `**Columns:** ${source.analysis.datasetSummary.columnCount}`,
    `**Missing cells:** ${source.analysis.profile.missingCells}`,
    `**Duplicates:** ${source.analysis.profile.duplicateRowCount}`,
    `**EDA summary:** ${source.analysis.edaSummary}`,
    sectionDivider(),
    `## Executive summary`,
    `1. ${source.analysis.executiveSummary.overview}`,
    `2. ${source.analysis.executiveSummary.kpiSummary}`,
    `3. ${source.analysis.executiveSummary.anomalySummary}`,
    `4. ${source.analysis.executiveSummary.trendSummary}`,
    `### Suggested analytical questions`,
    ...source.analysis.executiveSummary.suggestedQuestions.map((question) => `- ${question}`),
    sectionDivider(),
    `## KPI candidates`,
    ...source.analysis.kpis.map(
      (kpi) =>
        `- **${kpi.label}** (${kpi.column}): ${kpi.aggregateValue} · ${kpi.summary}`
    ),
    sectionDivider(),
    `## Pinned insights`,
    source.pinnedInsights.length
      ? source.pinnedInsights.map((insight, index) => buildQuestionEntry(insight, `Pinned insight ${index + 1}`)).join("\n\n")
      : "_No pinned insights yet._",
    sectionDivider(),
    `## Recent questions`,
    source.questionAnswer ? buildQuestionEntry(source.questionAnswer, "Latest answer") : "_No recent answer yet._",
    source.questionHistory.length > 0
      ? source.questionHistory
          .map((questionAnswer, index) => buildQuestionEntry(questionAnswer, `Question history ${index + 1}`))
          .join("\n\n")
      : "_No question history yet._"
  ].filter(Boolean);

  return reportSections.join("\n\n");
}

export function downloadWorkspaceReportMarkdown(source: WorkspaceReportSource) {
  const markdown = buildWorkspaceReportMarkdown(source);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  anchor.href = url;
  anchor.download = `${source.fileName.replace(/[^a-z0-9-_]+/gi, "_")}_analytics_report_${timestamp}.md`;
  anchor.click();

  URL.revokeObjectURL(url);
}

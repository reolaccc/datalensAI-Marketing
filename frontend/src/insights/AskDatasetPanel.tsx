import { useEffect, useRef, useState } from "react";
import { useAnalysisStore } from "../stores/analysisStore";
import { buildQuestionSuggestions } from "../utils/questionSuggestions";
import { normalizeDateForQuestionContext } from "../utils/dateNormalization";
import type { QuestionAnswer } from "../types";

function deriveFilterDefaults(analysis: ReturnType<typeof useAnalysisStore.getState>["analysis"]) {
  if (!analysis) {
    return null;
  }

  const firstNumericColumn = analysis.profile.columns.find((column) => column.kind === "numeric");
  const firstCategoricalColumn = analysis.profile.columns.find((column) => column.kind === "categorical");
  const firstKpiColumn = analysis.kpis[0]?.column ?? "";
  const categoryOptions =
    firstCategoricalColumn?.topCategories?.map((entry) => entry.value).filter(Boolean) ?? [];

  return {
    selectedDate: normalizeDateForQuestionContext(
      analysis.profile.columns.find((column) => column.kind === "datetime")?.min
    ) ?? "",
    selectedThreshold: String(firstNumericColumn?.median ?? firstNumericColumn?.mean ?? ""),
    selectedMetric: firstKpiColumn || analysis.profile.numericColumns[0] || "",
    selectedDimension: analysis.profile.categoricalColumns[0] ?? "",
    selectedCategory: categoryOptions[0] ?? "",
    selectedSegmentA: categoryOptions[0] ?? "",
    selectedSegmentB: categoryOptions[1] ?? categoryOptions[0] ?? ""
  };
}

function buildRecentConversationContext(questionHistory: QuestionAnswer[]) {
  return questionHistory.slice(0, 4).map((entry) => ({
    question: entry.question,
    answer: entry.narrative?.directAnswer ?? entry.answer,
    answerSummary: entry.narrative?.directAnswer ?? entry.answer,
    interpretation: entry.interpretation,
    questionContext: entry.questionContext,
    resolvedMetric: entry.detectedIntent?.targetMetrics?.[0] ?? undefined,
    resolvedDimension: entry.detectedIntent?.targetDimensions?.[0] ?? undefined,
    detectedIntent: entry.detectedIntent,
    chartSuggestion: entry.chartSuggestion
      ? {
          chartType: entry.chartSuggestion.chartType,
          xKey: entry.chartSuggestion.xKey,
          yKey: entry.chartSuggestion.yKey,
          series: entry.chartSuggestion.series
        }
      : undefined
  }));
}

function cleanText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

function normalizeEvidenceLine(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildInvestigationChipLabel(question: string) {
  const normalized = question.toLowerCase();
  const keywordPairs: Array<[RegExp, string]> = [
    [/best roas|strongest roas|highest roas/, "Best ROAS"],
    [/best cvr|highest cvr|best conversion rate|most efficiently/, "Best Conversion Rate"],
    [/highest revenue|most revenue|top revenue/, "Most Revenue"],
    [/lowest cpa|lowest cpc|weak return|weak revenue/, "Lowest CPA"],
    [/more budget|budget/, "More Budget"],
    [/trend|drop|increase/, "Trend"],
    [/concentrat|share|mix/, "Concentration"],
    [/compare|comparison/, "Compare"]
  ];

  for (const [pattern, label] of keywordPairs) {
    if (pattern.test(normalized)) {
      return label;
    }
  }

  const words = question
    .replace(/[?.!]/g, "")
    .replace(/^(which|what|where|why|how|is|are|does|do|did)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  const label = words.join(" ");
  return label.length > 26 ? `${label.slice(0, 26).trim()}…` : label;
}

function buildAnswerSections(entry: QuestionAnswer) {
  const directAnswer = cleanText(entry.narrative?.directAnswer) || cleanText(entry.answer);
  const continueInvestigation = [
    ...(entry.suggestedFollowUps ?? []),
    cleanText(entry.narrative?.suggestedNextQuestion)
  ]
    .filter((item): item is string => Boolean(item))
    .filter((line, index, allLines) => allLines.findIndex((candidate) => normalizeEvidenceLine(candidate) === normalizeEvidenceLine(line)) === index)
    .filter((line) => normalizeEvidenceLine(line) !== normalizeEvidenceLine(entry.question))
    .slice(0, 3)
    .map((question) => ({
      question,
      label: buildInvestigationChipLabel(question)
    }));

  return {
    directAnswer,
    continueInvestigation
  };
}

export function AskDatasetPanel() {
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedThreshold, setSelectedThreshold] = useState("");
  const [selectedMetric, setSelectedMetric] = useState("");
  const [selectedDimension, setSelectedDimension] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSegmentA, setSelectedSegmentA] = useState("");
  const [selectedSegmentB, setSelectedSegmentB] = useState("");
  const [askAiEnabled, setAskAiEnabled] = useState(false);
  const [openInvestigations, setOpenInvestigations] = useState<Record<string, boolean>>({});
  const askQuestion = useAnalysisStore((state) => state.askQuestion);
  const asking = useAnalysisStore((state) => state.asking);
  const error = useAnalysisStore((state) => state.error);
  const draftQuestion = useAnalysisStore((state) => state.draftQuestion);
  const questionAnswer = useAnalysisStore((state) => state.questionAnswer);
  const questionHistory = useAnalysisStore((state) => state.questionHistory);
  const setDraftQuestion = useAnalysisStore((state) => state.setDraftQuestion);
  const analysis = useAnalysisStore((state) => state.analysis);
  const questionSuggestions = analysis ? buildQuestionSuggestions(analysis) : [];
  const answerRegionRef = useRef<HTMLDivElement | null>(null);
  const investigationEntries = questionHistory.length > 0 ? questionHistory : questionAnswer ? [questionAnswer] : [];
  const latestInvestigation = investigationEntries[0] ?? null;
  const hasInvestigation = investigationEntries.length > 0;
  const isFinalSubmittedQuestion = Boolean(
    latestInvestigation && !asking && draftQuestion.trim() === latestInvestigation.question.trim()
  );

  useEffect(() => {
    const defaults = deriveFilterDefaults(analysis);
    if (!defaults) {
      return;
    }

    setSelectedDate(defaults.selectedDate);
    setSelectedThreshold(defaults.selectedThreshold);
    setSelectedMetric(defaults.selectedMetric);
    setSelectedDimension(defaults.selectedDimension);
    setSelectedCategory(defaults.selectedCategory);
    setSelectedSegmentA(defaults.selectedSegmentA);
    setSelectedSegmentB(defaults.selectedSegmentB);
  }, [analysis]);

  useEffect(() => {
    if (!latestInvestigation || asking) {
      return;
    }

    const targetElement = answerRegionRef.current;

    const timeoutId = window.setTimeout(() => {
      targetElement?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [asking, latestInvestigation]);

  useEffect(() => {
    setOpenInvestigations((current) => {
      const next: Record<string, boolean> = {};

      for (const [index, entry] of (questionHistory.length > 0 ? questionHistory : questionAnswer ? [questionAnswer] : []).entries()) {
        const key = `${entry.question}::${cleanText(entry.narrative?.directAnswer || entry.answer)}`;
        next[key] = current[key] ?? index === 0;
      }

      return next;
    });
  }, [questionHistory, questionAnswer]);

  async function submitQuestion(questionText: string) {
    const trimmedQuestion = questionText.trim();
    if (!trimmedQuestion) {
      return;
    }

    await askQuestion(trimmedQuestion, {
      selectedDate: selectedDate || undefined,
      selectedThreshold: selectedThreshold ? Number(selectedThreshold) : undefined,
      selectedMetric: selectedMetric || undefined,
      selectedDimension: selectedDimension || undefined,
      selectedCategory: selectedCategory || undefined,
      selectedSegmentA: selectedSegmentA || undefined,
      selectedSegmentB: selectedSegmentB || undefined,
      useAi: askAiEnabled,
      conversationHistory: buildRecentConversationContext(questionHistory)
    });
  }

  async function submitDraftQuestion() {
    await submitQuestion(draftQuestion);
  }

  function handleSuggestionSelect(question: string) {
    void submitQuestion(question);
  }

  function handleQuestionInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void submitDraftQuestion();
  }

  function renderConversationTurn(entry: QuestionAnswer, index: number) {
    const isLatest = index === 0;
    const sections = buildAnswerSections(entry);
    const investigationPreview = sections.directAnswer || entry.answer;
    const investigationKey = `${entry.question}::${investigationPreview}`;
    const isExpanded = openInvestigations[investigationKey] ?? isLatest;

    return (
      <article
        className={`conversation-turn investigation-block ${isLatest ? "conversation-turn-latest" : "conversation-turn-older"}`}
        key={investigationKey}
      >
        <button
          className="investigation-summary"
          type="button"
          aria-expanded={isExpanded}
          onClick={() => {
            setOpenInvestigations((current) => ({
              ...current,
              [investigationKey]: !isExpanded
            }));
          }}
        >
          <div className="investigation-summary-copy">
            <p className="investigation-question">{entry.question}</p>
            <p className="investigation-preview">{investigationPreview}</p>
          </div>
        </button>

        {isExpanded ? (
          <div className="investigation-body">
            <div className="conversation-message conversation-message-user">
              <span className="conversation-role">USER</span>
              <p>{entry.question}</p>
            </div>

            <div className="conversation-message conversation-message-assistant">
              <span className="conversation-role">DATALENS</span>
              <div className="ask-answer-stack">
                <p className="ask-answer-direct">{sections.directAnswer}</p>

                {isLatest && sections.continueInvestigation.length > 0 ? (
                  <div className="continue-investigation-list">
                    {sections.continueInvestigation.map((item) => (
                      <button
                        key={item.question}
                        className="continue-investigation-item"
                        title={item.question}
                        type="button"
                        onClick={() => handleSuggestionSelect(item.question)}
                        disabled={asking}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <section className={`panel ask-panel ${hasInvestigation ? "ask-panel-investigating" : ""}`}>
      <div className="panel-heading">
        <div>
          <h3>Ask about the dataset</h3>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="question-composer">
        {questionSuggestions.length > 0 ? (
          <label className="question-suggestion-field">
            <select
              className="question-suggestion-select"
              aria-label="Suggested business questions"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) {
                  setDraftQuestion(event.target.value);
                  handleSuggestionSelect(event.target.value);
                  event.target.value = "";
                }
              }}
            >
              <option value="" disabled>
                Pick a business question
              </option>
              {questionSuggestions.map((question) => (
                <option key={question} value={question}>
                  {question}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <input
          className={`question-composer-input ${isFinalSubmittedQuestion ? "question-composer-input-final" : "question-composer-input-draft"}`}
          value={draftQuestion}
          onChange={(event) => setDraftQuestion(event.target.value)}
          onKeyDown={handleQuestionInputKeyDown}
        />
        <div className="question-composer-actions">
          <button onClick={submitDraftQuestion} disabled={asking}>
            {asking ? "Thinking..." : "Send Question"}
          </button>
          <button
            aria-checked={askAiEnabled}
            className={`ask-ai-toggle ${askAiEnabled ? "ask-ai-toggle-on" : ""}`}
            onClick={() => setAskAiEnabled((value) => !value)}
            role="switch"
            type="button"
          >
            <span className="ask-ai-toggle-track">
              <span className="ask-ai-toggle-thumb" />
            </span>
            <span>ASK AI</span>
          </button>
        </div>
      </div>

      {!latestInvestigation || asking ? (
        <div className={`ask-status ${asking ? "ask-status-active" : ""}`}>
          {asking ? (
            <p>Analyzing your question and building the answer now.</p>
          ) : (
            <p>Ask a question to generate an answer or table.</p>
          )}
        </div>
      ) : null}

      <div className="ask-workspace">
        <div className="ask-workflow-main">
          {asking && !investigationEntries[0] ? (
            <div className="answer-skeleton" aria-label="Loading answer preview">
              <div className="skeleton-line skeleton-line-lg" />
              <div className="skeleton-line" />
              <div className="skeleton-grid">
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
              </div>
            </div>
          ) : null}

          {investigationEntries.length > 0 ? (
            <div className="conversation-thread" id="analysis-answer-region" ref={answerRegionRef} tabIndex={-1}>
              {investigationEntries.map((entry, index) => renderConversationTurn(entry, index))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

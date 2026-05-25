import { useEffect, useRef, useState } from "react";
import { QuestionChart } from "../charts/QuestionChart";
import { findRelevantChartId } from "../dashboard/chartMatching";
import { useAnalysisStore } from "../stores/analysisStore";
import { buildQuestionSuggestions } from "../utils/questionSuggestions";

function formatDateForInput(value?: string | number | null) {
  if (!value) {
    return "";
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

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
    selectedDate: formatDateForInput(
      analysis.profile.columns.find((column) => column.kind === "datetime")?.min
    ),
    selectedThreshold: String(firstNumericColumn?.median ?? firstNumericColumn?.mean ?? ""),
    selectedMetric: firstKpiColumn || analysis.profile.numericColumns[0] || "",
    selectedDimension: analysis.profile.categoricalColumns[0] ?? "",
    selectedCategory: categoryOptions[0] ?? "",
    selectedSegmentA: categoryOptions[0] ?? "",
    selectedSegmentB: categoryOptions[1] ?? categoryOptions[0] ?? ""
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
  const askQuestion = useAnalysisStore((state) => state.askQuestion);
  const asking = useAnalysisStore((state) => state.asking);
  const error = useAnalysisStore((state) => state.error);
  const draftQuestion = useAnalysisStore((state) => state.draftQuestion);
  const questionAnswer = useAnalysisStore((state) => state.questionAnswer);
  const pinCurrentAnswer = useAnalysisStore((state) => state.pinCurrentAnswer);
  const setDraftQuestion = useAnalysisStore((state) => state.setDraftQuestion);
  const analysis = useAnalysisStore((state) => state.analysis);
  const questionSuggestions = analysis ? buildQuestionSuggestions(analysis) : [];
  const answerRegionRef = useRef<HTMLDivElement | null>(null);
  const answerChartRef = useRef<HTMLDivElement | null>(null);
  const relevantChartId = findRelevantChartId(analysis, questionAnswer);

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
    if (!questionAnswer || asking) {
      return;
    }

    const targetElement =
      (relevantChartId ? document.getElementById(`analysis-chart-${relevantChartId}`) : null) ??
      (questionAnswer.chartSuggestion ? answerChartRef.current : answerRegionRef.current);

    const timeoutId = window.setTimeout(() => {
      targetElement?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [asking, questionAnswer, relevantChartId]);

  async function submitQuestion() {
    if (!draftQuestion.trim()) {
      return;
    }
    await askQuestion(draftQuestion.trim(), {
      selectedDate: selectedDate || undefined,
      selectedThreshold: selectedThreshold ? Number(selectedThreshold) : undefined,
      selectedMetric: selectedMetric || undefined,
      selectedDimension: selectedDimension || undefined,
      selectedCategory: selectedCategory || undefined,
      selectedSegmentA: selectedSegmentA || undefined,
      selectedSegmentB: selectedSegmentB || undefined,
      useAi: askAiEnabled
    });
  }

  return (
    <section className="panel ask-panel">
      <div className="panel-heading">
        <div>
          <h3>Ask about the dataset</h3>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="question-composer">
        <input value={draftQuestion} onChange={(event) => setDraftQuestion(event.target.value)} />
        {questionSuggestions.length > 0 ? (
          <label className="question-suggestion-field">
            <span>Suggested questions</span>
            <select
              aria-label="Suggested business questions"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) {
                  setDraftQuestion(event.target.value);
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
        <div className="question-composer-actions">
          <button onClick={submitQuestion} disabled={asking}>
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

      {!questionAnswer || asking ? (
        <div className={`ask-status ${asking ? "ask-status-active" : ""}`}>
          {asking ? (
            <p>Analyzing your question and building the answer now.</p>
          ) : (
            <p>Ask a question to generate an answer, table, or chart preview.</p>
          )}
        </div>
      ) : null}

      <div className="ask-workspace">
        <div className="ask-workflow-main">
          {asking && !questionAnswer ? (
            <div className="answer-skeleton" aria-label="Loading answer preview">
              <div className="skeleton-line skeleton-line-lg" />
              <div className="skeleton-line" />
              <div className="skeleton-grid">
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
              </div>
              <div className="skeleton-chart" />
            </div>
          ) : null}

          {questionAnswer ? (
            <div className="answer-grid" id="analysis-answer-region" ref={answerRegionRef} tabIndex={-1}>
              <div className="answer-copy">
                <div className="answer-toolbar">
                  <p className="eyebrow">Answer</p>
                  <button className="secondary-action" onClick={pinCurrentAnswer} type="button">
                    Pin to board
                  </button>
                </div>
                <p>{questionAnswer.answer}</p>

                {questionAnswer.narrative ? (
                  <div className="answer-narrative">
                    {questionAnswer.narrative.warning ? <p className="workspace-meta">{questionAnswer.narrative.warning}</p> : null}
                    {questionAnswer.narrative.caution ? <p className="workspace-meta">{questionAnswer.narrative.caution}</p> : null}
                  </div>
                ) : null}

                {questionAnswer.resultTable ? (
                  <div className="result-table-wrap">
                    <table className="result-table">
                      <thead>
                        <tr>
                          {questionAnswer.resultTable.columns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {questionAnswer.resultTable.rows.map((row, index) => (
                          <tr key={index}>
                            {questionAnswer.resultTable?.columns.map((column) => (
                              <td key={`${index}-${column}`}>{String(row[column] ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              {questionAnswer.chartSuggestion ? (
                <div className="answer-chart" ref={answerChartRef} tabIndex={-1}>
                  <div className="chart-suggestion-tag">Relevant to this question</div>
                  <QuestionChart chartSuggestion={questionAnswer.chartSuggestion} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

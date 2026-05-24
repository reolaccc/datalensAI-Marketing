import { useEffect, useRef, useState } from "react";
import { QuestionChart } from "../charts/QuestionChart";
import { findRelevantChartId } from "../dashboard/chartMatching";
import { useAnalysisStore } from "../stores/analysisStore";

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
  const questionHistory = useAnalysisStore((state) => state.questionHistory);
  const pinCurrentAnswer = useAnalysisStore((state) => state.pinCurrentAnswer);
  const setDraftQuestion = useAnalysisStore((state) => state.setDraftQuestion);
  const analysis = useAnalysisStore((state) => state.analysis);
  const answerRegionRef = useRef<HTMLDivElement | null>(null);
  const answerChartRef = useRef<HTMLDivElement | null>(null);
  const latestQuestionAnswer = questionHistory[0] ?? questionAnswer;
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

  function jumpToQuestionResult() {
    const targetElement =
      (relevantChartId ? document.getElementById(`analysis-chart-${relevantChartId}`) : null) ??
      (questionAnswer?.chartSuggestion ? answerChartRef.current : answerRegionRef.current);
    targetElement?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const categoricalColumns = analysis?.profile.categoricalColumns ?? [];
  const numericColumns = analysis?.profile.numericColumns ?? [];
  const categoricalValues = Array.from(
    new Set(
      analysis?.profile.columns
        .filter((column) => column.kind === "categorical")
        .flatMap((column) => column.topCategories?.map((entry) => entry.value) ?? []) ?? []
    )
  );

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
        <div className="question-composer-actions">
          <button onClick={submitQuestion} disabled={asking}>
            {asking ? "Thinking..." : "Ask"}
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

      <div className={`ask-status ${asking ? "ask-status-active" : ""}`}>
        {asking ? (
          <p>Analyzing your question and building the answer now.</p>
        ) : questionAnswer ? (
          <p>
            Latest answer ready: <strong>{questionAnswer.answer}</strong>
          </p>
        ) : (
          <p>Ask a question to generate an answer, table, or chart preview.</p>
        )}
      </div>

      <div className="ask-workspace">
        <div className="ask-workflow-main">
          <details className="advanced-debug-panel">
            <summary>Advanced / Debug</summary>
            <div className="context-grid">
              <label className="date-context-field">
                <span>Selected date context</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </label>

              <label className="date-context-field">
                <span>Selected threshold</span>
                <input
                  type="number"
                  value={selectedThreshold}
                  onChange={(event) => setSelectedThreshold(event.target.value)}
                  placeholder="Enter threshold"
                />
              </label>

              <label className="date-context-field">
                <span>Selected metric</span>
                <input
                  list="metric-options"
                  value={selectedMetric}
                  onChange={(event) => setSelectedMetric(event.target.value)}
                  placeholder="e.g. cost"
                />
                <datalist id="metric-options">
                  {numericColumns.map((column) => (
                    <option key={column} value={column} />
                  ))}
                </datalist>
              </label>

              <label className="date-context-field">
                <span>Selected dimension</span>
                <input
                  list="dimension-options"
                  value={selectedDimension}
                  onChange={(event) => setSelectedDimension(event.target.value)}
                  placeholder="e.g. device"
                />
                <datalist id="dimension-options">
                  {categoricalColumns.map((column) => (
                    <option key={column} value={column} />
                  ))}
                </datalist>
              </label>

              <label className="date-context-field">
                <span>Selected category</span>
                <input
                  list="category-options"
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  placeholder="e.g. Paid Search"
                />
                <datalist id="category-options">
                  {categoricalValues.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>

              <label className="date-context-field">
                <span>Selected segment A</span>
                <input
                  list="segment-options-a"
                  value={selectedSegmentA}
                  onChange={(event) => setSelectedSegmentA(event.target.value)}
                  placeholder="e.g. Desktop"
                />
                <datalist id="segment-options-a">
                  {categoricalValues.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>

              <label className="date-context-field">
                <span>Selected segment B</span>
                <input
                  list="segment-options-b"
                  value={selectedSegmentB}
                  onChange={(event) => setSelectedSegmentB(event.target.value)}
                  placeholder="e.g. Mobile"
                />
                <datalist id="segment-options-b">
                  {categoricalValues.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>
            </div>

            {questionHistory.length > 0 ? (
              <div className="history-row">
                {questionHistory.map((entry) => (
                  <button
                    className="history-chip"
                    key={`${entry.question}-${entry.answer}`}
                    onClick={() => {
                      setDraftQuestion(entry.question);
                    }}
                    type="button"
                  >
                    {entry.question}
                  </button>
                ))}
              </div>
            ) : null}
          </details>

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
                    {questionAnswer.narrative.evidence.length > 0 ? (
                      <div className="support-grid">
                        {questionAnswer.narrative.evidence.map((evidence, index) => (
                          <div className="support-card" key={`${evidence}-${index}`}>
                            <span>Evidence</span>
                            <strong>{evidence}</strong>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {questionAnswer.narrative.caution ? <p className="workspace-meta">{questionAnswer.narrative.caution}</p> : null}
                    {questionAnswer.narrative.suggestedNextQuestion ? (
                      <p className="workspace-meta">Next question: {questionAnswer.narrative.suggestedNextQuestion}</p>
                    ) : null}
                  </div>
                ) : null}

                {questionAnswer.supportingData.length > 0 || questionAnswer.interpretation || questionAnswer.detectedIntent ? (
                  <details className="advanced-debug-panel">
                    <summary>Advanced / Debug</summary>
                    {questionAnswer.interpretation ? <p className="interpretation-text">Planner: {questionAnswer.interpretation}</p> : null}
                    {questionAnswer.detectedIntent ? (
                      <p className="workspace-meta">
                        Intent: {questionAnswer.detectedIntent.primaryIntent.replace(/_/g, " ")}
                      </p>
                    ) : null}
                    <div className="support-grid">
                      {questionAnswer.supportingData.map((item) => (
                        <div className="support-card" key={`${item.label}-${item.value}`}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                  </details>
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

        <aside className="ask-sidebar panel">
          {latestQuestionAnswer ? (
            <div className="sidebar-summary">
              <p className="sidebar-question">{latestQuestionAnswer.question}</p>
              <p className="sidebar-answer">{latestQuestionAnswer.answer}</p>
              <details className="advanced-debug-panel">
                <summary>Advanced / Debug</summary>
                {latestQuestionAnswer.interpretation ? (
                  <p className="workspace-meta">Planner: {latestQuestionAnswer.interpretation}</p>
                ) : null}
                <button className="secondary-action" onClick={jumpToQuestionResult} type="button">
                  Jump to main result
                </button>
                <div className="sidebar-stats">
                  <div>
                    <span>History items</span>
                    <strong>{questionHistory.length}</strong>
                  </div>
                  <div>
                    <span>Has chart</span>
                    <strong>{latestQuestionAnswer.chartSuggestion ? "Yes" : "No"}</strong>
                  </div>
                  <div>
                    <span>Has table</span>
                    <strong>{latestQuestionAnswer.resultTable ? "Yes" : "No"}</strong>
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <div className="sidebar-empty">
              <p>No results yet.</p>
              <small>The latest answer will appear here after you ask a question.</small>
            </div>
          )}
        </aside>
      </div>
      <div className="quick-note">
        The latest answer is pinned to the sidebar once it returns, so you can keep scanning the main board.
      </div>
    </section>
  );
}

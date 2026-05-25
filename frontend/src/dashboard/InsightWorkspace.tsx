import { QuestionChart } from "../charts/QuestionChart";
import { useAnalysisStore } from "../stores/analysisStore";

export function InsightWorkspace() {
  const pinnedInsights = useAnalysisStore((state) => state.pinnedInsights);
  const removePinnedInsight = useAnalysisStore((state) => state.removePinnedInsight);

  if (pinnedInsights.length === 0) {
    return null;
  }

  return (
    <section className="workspace-panel panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Analysis board</p>
          <h3>Pinned insights</h3>
        </div>
        <p>Save high-signal answers from Ask Dataset so the workspace starts to become a narrative, not just a chat.</p>
      </div>

      <div className="workspace-grid">
        {pinnedInsights.map((insight) => (
          <article className="workspace-card" key={insight.id}>
            <div className="workspace-card-header">
              <div>
                <p className="workspace-question">{insight.question}</p>
                {insight.interpretation ? (
                  <p className="workspace-meta">Planner: {insight.interpretation}</p>
                ) : null}
              </div>
              <button
                className="secondary-action"
                onClick={() => removePinnedInsight(insight.id)}
                type="button"
              >
                Remove
              </button>
            </div>

            <p className="workspace-answer">{insight.answer}</p>

            {insight.chartSuggestion ? (
              <div className="workspace-chart">
                <QuestionChart chartSuggestion={insight.chartSuggestion} height={220} />
              </div>
            ) : null}

            {insight.resultTable && insight.resultTable.rows.length <= 3 ? (
              <div className="result-table-wrap">
                <table className="result-table">
                  <thead>
                    <tr>
                      {insight.resultTable.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {insight.resultTable.rows.slice(0, 5).map((row, index) => (
                      <tr key={`${insight.id}-${index}`}>
                        {insight.resultTable?.columns.map((column) => (
                          <td key={`${insight.id}-${index}-${column}`}>{String(row[column] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

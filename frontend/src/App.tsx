import { InsightWorkspace } from "./dashboard/InsightWorkspace";
import { findRelevantChartId } from "./dashboard/chartMatching";
import { KpiCardGrid } from "./dashboard/KpiCardGrid";
import { ChartCard } from "./charts/ChartCard";
import { LeftNav } from "./layout/LeftNav";
import { RightRail } from "./layout/RightRail";
import { TopBar } from "./layout/TopBar";
import { AskDatasetPanel } from "./insights/AskDatasetPanel";
import { useAnalysisStore } from "./stores/analysisStore";
import { useEffect } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export default function App() {
  const analysis = useAnalysisStore((state) => state.analysis);
  const questionAnswer = useAnalysisStore((state) => state.questionAnswer);
  const importSharedWorkspaceSnapshot = useAnalysisStore((state) => state.importSharedWorkspaceSnapshot);
  const highlightedChartId = findRelevantChartId(analysis, questionAnswer);
  const workspaceShellClassName = analysis ? "workspace-shell" : "workspace-shell workspace-shell-empty";

  useEffect(() => {
    const shareId = new URLSearchParams(window.location.search).get("share");
    if (!shareId) {
      return;
    }

    let cancelled = false;

    async function loadSharedWorkspace() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/workspaces/share/${shareId}`);
        if (!response.ok) {
          return;
        }

        const snapshot = (await response.json()) as Parameters<typeof importSharedWorkspaceSnapshot>[0];
        if (!cancelled) {
          importSharedWorkspaceSnapshot(snapshot);
        }
      } catch {
        // Keep the current page usable even if the shared workspace is unavailable.
      }
    }

    void loadSharedWorkspace();

    return () => {
      cancelled = true;
    };
  }, [importSharedWorkspaceSnapshot]);

  return (
    <main className="app-shell">
      <div className="background-orb background-orb-a" />
      <div className="background-orb background-orb-b" />

      <TopBar />

      <div className="analysis-workspace">
        <div className="analysis-workspace-main">
          <div className={workspaceShellClassName}>
            <section className="report-canvas">
              {analysis ? (
                <>
                  <LeftNav />

                  <section className="panel report-page" id="kpi-strip">
                    <KpiCardGrid analysis={analysis} />
                  </section>

                  <section className="panel report-page">
                    <InsightWorkspace />
                  </section>

                  <section className="panel report-page" id="chart-grid">
                    <div className="chart-grid">
                      {analysis.charts.map((chart) => (
                        <ChartCard chart={chart} highlighted={chart.id === highlightedChartId} key={chart.id} />
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <section className="panel report-page empty-state-workspace">
                  <p className="eyebrow">Workflow</p>
                  <ul className="empty-state-steps">
                    <li>Upload dataset</li>
                    <li>Review data profiling and dashboard</li>
                    <li>Ask a question, and DataLens curates the most relevant visualizations to explain the answer and reveal the insight behind your data.</li>
                  </ul>
                </section>
              )}
            </section>
          </div>

          {analysis ? (
            <section className="ask-investigation-section">
              <AskDatasetPanel />
            </section>
          ) : null}
        </div>

        {analysis ? <RightRail analysis={analysis} /> : null}
      </div>
    </main>
  );
}

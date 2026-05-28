import { useAnalysisStore } from "../stores/analysisStore";
import { downloadWorkspaceReportMarkdown } from "../dashboard/workspaceReport";
import { useState } from "react";

export function TopBar() {
  const [dragActive, setDragActive] = useState(false);
  const analysis = useAnalysisStore((state) => state.analysis);
  const fileName = useAnalysisStore((state) => state.fileName);
  const questionAnswer = useAnalysisStore((state) => state.questionAnswer);
  const questionHistory = useAnalysisStore((state) => state.questionHistory);
  const pinnedInsights = useAnalysisStore((state) => state.pinnedInsights);
  const analyzeFile = useAnalysisStore((state) => state.analyzeFile);
  const clearCurrentAnalysis = useAnalysisStore((state) => state.clearCurrentAnalysis);
  const shareCurrentWorkspace = useAnalysisStore((state) => state.shareCurrentWorkspace);
  const loading = useAnalysisStore((state) => state.loading);
  const error = useAnalysisStore((state) => state.error);
  const hasCurrentSession = Boolean(analysis || fileName || error || loading);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      return;
    }

    await analyzeFile(file);
  }

  return (
    <header className="top-bar panel" id="report-overview">
      <div className="top-bar-header">
        <div className="top-bar-title">
          <h1>DataLens</h1>
        </div>
      </div>

      <div className="top-bar-body">
        <div className="upload-hero">
          <p className="workflow-line">
            Data Upload → Data Profiling → Data Cleaning → Semantic Mapping → KPI Detection →
            Dashboard Preview → AI Summary
          </p>

          <label
            className={`dropzone ${dragActive ? "dropzone-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={async (event) => {
              event.preventDefault();
              setDragActive(false);
              await handleFiles(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={async (event) => {
                await handleFiles(event.target.files);
              }}
            />
            <span>{loading ? "Analyzing dataset..." : "Drop file here or browse"}</span>
            <small>{fileName ? `Current file: ${fileName}` : "Supports CSV, XLSX, XLS"}</small>
            <small className="upload-limit-note">
              Demo limit: best with CSV files under 1MB or 3,000–5,000 rows. Larger datasets require sampling or
              upgraded processing.
            </small>
          </label>

          <div className="upload-action-row">
            <div className="top-bar-actions">
              <button
                className="secondary-action"
                disabled={!analysis}
                onClick={() => {
                  if (!analysis) {
                    return;
                  }

                  downloadWorkspaceReportMarkdown({
                    fileName: fileName ?? analysis.fileName,
                    analysis,
                    questionAnswer,
                    questionHistory,
                    pinnedInsights
                  });
                }}
                type="button"
              >
                Export
              </button>
              <button
                className="secondary-action"
                disabled={!analysis}
                onClick={async () => {
                  if (!analysis) {
                    return;
                  }

                  const shareLink = await shareCurrentWorkspace();
                  if (!shareLink) {
                    return;
                  }

                  await navigator.clipboard.writeText(shareLink);
                }}
                type="button"
              >
                Share
              </button>
              <button
                className="secondary-action"
                disabled={!hasCurrentSession}
                onClick={() => clearCurrentAnalysis()}
                type="button"
              >
                Reset Analysis
              </button>
            </div>
            {error && !analysis ? <p className="error-text">{error}</p> : null}
          </div>
        </div>
      </div>
    </header>
  );
}

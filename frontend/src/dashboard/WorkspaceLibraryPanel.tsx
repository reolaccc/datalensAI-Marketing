import { useState } from "react";
import type { WorkspaceSnapshot } from "../types";
import { useAnalysisStore } from "../stores/analysisStore";
import { downloadWorkspaceReportMarkdown } from "./workspaceReport";
import { buildCompactEdaHighlights } from "../utils/edaSummary";

interface Props {
  compact?: boolean;
  showActions?: boolean;
}

function formatSavedAt(savedAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(savedAt));
}

export function WorkspaceLibraryPanel({ compact = false, showActions = true }: Props) {
  const analysis = useAnalysisStore((state) => state.analysis);
  const fileName = useAnalysisStore((state) => state.fileName);
  const activeWorkspaceSnapshotId = useAnalysisStore((state) => state.activeWorkspaceSnapshotId);
  const workspaceSnapshots = useAnalysisStore((state) => state.workspaceSnapshots);
  const recentWorkspaceSnapshotIds = useAnalysisStore((state) => state.recentWorkspaceSnapshotIds);
  const saveCurrentWorkspaceSnapshot = useAnalysisStore((state) => state.saveCurrentWorkspaceSnapshot);
  const openWorkspaceSnapshot = useAnalysisStore((state) => state.openWorkspaceSnapshot);
  const removeWorkspaceSnapshot = useAnalysisStore((state) => state.removeWorkspaceSnapshot);
  const shareCurrentWorkspace = useAnalysisStore((state) => state.shareCurrentWorkspace);
  const questionAnswer = useAnalysisStore((state) => state.questionAnswer);
  const questionHistory = useAnalysisStore((state) => state.questionHistory);
  const pinnedInsights = useAnalysisStore((state) => state.pinnedInsights);
  const [lastSavedSnapshotId, setLastSavedSnapshotId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const recentSnapshots = recentWorkspaceSnapshotIds
    .map((snapshotId) => workspaceSnapshots.find((snapshot) => snapshot.id === snapshotId))
    .filter((snapshot): snapshot is WorkspaceSnapshot => Boolean(snapshot));

  return (
    <section
      className={`panel workspace-library-panel${compact ? " workspace-library-panel-compact" : ""}`}
      id="session-directory"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Workspace library</p>
          <h3>Session directory</h3>
        </div>
        {showActions ? (
          <div className="workspace-library-actions">
            <p className="workspace-library-note">
              Switch between recent analyses, save the current workspace, and export or share what
              you have.
            </p>
            <div className="workspace-library-action-row">
              <button
                className="secondary-action"
                disabled={!analysis}
                onClick={() => {
                  const snapshotId = saveCurrentWorkspaceSnapshot();
                  setLastSavedSnapshotId(snapshotId);
                }}
                type="button"
              >
                Save current workspace
              </button>
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
                    pinnedInsights,
                    savedAt: workspaceSnapshots.find((snapshot) => snapshot.id === activeWorkspaceSnapshotId)?.savedAt
                  });
                }}
                type="button"
              >
                Export report
              </button>
              <button
                className="secondary-action"
                disabled={!analysis || sharing}
                onClick={async () => {
                  if (!analysis) {
                    return;
                  }

                  setSharing(true);
                  setShareMessage(null);

                  try {
                    const shareLink = await shareCurrentWorkspace();
                    if (!shareLink) {
                      return;
                    }

                    await navigator.clipboard.writeText(shareLink);
                    setShareMessage("Share link copied to clipboard.");
                  } catch (error) {
                    setShareMessage(error instanceof Error ? error.message : "Share link failed");
                  } finally {
                    setSharing(false);
                  }
                }}
                type="button"
              >
                {sharing ? "Creating link..." : "Share link"}
              </button>
            </div>
            {shareMessage ? <p className="workspace-library-status">{shareMessage}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="workspace-directory-section">
        <div className="workspace-directory-header">
          <div>
            <p className="eyebrow">Recent open</p>
            <h4>Quick switch</h4>
          </div>
          <p className="workspace-directory-note">
            Jump back into the last workspaces you opened without leaving this page.
          </p>
        </div>

        {recentSnapshots.length === 0 ? (
          <div className="workspace-library-empty">
            <p>No recent workspaces yet. Save or open a workspace to build this history.</p>
          </div>
        ) : (
          <div className="workspace-directory-row">
            {recentSnapshots.map((snapshot) => {
              const isActive = snapshot.id === activeWorkspaceSnapshotId;
              return (
                <article className={`workspace-directory-pill${isActive ? " workspace-directory-pill-active" : ""}`} key={snapshot.id}>
                  <div>
                    <p className="workspace-directory-pill-title">{snapshot.label}</p>
                    <p className="workspace-directory-pill-meta">
                      {snapshot.questionHistory.length} questions · {snapshot.pinnedInsights.length} pins
                    </p>
                  </div>
                  <button className="secondary-action" onClick={() => openWorkspaceSnapshot(snapshot.id)} type="button">
                    {isActive ? "Viewing" : "Open"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className={`workspace-library-body${compact ? " workspace-library-body-compact" : ""}`}>
        {workspaceSnapshots.length === 0 ? (
          <div className="workspace-library-empty">
            <p>
              No saved analyses yet. Once a dataset has been uploaded and explored, save the
              workspace here to keep the dashboard, pins, and question history together.
            </p>
            {lastSavedSnapshotId ? (
              <p className="workspace-library-status">Saved snapshot {lastSavedSnapshotId}</p>
            ) : null}
          </div>
        ) : (
          <div className="workspace-library-grid">
            {workspaceSnapshots.map((snapshot) => {
              const isActive = snapshot.id === activeWorkspaceSnapshotId;
              const edaSummaryBullets = buildCompactEdaHighlights(snapshot.analysis).slice(0, 2);
              return (
                <article
                  className={`workspace-library-card${isActive ? " workspace-library-card-active" : ""}`}
                  key={snapshot.id}
                >
                  <div className="workspace-library-card-header">
                    <div>
                      <p className="workspace-library-title">{snapshot.label}</p>
                      <p className="workspace-library-meta">Saved {formatSavedAt(snapshot.savedAt)}</p>
                    </div>
                    {isActive ? <span className="chart-tag">Active</span> : null}
                  </div>

                  <div className="workspace-library-stats">
                    <div>
                      <span>Questions</span>
                      <strong>{snapshot.questionHistory.length}</strong>
                    </div>
                    <div>
                      <span>Pins</span>
                      <strong>{snapshot.pinnedInsights.length}</strong>
                    </div>
                    <div>
                      <span>Charts</span>
                      <strong>{snapshot.analysis.charts.length}</strong>
                    </div>
                  </div>

                  <ul className="workspace-library-eda-list">
                    {edaSummaryBullets.length > 0 ? (
                      edaSummaryBullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))
                    ) : (
                      <li>No EDA summary available.</li>
                    )}
                  </ul>

                  <div className="workspace-library-actions-row">
                    <button
                      className="secondary-action"
                      onClick={() => openWorkspaceSnapshot(snapshot.id)}
                      type="button"
                    >
                      {isActive ? "Viewing" : "Open"}
                    </button>
                    <button
                      className="secondary-action"
                      onClick={() => removeWorkspaceSnapshot(snapshot.id)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

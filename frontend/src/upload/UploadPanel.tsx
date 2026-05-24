import { useState } from "react";
import { useAnalysisStore } from "../stores/analysisStore";

export function UploadPanel() {
  const [dragActive, setDragActive] = useState(false);
  const analyzeFile = useAnalysisStore((state) => state.analyzeFile);
  const clearCurrentAnalysis = useAnalysisStore((state) => state.clearCurrentAnalysis);
  const loading = useAnalysisStore((state) => state.loading);
  const error = useAnalysisStore((state) => state.error);
  const fileName = useAnalysisStore((state) => state.fileName);
  const analysis = useAnalysisStore((state) => state.analysis);
  const hasCurrentSession = Boolean(analysis || fileName || error || loading);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      return;
    }
    await analyzeFile(file);
  }

  return (
    <section className="panel upload-panel">
      <div>
        <h1>DataLens</h1>
        <p className="lede">
          Upload a CSV or XLSX marketing dataset to generate profiling, KPI candidates,
          chart recommendations, and an executive-ready narrative.
        </p>
      </div>

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
      </label>

      <div className="upload-action-row">
        <button
          className="secondary-action"
          disabled={!hasCurrentSession}
          onClick={() => clearCurrentAnalysis()}
          type="button"
        >
          Clear current data
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

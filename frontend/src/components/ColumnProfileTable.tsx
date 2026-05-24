import type { AnalysisResponse } from "../types";

interface Props {
  analysis: AnalysisResponse;
}

export function ColumnProfileTable({ analysis }: Props) {
  return (
    <article className="panel table-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">EDA profiling</p>
          <h3>Column diagnostics</h3>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Column</th>
              <th>Kind</th>
              <th>Missing</th>
              <th>Unique</th>
              <th>Sample</th>
            </tr>
          </thead>
          <tbody>
            {analysis.profile.columns.map((column) => (
              <tr key={column.name}>
                <td>{column.name}</td>
                <td>{column.kind}</td>
                <td>{column.missingCount}</td>
                <td>{column.uniqueCount}</td>
                <td>{column.sampleValues.map((value) => String(value)).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

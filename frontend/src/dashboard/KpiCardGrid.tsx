import type { AnalysisResponse } from "../types";

interface Props {
  analysis: AnalysisResponse;
}

export function KpiCardGrid({ analysis }: Props) {
  return (
    <section className="kpi-grid">
      {analysis.kpis.slice(0, 4).map((kpi) => (
        <article className="panel kpi-card" key={kpi.id}>
          <p className="eyebrow">{kpi.label}</p>
          <h2>{kpi.aggregateValue.toLocaleString()}</h2>
          <p>{kpi.summary}</p>
        </article>
      ))}
    </section>
  );
}

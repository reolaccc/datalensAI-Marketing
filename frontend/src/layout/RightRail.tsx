import { InsightPanel } from "../insights/InsightPanel";
import type { AnalysisResponse } from "../types";

interface Props {
  analysis: AnalysisResponse | null;
}

export function RightRail({ analysis }: Props) {
  return (
    <aside className="right-rail">
      {analysis ? <InsightPanel analysis={analysis} /> : null}
    </aside>
  );
}

import { InsightPanel } from "../insights/InsightPanel";
import { AskDatasetPanel } from "../insights/AskDatasetPanel";
import type { AnalysisResponse } from "../types";

interface Props {
  analysis: AnalysisResponse | null;
}

export function RightRail({ analysis }: Props) {
  return (
    <aside className="right-rail">
      {analysis ? (
        <>
          <InsightPanel analysis={analysis} />
          <AskDatasetPanel />
        </>
      ) : null}
    </aside>
  );
}

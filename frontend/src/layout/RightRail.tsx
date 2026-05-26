import { InsightPanel } from "../insights/InsightPanel";
import { DatasetSummaryPanel } from "../dashboard/DatasetSummaryPanel";
import type { AnalysisResponse } from "../types";

interface Props {
  analysis: AnalysisResponse | null;
}

export function RightRail({ analysis }: Props) {
  return (
    <aside className="right-rail">
      {analysis ? (
        <>
          <DatasetSummaryPanel analysis={analysis} />
          <InsightPanel analysis={analysis} />
        </>
      ) : null}
    </aside>
  );
}

import type { ChartBlueprint, ChartSelectionContext } from "./chartSelectionTypes.js";

function uniqueBlueprints(blueprints: ChartBlueprint[]) {
  const seen = new Set<string>();
  return blueprints.filter((blueprint) => {
    const key = [
      blueprint.chartType,
      blueprint.metric ?? "",
      blueprint.dimension ?? "",
      blueprint.groupBy ?? "",
      blueprint.secondaryMetric ?? ""
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildFallbackDimension(context: ChartSelectionContext) {
  return context.intent.targetDimensions[0] ?? context.capabilities.defaultDimension;
}

function buildFallbackMetric(context: ChartSelectionContext) {
  const firstRequested = context.intent.targetMetrics[0];
  if (firstRequested) {
    return firstRequested;
  }

  if (context.intent.primaryIntent === "efficiency_analysis") {
    return ["roi", "roas", "conversion_rate", "revenue", "cost"].find((metric) =>
      [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes(metric)
    ) ?? context.capabilities.defaultMetric;
  }

  return context.capabilities.defaultMetric;
}

function createBlueprint(
  input: Omit<ChartBlueprint, "id">
): ChartBlueprint {
  return {
    id: `${input.chartType}-${input.metric ?? "none"}-${input.dimension ?? "none"}-${input.groupBy ?? "none"}`,
    ...input
  };
}

export function generateRuleBasedChartCandidates(context: ChartSelectionContext): ChartBlueprint[] {
  const metric = buildFallbackMetric(context);
  const dimension = buildFallbackDimension(context);
  const dateField = context.capabilities.datetimeFields[0] ?? null;
  const candidates: ChartBlueprint[] = [];
  const secondaryMetric =
    context.capabilities.numericMetrics.find((candidate) => candidate !== metric) ??
    context.capabilities.kpiCandidates.find((candidate) => candidate !== metric) ??
    null;
  const comparisonDimension =
    context.capabilities.comparisonFields.find((candidate) => candidate !== dimension) ??
    context.capabilities.categoricalDimensions[1] ??
    null;

  if (!metric) {
    return [];
  }

  switch (context.intent.primaryIntent) {
    case "trend_analysis":
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `Track how ${metric} changes across time.`,
            reason: `This chart answers the time-based part of the question directly.`,
            whyThisChart: `Trend analysis was detected and ${dateField} is available as a date field.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Compare ${metric} across ${dimension}.`,
            reason: `This supports the trend by showing which segments are strongest or weakest.`,
            whyThisChart: `When trends exist, a segment comparison helps isolate where the change comes from.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 85,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (secondaryMetric && dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "efficiency_analysis",
            title: `${secondaryMetric} trend over time`,
            description: `Review whether ${secondaryMetric} moved alongside ${metric}.`,
            reason: `This helps explain whether the main metric changed with a likely driver metric.`,
            whyThisChart: `A supporting metric trend is useful when users ask why a metric increased or declined.`,
            metric: secondaryMetric,
            xAxis: dateField,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 78,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `See the spread and concentration of ${metric}.`,
          reason: `A distribution view helps separate a gradual trend from a few extreme values.`,
          whyThisChart: `The dashboard adds one diagnostic view so the user can inspect spread and skew.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 72,
          semanticRole: "diagnostic"
        })
      );
      break;
    case "comparison":
    case "segmentation":
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: context.intent.primaryIntent,
            title: `${metric} by ${dimension}`,
            description: `Compare ${metric} across ${dimension}.`,
            reason: `This is the clearest direct comparison for the asked segment.`,
            whyThisChart: `Comparison intent was detected and ${dimension} is the most relevant dimension.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      if (dateField && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "stacked_bar",
            intent: "segmentation",
            title: `${metric} trend by ${dimension}`,
            description: `Track ${metric} over time split by ${dimension}.`,
            reason: `This shows whether the compared segments diverged over time.`,
            whyThisChart: `Time-aware segmentation is useful after a direct comparison view.`,
            metric,
            dimension: dateField,
            groupBy: dimension,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 82,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (comparisonDimension && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "stacked_bar",
            intent: "segmentation",
            title: `${metric} by ${dimension} and ${comparisonDimension}`,
            description: `Break ${metric} down by two segments.`,
            reason: `This reveals whether a second segment explains the comparison result.`,
            whyThisChart: `Segment questions usually benefit from one deeper breakdown.`,
            metric,
            dimension,
            groupBy: comparisonDimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 75,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (secondaryMetric && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "comparison",
            title: `${secondaryMetric} by ${dimension}`,
            description: `Use a supporting metric to validate the segment comparison.`,
            reason: `A second metric adds confidence to the comparison story.`,
            whyThisChart: `The dashboard keeps one supporting comparison so the user sees another angle.`,
            metric: secondaryMetric,
            dimension,
            xAxis: secondaryMetric,
            yAxis: dimension,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 70,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
    case "ranking":
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "ranking",
            title: `${context.question.toLowerCase().includes("worst") || context.question.toLowerCase().includes("bottom") ? "Bottom" : "Top"} ${dimension} by ${metric}`,
            description: `Rank ${dimension} by ${metric}.`,
            reason: `This directly answers which performers are strongest or weakest.`,
            whyThisChart: `Ranking intent was detected, so the main chart is a sorted performer list.`,
            metric,
            dimension,
            xAxis: metric,
            yAxis: dimension,
            sort: context.question.toLowerCase().includes("worst") || context.question.toLowerCase().includes("bottom") ? "asc" : "desc",
            limit: 10,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      if (secondaryMetric && metric) {
        candidates.push(
          createBlueprint({
            chartType: "scatter",
            intent: "correlation",
            title: `${secondaryMetric} vs ${metric}`,
            description: `Check whether the ranking is explained by a second metric.`,
            reason: `A scatter plot helps show whether low performers are also inefficient on another metric.`,
            whyThisChart: `Ranking questions often need one driver view to explain why entities rank where they do.`,
            metric,
            secondaryMetric,
            xAxis: secondaryMetric,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 78,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (dateField && dimension) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `Show whether performance changed steadily or recently.`,
            reason: `A trend view reveals if weak performance is persistent or recent.`,
            whyThisChart: `The rank list is paired with one time trend when a date field exists.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 70,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "bar",
          intent: "comparison",
          title: `${metric} by ${dimension ?? "segment"}`,
          description: `Compare the same metric across the available dimension.`,
          reason: `A broader comparison helps the user see the performer list in context.`,
          whyThisChart: `The dashboard includes one contextual comparison alongside the rank list.`,
          metric,
          dimension,
          xAxis: dimension,
          yAxis: metric,
          limit: 10,
          filters: [],
          priority: 68,
          semanticRole: "diagnostic"
        })
      );
      break;
    case "anomaly_detection":
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "anomaly_trend",
            intent: "anomaly_detection",
            title: `${metric} anomalies over time`,
            description: `Scan for spikes and outlier periods in ${metric}.`,
            reason: `This is the most direct way to inspect anomalous movement over time.`,
            whyThisChart: `An anomaly question with a date field should start with a time-series anomaly view.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `Check whether anomalies are isolated or part of a wide spread.`,
          reason: `A distribution chart shows whether unusual values are rare or common.`,
          whyThisChart: `The dashboard adds one spread view to validate the anomaly signal.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 82,
          semanticRole: "supporting_comparison"
        })
      );
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "ranking",
            title: `${metric} by ${dimension}`,
            description: `Rank likely sources of the anomaly.`,
            reason: `Ranking helps isolate which segment contributes most to the spike or outlier.`,
            whyThisChart: `Anomaly investigations work better when paired with a segment ranking.`,
            metric,
            dimension,
            xAxis: metric,
            yAxis: dimension,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 74,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (secondaryMetric) {
        candidates.push(
          createBlueprint({
            chartType: "scatter",
            intent: "correlation",
            title: `${metric} vs ${secondaryMetric}`,
            description: `Check whether anomalies coincide with a second metric.`,
            reason: `A scatter plot can reveal whether outliers are linked to another field.`,
            whyThisChart: `The dashboard keeps one relationship view for anomaly diagnosis.`,
            metric,
            secondaryMetric,
            xAxis: metric,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 68,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
    case "correlation":
      if (metric && secondaryMetric) {
        candidates.push(
          createBlueprint({
            chartType: "scatter",
            intent: "correlation",
            title: `${metric} vs ${secondaryMetric}`,
            description: `Inspect the relationship between two numeric metrics.`,
            reason: `A scatter plot is the clearest direct relationship view for two metrics.`,
            whyThisChart: `Correlation intent was detected, so the main chart is a metric-vs-metric scatter.`,
            metric,
            secondaryMetric,
            xAxis: metric,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `See whether the relationship changes across time.`,
            reason: `A trend view gives time context for the relationship between metrics.`,
            whyThisChart: `A relationship chart is stronger when paired with one time view.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 72,
            semanticRole: "supporting_comparison"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `Inspect the spread of the primary metric.`,
          reason: `This helps identify whether the relationship is driven by a narrow band or broad spread.`,
          whyThisChart: `The dashboard adds one metric spread view for relationship analysis.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 66,
          semanticRole: "trend_or_distribution"
        })
      );
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Check whether the relationship differs by segment.`,
            reason: `A segment comparison often reveals where a relationship is strongest.`,
            whyThisChart: `One segment comparison broadens the correlation story.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 60,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
    case "distribution":
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `View the spread of ${metric}.`,
          reason: `This is the direct answer for a distribution question.`,
          whyThisChart: `Distribution intent was detected, so the main chart is a histogram-style spread view.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 100,
          semanticRole: "main_answer"
        })
      );
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Compare spread-related outcomes across segments.`,
            reason: `A segment view helps connect the spread to business categories.`,
            whyThisChart: `The dashboard pairs one distribution view with one segment comparison.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 74,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${metric} trend over time`,
            description: `See whether the distribution may be shifting over time.`,
            reason: `A time view helps connect the spread to changing performance.`,
            whyThisChart: `The dashboard adds one trend as a supporting context chart.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 65,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (secondaryMetric) {
        candidates.push(
          createBlueprint({
            chartType: "scatter",
            intent: "correlation",
            title: `${metric} vs ${secondaryMetric}`,
            description: `Check whether the distribution is connected to another metric.`,
            reason: `A scatter plot can show whether the spread is explained by a second variable.`,
            whyThisChart: `A relationship view complements a pure distribution chart.`,
            metric,
            secondaryMetric,
            xAxis: metric,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 60,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
    case "efficiency_analysis":
      candidates.push(
        createBlueprint({
          chartType: dateField ? "line" : "bar",
          intent: "efficiency_analysis",
          title: dateField ? `${metric} trend over time` : `${metric} by ${dimension ?? "segment"}`,
          description: `Show the main efficiency metric in the most relevant structure.`,
          reason: `This directly answers the efficiency metric the user is asking about.`,
          whyThisChart: `Efficiency analysis prefers ROI, ROAS, conversion rate, revenue, or cost first.`,
          metric,
          dimension: dateField ? null : dimension,
          xAxis: dateField ?? dimension,
          yAxis: metric,
          limit: 0,
          filters: [],
          priority: 100,
          semanticRole: "main_answer"
        })
      );
      if ([...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes("revenue") &&
          [...context.capabilities.numericMetrics, ...context.capabilities.derivedMetrics].includes("cost")) {
        candidates.push(
          createBlueprint({
            chartType: "scatter",
            intent: "efficiency_analysis",
            title: "cost vs revenue",
            description: `Check efficiency by comparing cost to revenue directly.`,
            reason: `Cost versus revenue is the most diagnostic supporting view for efficiency questions.`,
            whyThisChart: `Efficiency questions benefit from a direct revenue-versus-cost relationship view.`,
            metric: "cost",
            secondaryMetric: "revenue",
            xAxis: "cost",
            yAxis: "revenue",
            limit: 0,
            filters: [],
            priority: 84,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "horizontal_bar",
            intent: "ranking",
            title: `${metric} by ${dimension}`,
            description: `Rank segments on the chosen efficiency metric.`,
            reason: `A ranking view shows which segments are efficient or inefficient.`,
            whyThisChart: `The dashboard includes one segment ranking for efficiency questions.`,
            metric,
            dimension,
            xAxis: metric,
            yAxis: dimension,
            sort: "desc",
            limit: 10,
            filters: [],
            priority: 76,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      if (dateField && secondaryMetric) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "trend_analysis",
            title: `${secondaryMetric} trend over time`,
            description: `Use a supporting metric trend to explain efficiency shifts.`,
            reason: `A second trend helps separate cost-driven and revenue-driven movement.`,
            whyThisChart: `This chart gives one supporting driver view for the efficiency question.`,
            metric: secondaryMetric,
            xAxis: dateField,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 68,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
    case "data_quality":
      candidates.push(
        createBlueprint({
          chartType: "bar",
          intent: "data_quality",
          title: "Missing values by column",
          description: `Show where missing values are concentrated.`,
          reason: `A missing-value comparison is the clearest first data-quality diagnostic.`,
          whyThisChart: `Data quality intent was detected, so the main chart focuses on missing values.`,
          metric: "missing_count",
          dimension: "column",
          xAxis: "column",
          yAxis: "missing_count",
          limit: 12,
          filters: [],
          priority: 100,
          semanticRole: "main_answer"
        })
      );
      if (metric) {
        candidates.push(
          createBlueprint({
            chartType: "histogram",
            intent: "distribution",
            title: `${metric} distribution`,
            description: `Inspect whether invalid or suspicious values cluster in one metric.`,
            reason: `A metric distribution helps spot suspicious ranges and dirty values.`,
            whyThisChart: `Data quality checks often need one numeric distribution view.`,
            metric,
            xAxis: metric,
            yAxis: "count",
            limit: 0,
            filters: [],
            priority: 74,
            semanticRole: "supporting_comparison"
          })
        );
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `Rows by ${dimension}`,
            description: `Check whether data quality issues cluster inside one segment.`,
            reason: `A segment count view helps show whether dirty data is concentrated in one group.`,
            whyThisChart: `The dashboard adds one segment count view for data quality analysis.`,
            metric: "row_count",
            dimension,
            xAxis: dimension,
            yAxis: "row_count",
            limit: 10,
            filters: [],
            priority: 62,
            semanticRole: "trend_or_distribution"
          })
        );
      }
      break;
    case "funnel_analysis":
      if (context.capabilities.funnelStageFields[0] && metric) {
        candidates.push(
          createBlueprint({
            chartType: "funnel",
            intent: "funnel_analysis",
            title: `${metric} funnel by ${context.capabilities.funnelStageFields[0]}`,
            description: `Use funnel stages when they exist in the dataset.`,
            reason: `This chart is the closest direct answer for a funnel question.`,
            whyThisChart: `A stage-like field was detected, so the dashboard can attempt a funnel view.`,
            metric,
            dimension: context.capabilities.funnelStageFields[0],
            xAxis: context.capabilities.funnelStageFields[0],
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 100,
            semanticRole: "main_answer"
          })
        );
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "comparison",
            title: `${metric} by ${dimension}`,
            description: `Fallback funnel comparison when stage fields are incomplete.`,
            reason: `If funnel stages are limited, a segment bar chart is the closest stable replacement.`,
            whyThisChart: `The dashboard always keeps a valid fallback chart for funnel questions.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 76,
            semanticRole: "supporting_comparison"
          })
        );
      }
      break;
    case "general_overview":
    default:
      if (dateField) {
        candidates.push(
          createBlueprint({
            chartType: "line",
            intent: "general_overview",
            title: `${metric} trend over time`,
            description: `Show the primary KPI across time.`,
            reason: `A trend chart gives the fastest high-level read of performance.`,
            whyThisChart: `General overview starts with the strongest KPI and the first date field.`,
            metric,
            xAxis: dateField,
            yAxis: metric,
            limit: 0,
            filters: [],
            priority: 95,
            semanticRole: "main_answer"
          })
        );
      }
      if (dimension) {
        candidates.push(
          createBlueprint({
            chartType: "bar",
            intent: "general_overview",
            title: `${metric} by ${dimension}`,
            description: `Compare the strongest KPI across the leading dimension.`,
            reason: `This gives a fast segment breakdown of the main KPI.`,
            whyThisChart: `A high-level dashboard should include at least one segment comparison.`,
            metric,
            dimension,
            xAxis: dimension,
            yAxis: metric,
            limit: 10,
            filters: [],
            priority: 85,
            semanticRole: "supporting_comparison"
          })
        );
      }
      candidates.push(
        createBlueprint({
          chartType: "histogram",
          intent: "distribution",
          title: `${metric} distribution`,
          description: `Inspect the spread of the main KPI.`,
          reason: `A distribution view adds diagnostic context to the overview.`,
          whyThisChart: `The overview includes one spread chart to spot skew and outliers.`,
          metric,
          xAxis: metric,
          yAxis: "count",
          limit: 0,
          filters: [],
          priority: 72,
          semanticRole: "trend_or_distribution"
        })
      );
      if (secondaryMetric) {
        candidates.push(
          createBlueprint({
            chartType: "scatter",
            intent: "correlation",
            title: `${metric} vs ${secondaryMetric}`,
            description: `Inspect a likely relationship between the top metrics.`,
            reason: `A relationship chart rounds out the overview with a diagnostic angle.`,
            whyThisChart: `The dashboard closes with one relationship chart when two metrics are available.`,
            metric,
            secondaryMetric,
            xAxis: metric,
            yAxis: secondaryMetric,
            limit: 0,
            filters: [],
            priority: 66,
            semanticRole: "diagnostic"
          })
        );
      }
      break;
  }

  return uniqueBlueprints(candidates);
}

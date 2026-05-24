import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerDatasetQuestion } from "../src/analytics/answerQuestion.js";
import type { QuestionAnswer, QuestionContextInput } from "../src/analytics/types.js";
import { parseDataset } from "../src/profiling/datasetParser.js";
import { profileDataset } from "../src/profiling/profileDataset.js";
import { parseNumber } from "../src/utils/inference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, "../../..");

async function loadDataset(fileName: string) {
  const datasetPath = path.join(rootDirectory, "datasets", fileName);
  const buffer = await readFile(datasetPath);
  const parsed = parseDataset(buffer, fileName);
  const profile = profileDataset(parsed.rows);
  return { parsed, profile };
}

function uniqueStringValues(values: Array<string | number | boolean | null>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

function aggregateBy(
  rows: Array<Record<string, string | number | boolean | null>>,
  dimension: string,
  metric: string
) {
  const grouped = new Map<string, number>();

  for (const row of rows) {
    const key = row[dimension];
    const value = parseNumber(row[metric]);
    if (typeof key !== "string" || value === null) {
      continue;
    }
    grouped.set(key, (grouped.get(key) ?? 0) + value);
  }

  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function aggregateByOperation(
  rows: Array<Record<string, string | number | boolean | null>>,
  dimension: string,
  metric: string,
  operation: "sum" | "average" | "min" | "max",
  sortDirection: "asc" | "desc" = "desc"
) {
  const grouped = new Map<string, number[]>();

  for (const row of rows) {
    const key = row[dimension];
    const value = parseNumber(row[metric]);
    if (typeof key !== "string" || value === null) {
      continue;
    }
    const current = grouped.get(key) ?? [];
    current.push(value);
    grouped.set(key, current);
  }

  const aggregated = [...grouped.entries()].map(([label, values]) => {
    let value = 0;
    if (operation === "average") {
      value = values.reduce((sum, item) => sum + item, 0) / values.length;
    } else if (operation === "min") {
      value = Math.min(...values);
    } else if (operation === "max") {
      value = Math.max(...values);
    } else {
      value = values.reduce((sum, item) => sum + item, 0);
    }

    return { label, value };
  });

  return aggregated.sort((left, right) =>
    sortDirection === "asc" ? left.value - right.value : right.value - left.value
  );
}

function sortedNumericValues(
  rows: Array<Record<string, string | number | boolean | null>>,
  column: string
) {
  return rows
    .map((row) => parseNumber(row[column]))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
}

async function runQuestionCase(
  fileName: string,
  question: string,
  expectedSnippets: string[],
  input?: QuestionContextInput,
  verify?: (result: QuestionAnswer) => boolean
) {
  const { parsed, profile } = await loadDataset(fileName);
  const result = answerDatasetQuestion(question, {
    rows: parsed.rows,
    profile,
    input
  });

  const snippetPass = expectedSnippets.every((snippet) =>
    result.answer.toLowerCase().includes(snippet.toLowerCase())
  );
  const structuredPass = verify ? verify(result) : true;
  const passed = snippetPass && structuredPass;

  console.log(`${passed ? "PASS" : "FAIL"} question: ${question}`);
  console.log(`  answer: ${result.answer}`);

  if (!passed) {
    process.exitCode = 1;
  }
}

async function main() {
  const { parsed: cleanDataset } = await loadDataset("marketing_clean.csv");
  const cleanRows = cleanDataset.rows;
  const cleanDates = uniqueStringValues(cleanRows.map((row) => row.date)).sort();
  const selectedDate = cleanDates[2];
  const firstDate = cleanDates[0];

  const devices = uniqueStringValues(cleanRows.map((row) => row.device)).sort();
  const firstDevice = devices[0];
  const secondDevice = devices[1];

  const channels = aggregateBy(cleanRows, "channel", "revenue");
  const topChannel = channels[0]?.label ?? "";
  const averageCostByChannel = aggregateByOperation(cleanRows, "channel", "cost", "average");
  const highestAverageCostChannel = averageCostByChannel[0]?.label ?? "";
  const revenueAndCostByChannel = aggregateByOperation(cleanRows, "channel", "revenue", "sum");
  const topRevenueChannel = revenueAndCostByChannel[0]?.label ?? "";

  const campaigns = aggregateBy(cleanRows, "campaign", "revenue");
  const topCampaign = campaigns[0]?.label ?? "";

  const channelFilterRows = cleanRows.filter((row) => row.channel === cleanRows[0]?.channel);
  const filteredTrendChannel = String(cleanRows[0]?.channel ?? "");

  const costValues = sortedNumericValues(cleanRows, "cost");
  const threshold = costValues[Math.max(0, Math.floor(costValues.length / 2))];

  const filteredCampaignRows = cleanRows.filter((row) => {
    const cost = parseNumber(row.cost);
    return cost !== null && cost > threshold;
  });
  const topCampaignAboveThreshold = aggregateBy(filteredCampaignRows, "campaign", "revenue")[0]?.label ?? "";

  const afterDateRows = cleanRows.filter(
    (row) => typeof row.date === "string" && row.date > selectedDate
  );
  const topCampaignAfterDate = aggregateBy(afterDateRows, "campaign", "revenue")[0]?.label ?? "";

  const firstDeviceValueRows = cleanRows.filter((row) => row.device === firstDevice);
  const topChannelForFirstDevice =
    aggregateBy(firstDeviceValueRows, "channel", "revenue")[0]?.label ?? "";

  const paidCategoryName = String(cleanRows[2]?.channel ?? "");
  const compareWithinCategoryRows = cleanRows.filter((row) => row.channel === paidCategoryName);
  const deviceLeadersWithinCategory = aggregateBy(compareWithinCategoryRows, "device", "revenue");
  const leadingDeviceWithinCategory = deviceLeadersWithinCategory[0]?.label ?? "";
  const trailingDeviceWithinCategory =
    deviceLeadersWithinCategory[deviceLeadersWithinCategory.length - 1]?.label ?? "";

  const deviceLeadersAfterDate = aggregateBy(afterDateRows, "device", "revenue");
  const leadingDeviceAfterDate = deviceLeadersAfterDate[0]?.label ?? "";
  const trailingDeviceAfterDate =
    deviceLeadersAfterDate[deviceLeadersAfterDate.length - 1]?.label ?? "";

  const averageConversionRateByDevice = aggregateByOperation(
    cleanRows,
    "device",
    "conversion_rate",
    "average",
    "asc"
  );
  const lowestAverageConversionDevice = averageConversionRateByDevice[0]?.label ?? "";
  const revenueByDevice = aggregateByOperation(cleanRows, "device", "revenue", "sum");
  const deviceTrendSeries = revenueByDevice.slice(0, 2).map((entry) => entry.label);

  const topCampaignsByAverageCostAfterDate = aggregateByOperation(
    afterDateRows,
    "campaign",
    "cost",
    "average"
  );
  const highestAverageCostCampaignAfterDate =
    topCampaignsByAverageCostAfterDate[0]?.label ?? "";

  const topCampaignsByRevenueAndCostAfterDate = aggregateByOperation(
    afterDateRows,
    "campaign",
    "revenue",
    "sum"
  );
  const topRevenueCampaignAfterDate = topCampaignsByRevenueAndCostAfterDate[0]?.label ?? "";

  const aggregateByDeviceWithinCategory = aggregateByOperation(
    compareWithinCategoryRows,
    "device",
    "revenue",
    "sum"
  );
  const topDeviceWithinCategoryByRevenue = aggregateByDeviceWithinCategory[0]?.label ?? "";

  const { profile: outlierProfile } = await loadDataset("marketing_outliers.csv");
  const topOutlierColumn = outlierProfile.outliers[0]?.column ?? "";

  await runQuestionCase("marketing_clean.csv", "Which channel has the highest revenue?", [
    topChannel,
    "revenue"
  ]);
  await runQuestionCase("marketing_clean.csv", "Show the revenue trend over time", [
    "trend",
    firstDate
  ]);
  await runQuestionCase(
    "marketing_clean.csv",
    "Show revenue and customer defined metric trend over time",
    ["trend", firstDate, "cost"],
    {
      selectedMetric: "cost"
    },
    (result) => {
      const columns = result.resultTable?.columns ?? [];
      const series = result.chartSuggestion?.series ?? [];
      return (
        result.chartSuggestion?.chartType === "line" &&
        columns.join("|") === "date|revenue|cost" &&
        series.join("|") === "revenue|cost"
      );
    }
  );
  await runQuestionCase(`marketing_clean.csv`, `Show the revenue trend for ${filteredTrendChannel}`, [
    "trend",
    firstDate,
    `channel=${filteredTrendChannel}`
  ]);
  await runQuestionCase(
    "marketing_clean.csv",
    "Top 3 campaigns by revenue after customer defined date",
    [topCampaignAfterDate, `date after ${selectedDate}`],
    { selectedDate }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Which campaign has the highest revenue where cost above customer defined threshold?",
    [topCampaignAboveThreshold, `cost gt ${threshold}`],
    { selectedThreshold: threshold }
  );
  await runQuestionCase(`marketing_clean.csv`, `Top 3 campaigns by revenue after ${selectedDate}`, [
    topCampaignAfterDate,
    `date after ${selectedDate}`
  ]);
  await runQuestionCase("marketing_clean.csv", "Top 3 campaigns by revenue", [
    topCampaign,
    "revenue"
  ]);
  await runQuestionCase("marketing_clean.csv", "Average cost by channel", [
    highestAverageCostChannel,
    "average cost"
  ]);
  await runQuestionCase("marketing_clean.csv", "Revenue and cost by channel", [
    topRevenueChannel,
    "revenue",
    "cost"
  ], undefined, (result) => {
    const columns = result.resultTable?.columns ?? [];
    const series = result.chartSuggestion?.series ?? [];
    return (
      columns.join("|") === "channel|revenue|cost" &&
      series.join("|") === "revenue|cost"
    );
  });
  await runQuestionCase(
    "marketing_clean.csv",
    "Top 2 campaigns by revenue and cost after customer defined date",
    [topRevenueCampaignAfterDate, `date after ${selectedDate}`, "revenue", "cost"],
    { selectedDate },
    (result) => {
      const columns = result.resultTable?.columns ?? [];
      const rows = result.resultTable?.rows ?? [];
      const series = result.chartSuggestion?.series ?? [];
      return (
        columns.join("|") === "campaign|revenue|cost" &&
        rows.length === 2 &&
        String(rows[0]?.campaign ?? "") === topRevenueCampaignAfterDate &&
        series.join("|") === "revenue|cost"
      );
    }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Average revenue and customer defined metric by customer defined dimension within customer defined category",
    [paidCategoryName, "average revenue", "cost"],
    {
      selectedMetric: "cost",
      selectedDimension: "device",
      selectedCategory: paidCategoryName
    },
    (result) => {
      const columns = result.resultTable?.columns ?? [];
      const series = result.chartSuggestion?.series ?? [];
      return (
        columns.join("|") === "device|revenue|cost" &&
        series.join("|") === "revenue|cost"
      );
    }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Revenue and customer defined metric by customer defined dimension",
    [topRevenueChannel, "revenue", "cost"],
    {
      selectedMetric: "cost",
      selectedDimension: "channel"
    },
    (result) => {
      const columns = result.resultTable?.columns ?? [];
      const series = result.chartSuggestion?.series ?? [];
      return (
        columns.join("|") === "channel|revenue|cost" &&
        series.join("|") === "revenue|cost"
      );
    }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Average customer defined metric by customer defined dimension",
    [highestAverageCostChannel, "average cost"],
    {
      selectedMetric: "cost",
      selectedDimension: "channel"
    }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Top 2 campaigns by average cost after customer defined date",
    [highestAverageCostCampaignAfterDate, `date after ${selectedDate}`, "average cost"],
    { selectedDate }
  );
  await runQuestionCase("marketing_clean.csv", "Sum revenue by campaign", [
    topCampaign,
    "sum revenue"
  ]);
  await runQuestionCase(
    "marketing_clean.csv",
    "Top 2 customer defined dimension by customer defined metric within customer defined category",
    [topDeviceWithinCategoryByRevenue, paidCategoryName, "revenue"],
    {
      selectedMetric: "revenue",
      selectedDimension: "device",
      selectedCategory: paidCategoryName
    }
  );
  await runQuestionCase("marketing_clean.csv", "Lowest conversion rate by device", [
    lowestAverageConversionDevice,
    "average conversion rate"
  ]);
  await runQuestionCase(
    "marketing_clean.csv",
    `Which campaign has the highest revenue where cost > ${threshold}?`,
    [topCampaignAboveThreshold, `cost gt ${threshold}`]
  );
  await runQuestionCase(`marketing_clean.csv`, `Which channel has the highest revenue for ${firstDevice}?`, [
    topChannelForFirstDevice,
    `within device=${firstDevice}`
  ]);
  await runQuestionCase(`marketing_clean.csv`, `Compare ${firstDevice} versus ${secondDevice} revenue by device`, [
    firstDevice,
    secondDevice,
    "leads"
  ]);
  await runQuestionCase(
    "marketing_clean.csv",
    `Compare ${firstDevice} versus ${secondDevice} revenue for ${paidCategoryName} by device`,
    [leadingDeviceWithinCategory, trailingDeviceWithinCategory, paidCategoryName]
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Compare customer defined segment A versus customer defined segment B revenue within customer defined category by customer defined dimension",
    [leadingDeviceWithinCategory, trailingDeviceWithinCategory, paidCategoryName],
    {
      selectedSegmentA: firstDevice,
      selectedSegmentB: secondDevice,
      selectedCategory: paidCategoryName,
      selectedDimension: "device"
    }
  );
  await runQuestionCase(
    `marketing_clean.csv`,
    `Compare ${firstDevice} versus ${secondDevice} revenue after ${selectedDate} by device`,
    [leadingDeviceAfterDate, trailingDeviceAfterDate, `date after ${selectedDate}`]
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Compare customer defined segment A versus customer defined segment B revenue after customer defined date by customer defined dimension",
    [leadingDeviceAfterDate, trailingDeviceAfterDate, `date after ${selectedDate}`],
    {
      selectedSegmentA: firstDevice,
      selectedSegmentB: secondDevice,
      selectedDate,
      selectedDimension: "device"
    }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    `Compare ${firstDevice} versus ${secondDevice} revenue trend over time by device`,
    [firstDevice, secondDevice, "trend"],
    undefined,
    (result) => {
      const columns = result.resultTable?.columns ?? [];
      const series = result.chartSuggestion?.series ?? [];
      return (
        result.chartSuggestion?.chartType === "line" &&
        columns[0] === "date" &&
        columns.includes(firstDevice) &&
        columns.includes(secondDevice) &&
        series.includes(firstDevice) &&
        series.includes(secondDevice) &&
        (result.resultTable?.rows ?? []).length > 0
      );
    }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Show revenue trend by device",
    [deviceTrendSeries[0] ?? "", deviceTrendSeries[1] ?? "", "trend"],
    undefined,
    (result) => {
      const columns = result.resultTable?.columns ?? [];
      const series = result.chartSuggestion?.series ?? [];
      return (
        result.chartSuggestion?.chartType === "line" &&
        columns[0] === "date" &&
        deviceTrendSeries.every((value) => columns.includes(value) && series.includes(value))
      );
    }
  );
  await runQuestionCase(
    "marketing_clean.csv",
    "Show revenue and cost trend by device",
    [deviceTrendSeries[0] ?? "", deviceTrendSeries[1] ?? "", "revenue", "cost"],
    undefined,
    (result) => {
      const columns = result.resultTable?.columns ?? [];
      const series = result.chartSuggestion?.series ?? [];
      const expectedKeys = deviceTrendSeries.flatMap((seriesValue) => [
        `${seriesValue} revenue`,
        `${seriesValue} cost`
      ]);
      return (
        result.chartSuggestion?.chartType === "line" &&
        columns[0] === "date" &&
        expectedKeys.every((value) => columns.includes(value) && series.includes(value))
      );
    }
  );
  await runQuestionCase("marketing_outliers.csv", "What anomalies should I investigate?", [
    "anomaly",
    topOutlierColumn
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

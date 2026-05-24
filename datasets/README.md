# Test Datasets for Analytics Copilot

This folder contains three purpose-built Excel workbooks for testing the current analytics prototype.

## 1. `analytics_testdata_channel_bias.xlsx`

Use this dataset to test:

- `channel` and `campaign` aggregation
- revenue and cost ranking
- missing numeric values
- duplicate row detection
- category normalization for inconsistent casing

Recommended questions:

- Which channel has the highest revenue?
- Top 3 campaigns by revenue
- Average cost by channel
- Show the revenue trend for Organic Search

Expected behavior:

- Paid Search should dominate revenue-related rankings.
- The duplicate row should be detected.
- The missing `cost` cell should be detected.
- `organic search` and `Paid search` should still resolve as channel values.

## 2. `analytics_testdata_device_bias.xlsx`

Use this dataset to test:

- device-based trend analysis
- compare `Desktop` versus `Mobile`
- anomaly detection
- label drift in categorical values
- malformed date handling

Recommended questions:

- Show revenue trend by device
- Compare Desktop versus Mobile revenue trend over time by device
- Which channel has the highest revenue for Mobile?
- What anomalies should I investigate?

Expected behavior:

- Device trend questions should return multi-series line charts.
- `Desktop`, `mobile`, and `MOBILE` should be treated as the same device family for analysis.
- The malformed date row should not break the full dataset.
- The large revenue value on one Mobile row should stand out as an anomaly.

## 3. `analytics_testdata_funnel_quality.xlsx`

Use this dataset to test:

- conversion rate and ROAS analysis
- anomaly detection
- handling of invalid numeric values
- blank categorical fields
- category normalization for source labels

Recommended questions:

- Lowest conversion rate by device
- Which campaign has the highest revenue where cost > 800?
- What anomalies should I investigate?
- Average revenue and customer defined metric by customer defined dimension within customer defined category

Expected behavior:

- Negative `cost` should be visible as a data defect.
- Conversion rate values above `1.0` should be easy to spot as invalid.
- Blank campaign values should surface in profiling or summaries.
- `Paid Search` and `paid search` should resolve consistently.

## Suggested Testing Flow

1. Upload `analytics_testdata_channel_bias.xlsx`.
2. Validate channel, campaign, revenue, and cost aggregations.
3. Upload `analytics_testdata_device_bias.xlsx`.
4. Validate device trends, comparisons, and anomaly detection.
5. Upload `analytics_testdata_funnel_quality.xlsx`.
6. Validate conversion rate, ROAS, anomaly detection, and invalid-value handling.

## Notes

- These files are intentionally not perfectly clean.
- They are meant to probe the current prototype's profiling, KPI detection, chart recommendation, and question-answering flows.
- If a question returns an unexpected result, check whether the issue is due to the data defect itself or a planner/executor gap.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/Users/joyce/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json");
const { chromium } = require("playwright");

const baseDir = "/Users/joyce/Joyce Doc/AI Coding/AI Agent/Codex/CDX DataCPLT";
const datasetDir = path.join(baseDir, "datasets/semantic_regression_pack_v1");
const outputPath = path.join(baseDir, "build/domain-blackout-frontend-audit.json");
const screenshotDir = path.join(baseDir, "build/domain-blackout-frontend-audit-screens");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const files = fs
  .readdirSync(datasetDir)
  .filter((name) => name.toLowerCase().endsWith(".csv"))
  .sort((left, right) => left.localeCompare(right));

function slugify(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
  page.setDefaultTimeout(30_000);

  const results = [];

  for (const fileName of files) {
    const network = [];
    const consoleMessages = [];

    page.removeAllListeners("response");
    page.removeAllListeners("requestfailed");
    page.removeAllListeners("console");
    page.on("console", (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text()
      });
    });
    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/analyze")) {
        network.push({
          kind: "requestfailed",
          method: request.method(),
          url: request.url(),
          failure: request.failure()?.errorText ?? null
        });
      }
    });
    page.on("response", async (response) => {
      if (!response.url().includes("/api/analyze")) {
        return;
      }

      let body = "";
      try {
        body = await response.text();
      } catch (error) {
        body = error instanceof Error ? error.message : String(error);
      }

      network.push({
        kind: "response",
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        body: body.slice(0, 1000)
      });
    });

    await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.join(datasetDir, fileName));

    await page.waitForFunction(
      (expectedName) => {
        return Array.from(document.querySelectorAll("label.dropzone small")).some((node) =>
          node.textContent?.includes(`Current file: ${expectedName}`)
        );
      },
      fileName,
      { timeout: 30_000 }
    );

    await page.waitForFunction(() => {
      const label = document.querySelector("label.dropzone span");
      return label && !label.textContent?.includes("Analyzing dataset...");
    }, { timeout: 120_000 });

    const state = await page.waitForFunction(() => {
      const headings = Array.from(document.querySelectorAll("h3")).map((node) => node.textContent?.trim());
      const hasInsights = headings.includes("Data Summary") && headings.includes("Executive Insight");
      const errorText = document.querySelector(".error-text")?.textContent?.trim() ?? "";
      const loadingText = document.querySelector("label.dropzone span")?.textContent?.trim() ?? "";

      if (hasInsights) {
        return { status: "ready" };
      }

      if (errorText) {
        return { status: "error", errorText, loadingText };
      }

      if (!loadingText.includes("Analyzing dataset")) {
        return { status: "idle", loadingText };
      }

      return null;
    }, { timeout: 120_000 }).catch(() => null);

    const extracted = await page.evaluate((resolvedState) => {
      function sectionItems(title, listSelector) {
        const heading = Array.from(document.querySelectorAll("h3")).find((node) => node.textContent?.trim() === title);
        const section = heading?.closest("section");
        if (!section) {
          return [];
        }

        return Array.from(section.querySelectorAll(listSelector))
          .map((node) => node.textContent?.trim() ?? "")
          .filter(Boolean);
      }

      const currentFile = Array.from(document.querySelectorAll("label.dropzone small"))
        .map((node) => node.textContent?.trim() ?? "")
        .find((text) => text.startsWith("Current file: "));

      return {
        state: resolvedState,
        currentFile,
        errorText: document.querySelector(".error-text")?.textContent?.trim() ?? null,
        visibleText: document.body.innerText,
        dataSummary: sectionItems("Data Summary", "li"),
        executiveInsight: sectionItems("Executive Insight", "li")
      };
    }, state ? await state.jsonValue() : null);

    const screenshotPath = path.join(screenshotDir, `${slugify(fileName)}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    results.push({
      fileName,
      currentFile: extracted.currentFile ?? null,
      state: extracted.state ?? null,
      errorText: extracted.errorText,
      visibleText: extracted.visibleText,
      dataSummary: extracted.dataSummary,
      executiveInsight: extracted.executiveInsight,
      network,
      consoleMessages,
      screenshotPath
    });
  }

  await browser.close();
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

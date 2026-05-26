import { describe, expect, it } from "vitest";
import { normalizeDateForQuestionContext } from "./dateNormalization";

describe("normalizeDateForQuestionContext", () => {
  it("keeps YYYY-MM-DD as-is", () => {
    expect(normalizeDateForQuestionContext("2026-05-26")).toBe("2026-05-26");
  });

  it("normalizes DD/MM/YYYY", () => {
    expect(normalizeDateForQuestionContext("26/05/2026")).toBe("2026-05-26");
  });

  it("normalizes YYYY/MM/DD", () => {
    expect(normalizeDateForQuestionContext("2026/05/26")).toBe("2026-05-26");
  });

  it("parses ambiguous slash dates using day-first project defaults", () => {
    expect(normalizeDateForQuestionContext("05/06/2026")).toBe("2026-06-05");
  });

  it("normalizes datetime strings to YYYY-MM-DD", () => {
    expect(normalizeDateForQuestionContext("2026-05-26 14:30")).toBe("2026-05-26");
    expect(normalizeDateForQuestionContext("26/05/2026 14:30")).toBe("2026-05-26");
    expect(normalizeDateForQuestionContext("2026-05-26T14:30:00Z")).toBe("2026-05-26");
  });

  it("returns undefined for invalid values", () => {
    expect(normalizeDateForQuestionContext("")).toBeUndefined();
    expect(normalizeDateForQuestionContext("not-a-date")).toBeUndefined();
    expect(normalizeDateForQuestionContext("31/02/2026")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { estimateLevel, MIN_ATTEMPTS } from "./level";
import type { Attempt } from "./types";

const run = (n: number, score: number, level = "B1", baseline = "B1", from = 0): Attempt[] =>
  Array.from({ length: n }, (_, i) => ({ at: from + i, level, baseline, score }));

describe("estimateLevel", () => {
  it("uses the self-reported level without evidence", () => {
    expect(estimateLevel("B1", [])).toEqual({ level: "B1", count: 0, average: null });
  });
  it("waits for enough attempts before moving", () => {
    expect(estimateLevel("B1", run(MIN_ATTEMPTS - 1, 100)).level).toBe("B1");
  });
  it("steps up when recent practice is easy and down when it is hard", () => {
    expect(estimateLevel("B1", run(MIN_ATTEMPTS, 95)).level).toBe("B2");
    expect(estimateLevel("B1", run(MIN_ATTEMPTS, 50)).level).toBe("A2");
    expect(estimateLevel("B1", run(MIN_ATTEMPTS, 75)).level).toBe("B1");
  });
  it("keeps climbing from the level actually practised", () => {
    const attempts = [...run(10, 95), ...run(MIN_ATTEMPTS, 92, "B2", "B1", 100)];
    expect(estimateLevel("B1", attempts).level).toBe("C1");
  });
  it("restarts when the setting changes", () => {
    expect(estimateLevel("A2", run(10, 95)).level).toBe("A2");
  });
  it("stays within A1-C2", () => {
    expect(estimateLevel("C2", run(10, 99, "C2", "C2")).level).toBe("C2");
    expect(estimateLevel("A1", run(10, 10, "A1", "A1")).level).toBe("A1");
  });
});

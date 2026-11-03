import { describe, expect, it } from "vitest";
import { applyScore, INTERVALS, isDue, newReviewItem, PASS_SCORE } from "./srs";

const day = (d: number) => new Date(2026, 10, d, 12);

describe("spaced repetition", () => {
  it("starts due today", () => {
    expect(isDue(newReviewItem("x", "", "English", day(1)), day(1))).toBe(true);
  });

  it("walks the full 0-1-3-7-14-30 schedule on passes, then retires", () => {
    let item = newReviewItem("x", "", "English", day(1));
    const now = day(1);
    const dues: (string | null)[] = [];
    for (let i = 1; i < INTERVALS.length; i++) {
      item = applyScore(item, PASS_SCORE, now);
      dues.push(item.due);
    }
    expect(dues).toEqual(["2026-11-02", "2026-11-04", "2026-11-08", "2026-11-15", "2026-12-01"]);
    item = applyScore(item, 100, now);
    expect(item.due).toBeNull();
    expect(isDue(item, day(30))).toBe(false);
  });

  it("repeats tomorrow at the same stage below the pass mark", () => {
    const item = applyScore(newReviewItem("x", "", "English", day(1)), PASS_SCORE - 1, day(1));
    expect(item).toMatchObject({ stage: 0, due: "2026-11-02", lastScore: 79 });
  });

  it("crosses month boundaries in local time", () => {
    const item = applyScore(newReviewItem("x", "", "English", day(30)), 90, day(30));
    expect(item.due).toBe("2026-12-01");
  });
});

import { describe, expect, it } from "vitest";
import { alignWords, combineScore, matchScore, tokenize } from "./score";

describe("tokenize", () => {
  it("ignores case, punctuation and apostrophes", () => {
    expect(tokenize("Don't stop, Believing!", "en")).toEqual(["dont", "stop", "believing"]);
  });
  it("segments unspaced scripts", () => {
    expect(tokenize("私は学生です", "ja").length).toBeGreaterThan(1);
  });
});

describe("matchScore", () => {
  it("is 100 for an exact reading despite punctuation", () => {
    expect(matchScore("Hello, world.", "hello world", "en")).toBe(100);
  });
  it("counts missing words", () => {
    expect(matchScore("one two three four", "one two", "en")).toBe(50);
  });
  it("does not reward extra words", () => {
    expect(matchScore("one two", "one two three four", "en")).toBe(50);
  });
  it("is 0 for silence and for an empty target", () => {
    expect(matchScore("one two", "", "en")).toBe(0);
    expect(matchScore("", "one", "en")).toBe(0);
  });
  it("respects word order", () => {
    expect(matchScore("a b c d", "d c b a", "en")).toBe(25);
  });
});

describe("alignWords", () => {
  it("flags the words that were not spoken", () => {
    expect(alignWords("the quick fox", "the fox", "en")).toEqual([
      { word: "the", matched: true },
      { word: "quick", matched: false },
      { word: "fox", matched: true },
    ]);
  });
  it("skips inserted words", () => {
    expect(alignWords("the fox", "the um fox", "en").every((w) => w.matched)).toBe(true);
  });
});

describe("combineScore", () => {
  it("averages both scores", () => {
    expect(combineScore(80, 61)).toBe(71);
  });
  it("uses the match alone when pronunciation failed", () => {
    expect(combineScore(80, null)).toBe(80);
  });
});

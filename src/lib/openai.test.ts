import { describe, expect, it } from "vitest";
import { extractJson, parseResponse } from "./openai";
import { asker, isHintRequest, preferencePrompt, safeUrl } from "./practice";

describe("parseResponse", () => {
  it("joins message text and skips web search items", () => {
    const parsed = parseResponse({
      output: [
        { type: "web_search_call" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "hello",
              annotations: [
                { type: "url_citation", url: "https://a.example", title: "A" },
                { type: "url_citation", url: "https://a.example", title: "A" },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.text).toBe("hello");
    expect(parsed.sources).toEqual([{ url: "https://a.example", title: "A" }]);
  });
  it("tolerates an empty body", () => {
    expect(parseResponse({})).toEqual({ text: "", sources: [] });
  });
});

describe("extractJson", () => {
  it("reads JSON inside a code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("sorry")).toThrow();
  });
});

describe("conversation rules", () => {
  it("alternates who asks, starting with the AI", () => {
    expect([1, 2, 3, 4, 5, 6].map(asker)).toEqual([
      "ai", "learner", "ai", "learner", "ai", "learner",
    ]);
  });
  it("recognises a spoken hint request but not a sentence containing the word", () => {
    expect(isHintRequest("ヒント")).toBe(true);
    expect(isHintRequest("Hint, please.")).toBe(true);
    expect(isHintRequest("I need a hint for this game")).toBe(false);
  });
});

describe("candidate helpers", () => {
  it("accepts only web URLs", () => {
    expect(safeUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
  it("describes recent likes and dislikes", () => {
    const p = preferencePrompt([
      { url: "u1", title: "Robots", topics: ["AI"], vote: 1, at: 2 },
      { url: "u2", title: "Stocks", topics: [], vote: -1, at: 1 },
    ]);
    expect(p).toContain('liked: "Robots" [AI]');
    expect(p).toContain('disliked: "Stocks"');
    expect(preferencePrompt([])).toBe("");
  });
});

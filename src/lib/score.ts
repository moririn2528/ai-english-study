const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(locale?: string): Intl.Segmenter {
  const key = locale ?? "";
  let s = segmenters.get(key);
  if (!s) {
    s = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(key, s);
  }
  return s;
}

/** Word tokens, lower-cased and without punctuation. Works for unspaced scripts too. */
export function tokenize(text: string, locale?: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[’']/g, "");
  return [...segmenter(locale).segment(normalized)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment);
}

export interface WordResult {
  word: string;
  matched: boolean;
}

/** Aligns the spoken text to the target with an LCS, marking each target word. */
export function alignWords(target: string, spoken: string, locale?: string): WordResult[] {
  const t = tokenize(target, locale);
  const s = tokenize(spoken, locale);
  const dp: number[][] = Array.from({ length: t.length + 1 }, () =>
    new Array<number>(s.length + 1).fill(0),
  );
  for (let i = t.length - 1; i >= 0; i--) {
    for (let j = s.length - 1; j >= 0; j--) {
      dp[i]![j] =
        t[i] === s[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: WordResult[] = [];
  let i = 0;
  let j = 0;
  while (i < t.length) {
    if (j < s.length && t[i] === s[j]) {
      out.push({ word: t[i]!, matched: true });
      i++;
      j++;
    } else if (j < s.length && dp[i]![j + 1]! > dp[i + 1]![j]!) {
      j++;
    } else {
      out.push({ word: t[i]!, matched: false });
      i++;
    }
  }
  return out;
}

/** Percentage of target words spoken, penalising extra words so reading more never helps. */
export function matchScore(target: string, spoken: string, locale?: string): number {
  const aligned = alignWords(target, spoken, locale);
  if (aligned.length === 0) return 0;
  const hits = aligned.filter((w) => w.matched).length;
  const total = Math.max(aligned.length, tokenize(spoken, locale).length);
  return Math.round((hits / total) * 100);
}

/** Pronunciation evaluation can fail; the match rate alone then decides the score. */
export function combineScore(match: number, pronunciation: number | null): number {
  return pronunciation === null ? match : Math.round((match + pronunciation) / 2);
}

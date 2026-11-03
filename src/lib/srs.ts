import type { ReviewItem } from "./types";

export const INTERVALS = [0, 1, 3, 7, 14, 30] as const;
export const PASS_SCORE = 80;

export function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, days: number): string {
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

export function newReviewItem(text: string, note: string, language: string, now: Date): ReviewItem {
  return {
    id: crypto.randomUUID(),
    text,
    note,
    language,
    stage: 0,
    due: addDays(now, INTERVALS[0]),
    lastScore: null,
    createdAt: now.getTime(),
  };
}

/** A pass advances to the next interval; anything lower comes back tomorrow at the same stage. */
export function applyScore(item: ReviewItem, score: number, now: Date): ReviewItem {
  if (score < PASS_SCORE) return { ...item, lastScore: score, due: addDays(now, 1) };
  const stage = item.stage + 1;
  const interval = INTERVALS[stage];
  return {
    ...item,
    stage,
    lastScore: score,
    due: interval === undefined ? null : addDays(now, interval),
  };
}

export function isDue(item: ReviewItem, now: Date): boolean {
  return item.due !== null && item.due <= dateKey(now);
}

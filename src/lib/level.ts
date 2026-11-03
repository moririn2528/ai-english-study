import type { Attempt } from "./types";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** What each CEFR level can handle, used to steer generated text. */
const GUIDES: Record<string, string> = {
  A1: "very short sentences of about 5-8 words, present tense, the most common 500 words, concrete everyday topics",
  A2: "short sentences of about 8-12 words, simple past and future, the most common 1000 words, few clauses",
  B1: "sentences of about 10-15 words, common connectors (because, although, so), present perfect, the most common 2000 words",
  B2: "sentences of about 15-20 words, relative clauses, passive voice, common phrasal verbs and idioms, the most common 4000 words",
  C1: "varied complex sentences, nuanced and abstract vocabulary, idiomatic and less frequent expressions",
  C2: "natural native-level prose with subtle nuance, wordplay and specialised vocabulary where fitting",
};

export function levelGuide(level: string): string {
  return GUIDES[level] ?? GUIDES.B1!;
}

/** Recent attempts considered at the current working level. */
export const WINDOW = 20;
/** Fewer attempts than this are not enough evidence to move. */
export const MIN_ATTEMPTS = 8;
export const UP_SCORE = 88;
export const DOWN_SCORE = 65;

export interface LevelEstimate {
  level: string;
  /** Attempts the estimate is based on (at the working level). */
  count: number;
  average: number | null;
}

function shift(level: string, by: number): string {
  const i = LEVELS.indexOf(level as (typeof LEVELS)[number]);
  if (i < 0) return level;
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, i + by))]!;
}

/**
 * Starts from the self-reported level and moves one step when recent shadowing at the
 * working level is clearly easy or clearly hard. Changing the setting restarts from it.
 */
export function estimateLevel(baseline: string, attempts: Attempt[]): LevelEstimate {
  const mine = attempts.filter((a) => a.baseline === baseline).sort((a, b) => a.at - b.at);
  const working = mine.at(-1)?.level ?? baseline;
  const recent = mine.filter((a) => a.level === working).slice(-WINDOW);
  if (recent.length === 0) return { level: working, count: 0, average: null };
  const average = Math.round(recent.reduce((sum, a) => sum + a.score, 0) / recent.length);
  if (recent.length < MIN_ATTEMPTS) return { level: working, count: recent.length, average };
  const level =
    average >= UP_SCORE ? shift(working, 1) : average < DOWN_SCORE ? shift(working, -1) : working;
  return { level, count: recent.length, average };
}

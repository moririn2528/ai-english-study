export interface Settings {
  language: string;
  nativeLanguage: string;
  level: string;
  interests: string;
  voice: string;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "English",
  nativeLanguage: "日本語",
  level: "B1",
  interests: "",
  voice: "marin",
};

export interface Material {
  id: string;
  createdAt: number;
  title: string;
  sentences: string[];
  sources: { url: string; title: string }[];
  language: string;
  /** CEFR level the script was written at; absent on materials made before levels were tracked. */
  level?: string;
}

/** An article proposed for shadowing, before it is turned into a material. */
export interface Candidate {
  url: string;
  title: string;
  source: string;
  /** Written in the learner's native language. */
  summary: string;
  topics: string[];
  /** Estimated CEFR level of the original article. */
  cefr: string;
  /** Why it suits language learning, in the native language. */
  why: string;
}

export interface Vote {
  url: string;
  title: string;
  topics: string[];
  vote: 1 | -1;
  at: number;
}

/** One scored shadowing sentence, used to estimate the learner's level. */
export interface Attempt {
  at: number;
  /** Level of the material that was practised. */
  level: string;
  /** Self-reported level in settings at the time; changing it restarts the estimate. */
  baseline: string;
  score: number;
}

export interface ReviewItem {
  id: string;
  text: string;
  note: string;
  language: string;
  stage: number;
  /** Local date `YYYY-MM-DD`; null once every interval has been passed. */
  due: string | null;
  lastScore: number | null;
  createdAt: number;
}

export interface RetroMoment {
  quote: string;
  issue: string;
  better: string;
  reviewSentences: string[];
}

export interface Retro {
  id: string;
  createdAt: number;
  title: string;
  transcript: string;
  moments: RetroMoment[];
}

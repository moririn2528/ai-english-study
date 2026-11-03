import { evaluatePronunciation, generateJson, searchJson, transcribe } from "./openai";
import { toWav } from "./audio";
import { combineScore, matchScore } from "./score";
import { levelGuide } from "./level";
import type { Candidate, Material, RetroMoment, Settings, Vote } from "./types";

export const DEFAULT_ROUNDS = 6;
export const MAX_RETRO_MOMENTS = 12;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const str = { type: "string" };
const strs = { type: "array", items: str };

function profile(s: Settings): string {
  return (
    `Target language: ${s.language}. Learner's native language: ${s.nativeLanguage}. ` +
    `CEFR level: ${s.level} (${levelGuide(s.level)}).`
  );
}

export const CANDIDATE_COUNT = 5;
/** Votes passed to the search; older ones fall out so taste can drift. */
const PREFERENCE_WINDOW = 20;

export function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Describes past +1/-1 votes so the search can lean towards what the learner liked. */
export function preferencePrompt(votes: Vote[]): string {
  const recent = [...votes].sort((a, b) => b.at - a.at).slice(0, PREFERENCE_WINDOW);
  const describe = (v: Vote) => `"${v.title}"${v.topics.length ? ` [${v.topics.join(", ")}]` : ""}`;
  const liked = recent.filter((v) => v.vote > 0).map(describe);
  const disliked = recent.filter((v) => v.vote < 0).map(describe);
  const lines: string[] = [];
  if (liked.length) lines.push(`The learner liked: ${liked.join("; ")}. Suggest more in this direction.`);
  if (disliked.length) lines.push(`The learner disliked: ${disliked.join("; ")}. Avoid similar topics and styles.`);
  return lines.join(" ");
}

export async function findCandidates(
  s: Settings,
  votes: Vote[],
  exclude: string[],
): Promise<Candidate[]> {
  const interests = s.interests.trim() || "technology, culture, and everyday life";
  const { data } = await searchJson<{ candidates: Partial<Candidate>[] }>({
    instructions:
      `You recommend reading material for language learners. ${profile(s)} ` +
      `Use web search to find ${CANDIDATE_COUNT} real articles written in the target language and published ` +
      `in the last 30 days that match the learner's interests and taste. ` +
      `Choose articles that are good for learning the language: clear, well-structured writing; natural, ` +
      `high-frequency vocabulary and expressions the learner can reuse in conversation; a concrete story or ` +
      `explanation rather than lists of numbers, names or jargon; freely readable without a paywall. ` +
      `Prefer articles whose original text is within one CEFR level of ${s.level}. ` +
      `Vary topics and publishers across the candidates. ` +
      `Reply with JSON only: {"candidates": [{"url": string, "title": string, "source": string, ` +
      `"summary": string, "topics": string[], "cefr": string, "why": string}]}. ` +
      `summary is one or two sentences and why is one sentence on what the learner can learn from it, ` +
      `both in the native language. topics are 1 to 3 short tags in the native language. ` +
      `cefr is your estimate (A1 to C2) of the original article's level.`,
    input:
      `Interests: ${interests}. ${preferencePrompt(votes)}` +
      (exclude.length ? ` Do not suggest these URLs: ${exclude.join(" ")}` : ""),
  });
  const seen = new Set(exclude);
  const out: Candidate[] = [];
  for (const c of data.candidates ?? []) {
    const url = safeUrl(c.url);
    if (!url || seen.has(url) || !c.title) continue;
    seen.add(url);
    out.push({
      url,
      title: c.title,
      source: c.source ?? new URL(url).hostname,
      summary: c.summary ?? "",
      topics: Array.isArray(c.topics) ? c.topics.slice(0, 3) : [],
      cefr: c.cefr ?? "",
      why: c.why ?? "",
    });
  }
  if (out.length === 0) throw new Error("候補が見つかりませんでした。興味の設定を広げてもう一度探してください");
  return out;
}

interface Article {
  found: boolean;
  title: string;
  sentences: string[];
}

export async function buildMaterial(s: Settings, c: Candidate): Promise<Material> {
  const { data, sources } = await searchJson<Article>({
    instructions:
      `You create shadowing scripts for language learners. ${profile(s)} ` +
      `Use web search to read the given article. Rewrite its content in your own words as 8 to 12 sentences ` +
      `in the target language at CEFR ${s.level}. Make every sentence natural to say aloud, and include ` +
      `useful expressions the learner can reuse in conversation. Never copy sentences from the source. ` +
      `Reply with JSON only: {"found": boolean, "title": string, "sentences": string[]}. ` +
      `Set found to false if you cannot read the article.`,
    input: `Article: ${c.title} (${c.url})`,
  });
  if (!data.found || !data.sentences?.length) {
    throw new Error("この記事を読み込めませんでした。別の候補を選んでください");
  }
  const own = { url: c.url, title: c.title };
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    title: data.title || c.title,
    sentences: data.sentences,
    sources: [own, ...sources.filter((x) => x.url !== c.url)],
    language: s.language,
    level: s.level,
  };
}

export interface SentenceScore {
  spoken: string;
  match: number;
  pronunciation: number | null;
  score: number;
  tips: string[];
}

export async function scoreAttempt(
  target: string,
  recording: Blob,
  s: Settings,
  locale?: string,
): Promise<SentenceScore> {
  // Transcribed without the target as a prompt: a hint would mask what was actually said.
  const spoken = await transcribe(recording, s.language);
  const match = matchScore(target, spoken, locale);
  const pronunciation = await toWav(recording)
    .then((wav) => evaluatePronunciation(wav, target, s.nativeLanguage))
    .catch(() => null);
  return {
    spoken,
    match,
    pronunciation: pronunciation?.score ?? null,
    score: combineScore(match, pronunciation?.score ?? null),
    tips: pronunciation?.tips ?? [],
  };
}

export interface SessionFeedback {
  tips: string[];
  reviewSentences: string[];
}

export function sessionFeedback(log: string, s: Settings): Promise<SessionFeedback> {
  return generateJson<SessionFeedback>({
    instructions:
      `You are a language coach. ${profile(s)} From the practice log, give up to 3 concise points ` +
      `to watch out for, written in the native language, and 3 to 5 short review sentences in the target ` +
      `language that train what the learner struggled with.`,
    input: log,
    schema: {
      name: "session_feedback",
      schema: object({ tips: strs, reviewSentences: strs }),
    },
  });
}

export type Speaker = "ai" | "learner";
export interface Turn {
  speaker: Speaker;
  text: string;
}

/** Odd rounds: the AI asks. Even rounds: the learner asks. */
export function asker(round: number): Speaker {
  return round % 2 === 1 ? "ai" : "learner";
}

const transcriptOf = (turns: Turn[]) =>
  turns.map((t) => `${t.speaker === "ai" ? "AI" : "Learner"}: ${t.text}`).join("\n") || "(start)";

export async function aiLine(
  turns: Turn[],
  action: "ask" | "answer" | "invite",
  s: Settings,
): Promise<string> {
  const task = {
    ask: "Ask one short, friendly question that follows naturally from the conversation.",
    answer: "Answer the learner's question briefly in one or two sentences. Do not ask anything back.",
    invite: "React in one short sentence, then invite the learner to ask you a question.",
  }[action];
  const interests = s.interests.trim();
  const { text } = await generateJson<{ text: string }>({
    instructions:
      `You are a conversation partner. ${profile(s)} ` +
      (interests ? `Learner's interests: ${interests}. ` : "") +
      `Speak only in the target language, at the learner's level. ${task}`,
    input: transcriptOf(turns),
    schema: { name: "line", schema: object({ text: str }) },
  });
  return text;
}

const HINT_STYLES = [
  "Rephrase the last AI line in simpler words of the target language.",
  "Give only the first few words of a possible sentence in the target language, ending with '...'.",
  "Give one complete sample sentence in the target language.",
] as const;
export const MAX_HINT = HINT_STYLES.length;

export function isHintRequest(spoken: string): boolean {
  return /^\s*(ヒント|ひんと|hint|help)[,、\s]*(please|ください)?[.。!！?？]*\s*$/i.test(spoken);
}

export async function hint(
  turns: Turn[],
  level: number,
  speaker: Speaker,
  s: Settings,
): Promise<string> {
  const goal = speaker === "ai" ? "answer the AI's question" : "ask the AI a question";
  const { text } = await generateJson<{ text: string }>({
    instructions:
      `Help a stuck language learner ${goal}. ${profile(s)} ` +
      `${HINT_STYLES[Math.min(level, MAX_HINT) - 1]}`,
    input: transcriptOf(turns),
    schema: { name: "hint", schema: object({ text: str }) },
  });
  return text;
}

export interface RetroAnalysis {
  title: string;
  moments: RetroMoment[];
}

export async function analyzeConversation(
  transcript: string,
  learnerHint: string,
  s: Settings,
): Promise<RetroAnalysis> {
  const result = await generateJson<RetroAnalysis>({
    instructions:
      `You review a real conversation for a language learner. ${profile(s)} ` +
      `The transcript has no speaker labels, so infer who the learner is from context` +
      `${learnerHint ? ` and this description: ${learnerHint}` : ""}. ` +
      `Only critique the learner's speech. Pick at most ${MAX_RETRO_MOMENTS} moments where they struggled. ` +
      `For each give the quote, the issue in the native language, a better phrasing in the target language, ` +
      `and exactly 3 short review sentences in the target language.`,
    input: transcript,
    schema: {
      name: "retro",
      schema: object({
        title: str,
        moments: {
          type: "array",
          items: object({ quote: str, issue: str, better: str, reviewSentences: strs }),
        },
      }),
    },
  });
  return { ...result, moments: result.moments.slice(0, MAX_RETRO_MOMENTS) };
}

export async function reviewSentencesFor(
  intended: string,
  s: Settings,
): Promise<string[]> {
  const { sentences } = await generateJson<{ sentences: string[] }>({
    instructions:
      `The learner explains what they wanted to say. ${profile(s)} ` +
      `Write exactly 3 natural, short sentences in the target language that say it or train the same phrasing.`,
    input: intended,
    schema: { name: "review", schema: object({ sentences: strs }) },
  });
  return sentences;
}

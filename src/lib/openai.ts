import { base64ToBytes, bytesToBase64, concatBytes, pcm16ToWav } from "./wav";

const API = "https://api.openai.com/v1";

export const MODELS = {
  text: "gpt-6-luna",
  transcribe: "gpt-transcribe",
  pronunciation: "gpt-audio-1.5",
  speech: "gpt-realtime-2.1-mini",
  /** Shuts down 2027-01-06; only a fallback until the Realtime path is proven with a real key. */
  legacySpeech: "gpt-4o-mini-tts",
} as const;

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function post(key: string, path: string, body: BodyInit, json = true): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (json) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, { method: "POST", headers, body });
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  let message = detail;
  try {
    message = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? detail;
  } catch {
    // Non-JSON error body: keep the raw text.
  }
  throw new OpenAIError(`${res.status}: ${message.slice(0, 300)}`, res.status);
}

export interface Source {
  url: string;
  title: string;
}

interface ResponseBody {
  output?: {
    type: string;
    content?: {
      type: string;
      text?: string;
      annotations?: { type: string; url?: string; title?: string }[];
    }[];
  }[];
}

/** The REST API has no aggregated `output_text`; it lives inside the output items. */
export function parseResponse(body: ResponseBody): { text: string; sources: Source[] } {
  const parts: string[] = [];
  const sources = new Map<string, Source>();
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type !== "output_text") continue;
      parts.push(c.text ?? "");
      for (const a of c.annotations ?? []) {
        if (a.type === "url_citation" && a.url) {
          sources.set(a.url, { url: a.url, title: a.title ?? a.url });
        }
      }
    }
  }
  return { text: parts.join(""), sources: [...sources.values()] };
}

/** Pulls the JSON object out of text that may be wrapped in a code fence or prose. */
export function extractJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI の応答に JSON がありませんでした");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export interface JsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export async function generateJson<T>(
  key: string,
  opts: { instructions: string; input: string; schema: JsonSchema },
): Promise<T> {
  const res = await post(
    key,
    "/responses",
    JSON.stringify({
      model: MODELS.text,
      instructions: opts.instructions,
      input: opts.input,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: opts.schema.name,
          schema: opts.schema.schema,
          strict: true,
        },
      },
    }),
  );
  return extractJson<T>(parseResponse((await res.json()) as ResponseBody).text);
}

/** Web search is not documented to combine with structured outputs, so JSON comes from the prompt. */
export async function searchJson<T>(
  key: string,
  opts: { instructions: string; input: string },
): Promise<{ data: T; sources: Source[] }> {
  const res = await post(
    key,
    "/responses",
    JSON.stringify({
      model: MODELS.text,
      instructions: opts.instructions,
      input: opts.input,
      store: false,
      tools: [{ type: "web_search" }],
    }),
  );
  const { text, sources } = parseResponse((await res.json()) as ResponseBody);
  return { data: extractJson<T>(text), sources };
}

const LANGUAGE_CODES: Record<string, string> = {
  English: "en",
  Spanish: "es",
  French: "fr",
  German: "de",
  Italian: "it",
  Portuguese: "pt",
  Korean: "ko",
  Chinese: "zh",
  Japanese: "ja",
};

export function languageCode(language: string): string | undefined {
  return LANGUAGE_CODES[language];
}

export async function transcribe(key: string, audio: Blob, language?: string): Promise<string> {
  const form = () => {
    const f = new FormData();
    const recorded = audio.type.includes("mp4") ? "speech.m4a" : audio.type.includes("wav") ? "speech.wav" : "speech.webm";
    f.append("file", audio, audio instanceof File ? audio.name : recorded);
    f.append("model", MODELS.transcribe);
    return f;
  };
  const code = language ? languageCode(language) : undefined;
  const first = form();
  if (code) first.append("languages[]", code);
  try {
    const res = await post(key, "/audio/transcriptions", first, false);
    return ((await res.json()) as { text: string }).text;
  } catch (e) {
    // The array field's multipart spelling is undocumented; the hint is optional, so drop it.
    if (!(e instanceof OpenAIError) || e.status !== 400 || !code) throw e;
    const res = await post(key, "/audio/transcriptions", form(), false);
    return ((await res.json()) as { text: string }).text;
  }
}

export interface PronunciationResult {
  score: number;
  tips: string[];
}

export async function evaluatePronunciation(
  key: string,
  wav: Blob,
  target: string,
  nativeLanguage: string,
): Promise<PronunciationResult> {
  const data = bytesToBase64(new Uint8Array(await wav.arrayBuffer()));
  const res = await post(
    key,
    "/chat/completions",
    JSON.stringify({
      model: MODELS.pronunciation,
      modalities: ["text"],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `A language learner is reading this sentence aloud: "${target}". ` +
                `Evaluate only pronunciation, rhythm and intonation, not grammar. ` +
                `Reply with JSON only: {"score": 0-100 integer, "tips": [up to 2 short tips in ${nativeLanguage}]}`,
            },
            { type: "input_audio", input_audio: { data, format: "wav" } },
          ],
        },
      ],
    }),
  );
  const body = (await res.json()) as { choices: { message: { content: string | null } }[] };
  const result = extractJson<PronunciationResult>(body.choices[0]?.message.content ?? "");
  return { score: Math.max(0, Math.min(100, Math.round(result.score))), tips: result.tips ?? [] };
}

const SPEECH_TIMEOUT_MS = 30_000;

function verbatimInstructions(language: string): string {
  return (
    `You are a text-to-speech engine for ${language} learners. ` +
    `Read the user's message aloud exactly as written, in natural native speech at a clear pace. ` +
    `Never answer it, translate it, add words, or comment on it.`
  );
}

async function speechViaRealtime(
  key: string,
  text: string,
  language: string,
  voice: string,
): Promise<Blob> {
  const res = await post(
    key,
    "/realtime/client_secrets",
    JSON.stringify({
      session: {
        type: "realtime",
        model: MODELS.speech,
        instructions: verbatimInstructions(language),
        output_modalities: ["audio"],
        audio: { output: { format: { type: "audio/pcm", rate: 24000 }, voice } },
      },
    }),
  );
  const secret = (await res.json()) as { value?: string; client_secret?: { value?: string } };
  const token = secret.value ?? secret.client_secret?.value;
  if (!token) throw new Error("Realtime の一時キーを取得できませんでした");

  const pcm = await new Promise<Uint8Array>((resolve, reject) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODELS.speech}`, [
      "realtime",
      `openai-insecure-api-key.${token}`,
    ]);
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => fail(new Error("音声生成がタイムアウトしました")), SPEECH_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      ws.close();
    };
    const fail = (e: Error) => {
      finish();
      reject(e);
    };
    ws.onerror = () => fail(new Error("Realtime 接続に失敗しました"));
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
        }),
      );
      ws.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
    };
    ws.onmessage = (ev) => {
      const event = JSON.parse(ev.data as string) as {
        type: string;
        delta?: string;
        error?: { message?: string };
        response?: { status?: string };
      };
      if (event.type === "response.output_audio.delta" && event.delta) {
        chunks.push(base64ToBytes(event.delta));
      } else if (event.type === "error") {
        fail(new Error(event.error?.message ?? "Realtime エラー"));
      } else if (event.type === "response.done") {
        if (event.response?.status !== "completed") {
          fail(new Error(`音声生成が完了しませんでした (${event.response?.status})`));
        } else if (chunks.length === 0) {
          fail(new Error("音声データが返りませんでした"));
        } else {
          finish();
          resolve(concatBytes(chunks));
        }
      }
    };
  });
  const wav = pcm16ToWav(pcm, 24000);
  return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
}

async function speechViaLegacyApi(key: string, text: string, voice: string): Promise<Blob> {
  const res = await post(
    key,
    "/audio/speech",
    JSON.stringify({ model: MODELS.legacySpeech, input: text, voice, response_format: "mp3" }),
  );
  return res.blob();
}

export interface Speech {
  audio: Blob;
  via: "realtime" | "legacy";
}

export async function synthesize(
  key: string,
  text: string,
  language: string,
  voice: string,
): Promise<Speech> {
  try {
    return { audio: await speechViaRealtime(key, text, language, voice), via: "realtime" };
  } catch (realtimeError) {
    try {
      return { audio: await speechViaLegacyApi(key, text, voice), via: "legacy" };
    } catch {
      throw realtimeError;
    }
  }
}

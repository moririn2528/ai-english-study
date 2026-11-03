import { useCallback, useEffect, useRef, useState } from "react";
import { play, speechFor, startRecording, type Recording } from "../lib/audio";
import { languageCode } from "../lib/openai";
import { alignWords } from "../lib/score";
import { saveReview } from "../lib/db";
import { newReviewItem } from "../lib/srs";
import type { Settings } from "../lib/types";
import type { SentenceScore } from "../lib/practice";

export interface ViewProps {
  settings: Settings;
}

/** Runs one async action at a time and exposes its progress label and error. */
export function useTask() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }, []);
  return { busy, error, run, setError };
}

export function Status({ busy, error }: { busy: string; error: string }) {
  return (
    <>
      {busy && <p className="busy" role="status">{busy}…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

export function useSpeak({ settings }: ViewProps) {
  return useCallback(
    async (text: string) =>
      play(await speechFor(text, settings.language, settings.voice)),
    [settings.language, settings.voice],
  );
}

export function useRecorder() {
  const recording = useRef<Recording | null>(null);
  const [active, setActive] = useState(false);
  // Leaving a tab mid-recording must release the microphone.
  useEffect(() => () => recording.current?.cancel(), []);
  const start = async (opts?: Parameters<typeof startRecording>[0]) => {
    recording.current = await startRecording(opts);
    setActive(true);
  };
  const stop = async () => {
    const blob = await recording.current!.stop();
    recording.current = null;
    setActive(false);
    return blob;
  };
  return { active, start, stop };
}

export function ScoreView({ target, result, language }: {
  target: string;
  result: SentenceScore;
  language: string;
}) {
  return (
    <div className="score">
      <strong className="points">{result.score} 点</strong>
      <span className="muted">
        {" "}一致 {result.match}
        {result.pronunciation === null ? "（発音評価なし）" : ` / 発音 ${result.pronunciation}`}
      </span>
      <p>
        {alignWords(target, result.spoken, languageCode(language)).map((w, i) => (
          <span key={i} className={w.matched ? "hit" : "miss"}>{w.word} </span>
        ))}
      </p>
      <p className="muted">聞き取り: {result.spoken || "（なし）"}</p>
      {result.tips.length > 0 && <ul>{result.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
    </div>
  );
}

export async function addReviews(sentences: string[], note: string, language: string) {
  await Promise.all(
    sentences.map((s) => saveReview(newReviewItem(s, note, language, new Date()))),
  );
}

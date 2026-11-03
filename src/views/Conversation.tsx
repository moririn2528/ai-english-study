import { useRef, useState } from "react";
import { transcribe } from "../lib/openai";
import {
  aiLine, asker, DEFAULT_ROUNDS, hint, isHintRequest, MAX_HINT, sessionFeedback,
  type SessionFeedback, type Turn,
} from "../lib/practice";
import { addReviews, Status, useRecorder, useSpeak, useTask, type ViewProps } from "./shared";

const SILENCE_HINT_MS = 10_000;

export function ConversationView(props: ViewProps) {
  const { apiKey, settings } = props;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [round, setRound] = useState(0);
  const [hints, setHints] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [saved, setSaved] = useState(false);
  const task = useTask();
  const speak = useSpeak(props);
  const rec = useRecorder();
  const hintLevel = useRef(0);
  const turnsRef = useRef<Turn[]>([]);
  const roundRef = useRef(0);

  const push = (t: Turn) => {
    turnsRef.current = [...turnsRef.current, t];
    setTurns(turnsRef.current);
  };

  const say = async (action: "ask" | "answer" | "invite") => {
    const text = await aiLine(apiKey, turnsRef.current, action, settings);
    push({ speaker: "ai", text });
    await speak(text);
  };

  const showHint = async () => {
    if (hintLevel.current >= MAX_HINT) return;
    hintLevel.current += 1;
    const text = await hint(apiKey, turnsRef.current, hintLevel.current, asker(roundRef.current) === "ai" ? "ai" : "learner", settings);
    setHints((prev) => [...prev, text]);
  };

  const listen = () =>
    rec.start({
      silenceMs: SILENCE_HINT_MS,
      onSilence: () => void showHint().catch((e: Error) => task.setError(e.message)),
    });

  const beginRound = async (r: number) => {
    roundRef.current = r;
    setRound(r);
    hintLevel.current = 0;
    setHints([]);
    await say(asker(r) === "ai" ? "ask" : "invite");
    await listen();
  };

  const finish = async () => {
    const log = turnsRef.current.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    setFeedback(await sessionFeedback(apiKey, log, settings));
    setRound(0);
  };

  const submit = async () => {
    const spoken = (await transcribe(apiKey, await rec.stop(), settings.language)).trim();
    if (!spoken || isHintRequest(spoken)) {
      await showHint();
      await listen();
      return;
    }
    push({ speaker: "learner", text: spoken });
    const r = roundRef.current;
    if (asker(r) === "learner") await say("answer");
    if (r >= DEFAULT_ROUNDS) await finish();
    else await beginRound(r + 1);
  };

  const start = () => {
    turnsRef.current = [];
    setTurns([]);
    setFeedback(null);
    setSaved(false);
    return task.run("会話を準備中", () => beginRound(1));
  };

  return (
    <section>
      <h2>質問し合う会話</h2>
      <p className="muted">
        全 {DEFAULT_ROUNDS} ラウンド。奇数回は AI が、偶数回はあなたが質問します。
        黙って 10 秒たつか「ヒント」と言うとヒントが出ます。
      </p>
      {round === 0 && <button className="primary" disabled={!!task.busy} onClick={start}>始める</button>}
      {round > 0 && (
        <p className="muted">
          ラウンド {round} / {DEFAULT_ROUNDS}: {asker(round) === "ai" ? "質問に答えてください" : "AI に質問してください"}
        </p>
      )}
      <ol className="chat">
        {turns.map((t, i) => (
          <li key={i} className={t.speaker}>{t.text}</li>
        ))}
      </ol>
      {hints.map((h) => <p key={h} className="hint">ヒント: {h}</p>)}
      {rec.active && (
        <button className="primary" onClick={() => task.run("聞き取り中", submit)}>■ 話し終えた</button>
      )}
      <Status {...task} />
      {feedback && (
        <div className="card">
          <h3>気をつける点</h3>
          <ul>{feedback.tips.map((t) => <li key={t}>{t}</li>)}</ul>
          <h3>復習文</h3>
          <ul>{feedback.reviewSentences.map((t) => <li key={t}>{t}</li>)}</ul>
          <button
            disabled={saved}
            onClick={() =>
              task.run("保存中", async () => {
                await addReviews(feedback.reviewSentences, "会話", settings.language);
                setSaved(true);
              })
            }
          >
            {saved ? "復習に追加しました" : "復習に追加"}
          </button>
        </div>
      )}
    </section>
  );
}

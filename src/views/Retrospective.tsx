import { useEffect, useState } from "react";
import { loadRetros, saveRetro } from "../lib/db";
import { transcribe } from "../lib/openai";
import { analyzeConversation, MAX_UPLOAD_BYTES, reviewSentencesFor } from "../lib/practice";
import type { Retro } from "../lib/types";
import { addReviews, Status, useRecorder, useTask, type ViewProps } from "./shared";

export function RetrospectiveView({ apiKey, settings }: ViewProps) {
  const [retros, setRetros] = useState<Retro[]>([]);
  const [retro, setRetro] = useState<Retro | null>(null);
  const [learnerHint, setLearnerHint] = useState("");
  const [intended, setIntended] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const task = useTask();
  const rec = useRecorder();

  useEffect(() => {
    void loadRetros().then(setRetros);
  }, []);

  const analyze = (audio: Blob) =>
    task.run("文字起こしと分析の実行中", async () => {
      if (audio.size > MAX_UPLOAD_BYTES) throw new Error("25MB を超える音声は処理できません");
      const transcript = await transcribe(apiKey, audio, settings.language);
      const analysis = await analyzeConversation(apiKey, transcript, learnerHint, settings);
      const r: Retro = { id: crypto.randomUUID(), createdAt: Date.now(), transcript, ...analysis };
      await saveRetro(r);
      setRetros((prev) => [r, ...prev]);
      setRetro(r);
    });

  const add = (sentences: string[], note: string, id: string) =>
    task.run("保存中", async () => {
      await addReviews(sentences, note, settings.language);
      setAdded((prev) => new Set(prev).add(id));
    });

  if (!retro) {
    return (
      <section>
        <h2>実際の英会話の振り返り</h2>
        <p className="muted">
          録音から話者を自動推定します。精度を上げるには、あなたの立場を書いてください。録音データは保存せず、
          文字起こし結果だけをこのブラウザに残します。
        </p>
        <label>
          あなたの立場（任意）
          <input
            value={learnerHint}
            placeholder="例: 面接を受けている側、日本語訛りの話者"
            onChange={(e) => setLearnerHint(e.target.value)}
          />
        </label>
        <div className="row">
          <label className="file">
            音声ファイルを選ぶ
            <input
              hidden
              type="file"
              accept="audio/*,video/webm,video/mp4"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void analyze(f);
              }}
            />
          </label>
          {rec.active ? (
            <button className="primary" onClick={() => void rec.stop().then(analyze)}>■ 録音を終了して分析</button>
          ) : (
            <button disabled={!!task.busy} onClick={() => task.run("マイクを準備中", () => rec.start())}>● ここで録音</button>
          )}
        </div>
        <Status {...task} />
        <ul className="list">
          {retros.map((r) => (
            <li key={r.id}>
              <button className="link" onClick={() => setRetro(r)}>{r.title}</button>
              <span className="muted"> {new Date(r.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section>
      <button className="link" onClick={() => setRetro(null)}>← 一覧</button>
      <h2>{retro.title}</h2>
      {retro.moments.map((m, i) => (
        <div className="card" key={i}>
          <p className="muted">「{m.quote}」</p>
          <p>{m.issue}</p>
          <p className="sentence">{m.better}</p>
          <ul>{m.reviewSentences.map((s) => <li key={s}>{s}</li>)}</ul>
          <button
            disabled={added.has(`${retro.id}-${i}`) || !!task.busy}
            onClick={() => add(m.reviewSentences, retro.title, `${retro.id}-${i}`)}
          >
            {added.has(`${retro.id}-${i}`) ? "追加しました" : "復習に追加"}
          </button>
        </div>
      ))}

      <h3>こう言いたかった</h3>
      <textarea
        rows={2}
        value={intended}
        placeholder="言いたかったことを日本語で"
        onChange={(e) => setIntended(e.target.value)}
      />
      <button
        disabled={!intended.trim() || !!task.busy}
        onClick={() =>
          task.run("復習文を作成中", async () => setExtra(await reviewSentencesFor(apiKey, intended, settings)))
        }
      >
        復習文を作る
      </button>
      {extra.length > 0 && (
        <div className="card">
          <ul>{extra.map((s) => <li key={s}>{s}</li>)}</ul>
          <button
            disabled={added.has("extra") || !!task.busy}
            onClick={() => add(extra, intended, "extra")}
          >
            {added.has("extra") ? "追加しました" : "復習に追加"}
          </button>
        </div>
      )}
      <Status {...task} />
      <details>
        <summary>文字起こし全文</summary>
        <p className="transcript">{retro.transcript}</p>
      </details>
    </section>
  );
}

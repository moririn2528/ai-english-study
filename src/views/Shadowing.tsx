import { useEffect, useState } from "react";
import {
  addAttempt, loadAttempts, loadCandidates, loadMaterials, loadSeen, loadVotes,
  saveCandidates, saveMaterial, saveSeen, saveVotes,
} from "../lib/db";
import { estimateLevel, MIN_ATTEMPTS, type LevelEstimate } from "../lib/level";
import { languageCode } from "../lib/openai";
import {
  buildMaterial, findCandidates, safeUrl, scoreAttempt, sessionFeedback,
  type SentenceScore, type SessionFeedback,
} from "../lib/practice";
import type { Attempt, Candidate, Material, Vote } from "../lib/types";
import { addReviews, ScoreView, Status, useRecorder, useSpeak, useTask, type ViewProps } from "./shared";

export function ShadowingView(props: ViewProps) {
  const { settings } = props;
  const [materials, setMaterials] = useState<Material[]>([]);
  const [material, setMaterial] = useState<Material | null>(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<number, SentenceScore>>({});
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [saved, setSaved] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const task = useTask();
  const speak = useSpeak(props);
  const rec = useRecorder();

  useEffect(() => {
    void loadMaterials().then(setMaterials);
    void loadCandidates().then(setCandidates);
    void loadVotes().then(setVotes);
    void loadAttempts().then(setAttempts);
    void loadSeen().then(setSeen);
  }, []);

  const estimate = estimateLevel(settings.level, attempts);
  const leveled = { ...settings, level: estimate.level };

  const search = () =>
    task.run("記事の候補を探し中", async () => {
      const exclude = [...seen, ...candidates.map((c) => c.url), ...votes.map((v) => v.url)];
      const found = await findCandidates(leveled, votes, [...new Set(exclude)]);
      const nextSeen = [...seen, ...found.map((c) => c.url)];
      setCandidates(found);
      setSeen(nextSeen);
      await Promise.all([saveCandidates(found), saveSeen(nextSeen)]);
    });

  /** One vote per article; pressing the same button again clears it. */
  const vote = (c: Candidate, v: 1 | -1) => {
    const current = votes.find((x) => x.url === c.url)?.vote;
    const rest = votes.filter((x) => x.url !== c.url);
    const next = current === v ? rest : [...rest, { url: c.url, title: c.title, topics: c.topics, vote: v, at: Date.now() }];
    setVotes(next);
    void saveVotes(next);
  };

  const choose = (c: Candidate) =>
    task.run("記事を読んで教材を作成中", async () => {
      const m = await buildMaterial(leveled, c);
      await saveMaterial(m);
      setMaterials((prev) => [m, ...prev]);
      open(m);
    });

  const open = (m: Material) => {
    setMaterial(m);
    setIndex(0);
    setResults({});
    setFeedback(null);
    setSaved(false);
  };

  if (!material) {
    return (
      <section>
        <h2>シャドーイング</h2>
        <LevelLine estimate={estimate} baseline={settings.level} />
        <div className="row">
          <button className="primary" disabled={!!task.busy} onClick={search}>
            {candidates.length ? "↻ 別の候補を探す" : "記事の候補を探す"}
          </button>
        </div>
        <p className="muted">
          +1 / -1 は次に探すときの好みとして使います。趣味・興味は「設定」で変えられます。
        </p>
        <Status {...task} />
        {candidates.map((c) => {
          const mine = votes.find((v) => v.url === c.url)?.vote;
          return (
            <div className="card" key={c.url}>
              <h3>
                <a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a>
              </h3>
              <p className="muted">
                {c.source}
                {c.cefr && ` ・ 原文 ${c.cefr} 程度`}
                {c.topics.length > 0 && ` ・ ${c.topics.join(" / ")}`}
              </p>
              {c.summary && <p>{c.summary}</p>}
              {c.why && <p className="muted">学べること: {c.why}</p>}
              <div className="row">
                <button className="primary" disabled={!!task.busy} onClick={() => void choose(c)}>
                  {estimate.level} で教材にする
                </button>
                <button className={mine === 1 ? "vote on" : "vote"} aria-pressed={mine === 1} onClick={() => vote(c, 1)}>
                  +1
                </button>
                <button className={mine === -1 ? "vote on" : "vote"} aria-pressed={mine === -1} onClick={() => vote(c, -1)}>
                  -1
                </button>
              </div>
            </div>
          );
        })}
        {materials.length > 0 && <h3>作った教材</h3>}
        <ul className="list">
          {materials.map((m) => (
            <li key={m.id}>
              <button className="link" onClick={() => open(m)}>{m.title}</button>
              <span className="muted"> {m.level ? `${m.level} ・ ` : ""}{new Date(m.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const sentence = material.sentences[index] ?? "";
  const result = results[index];
  return (
    <section>
      <button className="link" onClick={() => setMaterial(null)}>← 教材一覧</button>
      <h2>{material.title}</h2>
      <p className="muted">{index + 1} / {material.sentences.length}</p>
      <p className="sentence">{sentence}</p>
      <div className="row">
        <button disabled={!!task.busy || rec.active} onClick={() => task.run("音声を準備中", () => speak(sentence))}>
          ▶ 聞く
        </button>
        {rec.active ? (
          <button
            className="primary"
            onClick={() =>
              task.run("採点中", async () => {
                const r = await scoreAttempt(sentence, await rec.stop(), settings, languageCode(material.language));
                setResults((prev) => ({ ...prev, [index]: r }));
                setAttempts(await addAttempt({
                  at: Date.now(),
                  level: material.level ?? settings.level,
                  baseline: settings.level,
                  score: r.score,
                }));
              })
            }
          >
            ■ 終了して採点
          </button>
        ) : (
          <button className="primary" disabled={!!task.busy} onClick={() => task.run("マイクを準備中", () => rec.start())}>
            ● 録音
          </button>
        )}
        <button disabled={index === 0 || rec.active} onClick={() => setIndex(index - 1)}>前へ</button>
        <button disabled={index + 1 >= material.sentences.length || rec.active} onClick={() => setIndex(index + 1)}>次へ</button>
      </div>
      <Status {...task} />
      {result && <ScoreView target={sentence} result={result} language={material.language} />}

      {Object.keys(results).length > 0 && !feedback && (
        <button
          disabled={!!task.busy}
          onClick={() =>
            task.run("振り返りを作成中", async () => {
              const log = Object.entries(results)
                .map(([i, r]) => `Target: ${material.sentences[Number(i)]}\nSaid: ${r.spoken}\nScore: ${r.score}`)
                .join("\n\n");
              setFeedback(await sessionFeedback(log, settings));
            })
          }
        >
          練習を終えて振り返る
        </button>
      )}
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
                await addReviews(feedback.reviewSentences, material.title, material.language);
                setSaved(true);
              })
            }
          >
            {saved ? "復習に追加しました" : "復習に追加"}
          </button>
        </div>
      )}

      {material.sources.length > 0 && (
        <p className="muted">
          出典:{" "}
          {material.sources.map((s) => {
            const href = safeUrl(s.url);
            return href ? <a key={s.url} href={href} target="_blank" rel="noreferrer noopener">{s.title} </a> : null;
          })}
        </p>
      )}
    </section>
  );
}

function LevelLine({ estimate, baseline }: { estimate: LevelEstimate; baseline: string }) {
  const basis =
    estimate.average === null
      ? "まだ練習記録がないので設定どおり"
      : estimate.count < MIN_ATTEMPTS
        ? `直近 ${estimate.count} 文の平均 ${estimate.average} 点。${MIN_ATTEMPTS} 文たまると調整します`
        : `直近 ${estimate.count} 文の平均 ${estimate.average} 点から推定`;
  return (
    <p className="notice">
      推定レベル <strong>{estimate.level}</strong>（設定 {baseline}。{basis}）
    </p>
  );
}

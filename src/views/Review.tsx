import { useEffect, useState } from "react";
import { loadReviews, saveReview } from "../lib/db";
import { languageCode } from "../lib/openai";
import { scoreAttempt, type SentenceScore } from "../lib/practice";
import { applyScore, isDue, PASS_SCORE } from "../lib/srs";
import type { ReviewItem } from "../lib/types";
import { ScoreView, Status, useRecorder, useSpeak, useTask, type ViewProps } from "./shared";

export function ReviewView(props: ViewProps) {
  const { settings } = props;
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<SentenceScore | null>(null);
  const task = useTask();
  const speak = useSpeak(props);
  const rec = useRecorder();

  useEffect(() => {
    void loadReviews().then((rows) => {
      setTotal(rows.length);
      setQueue(rows.filter((r) => isDue(r, new Date())));
    });
  }, []);

  const item = queue[0];
  if (!item) {
    return (
      <section>
        <h2>今日の復習</h2>
        <p className="notice">
          {total === 0
            ? "復習文はまだありません。シャドーイングや会話の後に追加できます。"
            : "今日の復習は終わりました。"}
        </p>
      </section>
    );
  }

  const next = () => {
    setResult(null);
    setQueue((q) => q.slice(1));
  };

  return (
    <section>
      <h2>今日の復習（残り {queue.length}）</h2>
      <p className="sentence">{item.text}</p>
      {item.note && <p className="muted">{item.note}</p>}
      <div className="row">
        <button disabled={!!task.busy || rec.active} onClick={() => task.run("音声を準備中", () => speak(item.text))}>▶ 聞く</button>
        {!result && (rec.active ? (
          <button
            className="primary"
            onClick={() =>
              task.run("採点中", async () => {
                const r = await scoreAttempt(item.text, await rec.stop(), settings, languageCode(item.language));
                await saveReview(applyScore(item, r.score, new Date()));
                setResult(r);
              })
            }
          >
            ■ 終了して採点
          </button>
        ) : (
          <button className="primary" disabled={!!task.busy} onClick={() => task.run("マイクを準備中", () => rec.start())}>● 録音</button>
        ))}
        {result && <button onClick={next}>次へ</button>}
      </div>
      <Status {...task} />
      {result && (
        <>
          <ScoreView target={item.text} result={result} language={item.language} />
          <p className="notice">
            {result.score >= PASS_SCORE ? "合格。次の間隔へ進みます。" : "明日もう一度出します。"}
          </p>
        </>
      )}
    </section>
  );
}

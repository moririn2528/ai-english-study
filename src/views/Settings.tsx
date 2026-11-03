import { useRef, useState } from "react";
import { exportBackup, importBackup, type Backup } from "../lib/db";
import { isKeyRemembered, saveKey } from "../lib/key";
import { generateJson, MODELS, synthesize, transcribe, evaluatePronunciation } from "../lib/openai";
import { LEVELS } from "../lib/level";
import type { Settings } from "../lib/types";

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Korean", "Chinese", "Japanese",
];
const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

interface Check {
  name: string;
  state: "ok" | "fail";
  detail: string;
}

async function runChecks(key: string, s: Settings, report: (c: Check) => void) {
  const attempt = async <T,>(name: string, fn: () => Promise<[T, string]>): Promise<T | null> => {
    try {
      const [value, detail] = await fn();
      report({ name, state: "ok", detail });
      return value;
    } catch (e) {
      report({ name, state: "fail", detail: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };
  await attempt("文章生成", async () => {
    await generateJson(key, {
      instructions: "Reply with ok set to true.",
      input: "ping",
      schema: {
        name: "ping",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
      },
    });
    return [true, MODELS.text];
  });
  const speech = await attempt("音声合成", async () => {
    const result = await synthesize(key, "This is a connection test.", "English", s.voice);
    const model = result.via === "realtime" ? MODELS.speech : `${MODELS.legacySpeech}（代替。2027-01-06 終了）`;
    return [result.audio, model];
  });
  if (!speech) return;
  await attempt("文字起こし", async () => [true, await transcribe(key, speech, "English")]);
  if (speech.type === "audio/wav") {
    await attempt("発音評価", async () => {
      const r = await evaluatePronunciation(key, speech, "This is a connection test.", s.nativeLanguage);
      return [true, `${MODELS.pronunciation}: ${r.score} 点`];
    });
  }
}

export function SettingsView({ apiKey, onKey, settings, onSettings }: {
  apiKey: string;
  onKey: (k: string) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
}) {
  const [remember, setRemember] = useState(isKeyRemembered);
  const [checks, setChecks] = useState<Check[]>([]);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const setKey = (key: string, rem = remember) => {
    onKey(key);
    saveKey(key, rem);
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onSettings({ ...settings, [k]: v });

  const download = async () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `language-practice-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const restore = async (f: File) => {
    try {
      await importBackup(JSON.parse(await f.text()) as Backup);
      setMessage("読み込みました。再読み込みすると設定にも反映されます");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <h2>OpenAI API キー</h2>
      <p className="muted">
        キーはこのブラウザにのみ保存し、OpenAI 以外には送りません。漏えいに備えて、この用途専用の
        プロジェクトキーを作り、支出上限と有効期限を設定してください。
      </p>
      <label>
        API キー
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder="sk-..."
          onChange={(e) => setKey(e.target.value.trim())}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => {
            setRemember(e.target.checked);
            setKey(apiKey, e.target.checked);
          }}
        />
        ブラウザを閉じても保持する（共有端末では使わないでください）
      </label>
      <button
        disabled={!apiKey || testing}
        onClick={async () => {
          setChecks([]);
          setTesting(true);
          await runChecks(apiKey, settings, (c) => setChecks((prev) => [...prev, c]));
          setTesting(false);
        }}
      >
        {testing ? "テスト中…" : "接続テスト（数セント未満）"}
      </button>
      {checks.length > 0 && (
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.name} className={c.state}>
              {c.state === "ok" ? "✓" : "✗"} {c.name}: {c.detail}
            </li>
          ))}
        </ul>
      )}

      <h2>学習設定</h2>
      <label>
        練習する言語
        <select value={settings.language} onChange={(e) => set("language", e.target.value)}>
          {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
        </select>
      </label>
      <label>
        レベル（CEFR の自己申告。シャドーイングの点数からここを起点に自動で上下します）
        <select value={settings.level} onChange={(e) => set("level", e.target.value)}>
          {LEVELS.map((l) => <option key={l}>{l}</option>)}
        </select>
      </label>
      <label>
        声
        <select value={settings.voice} onChange={(e) => set("voice", e.target.value)}>
          {VOICES.map((v) => <option key={v}>{v}</option>)}
        </select>
      </label>
      <label>
        趣味・興味のある話題（記事の候補探しと会話で使います）
        <textarea
          rows={3}
          value={settings.interests}
          placeholder="例: AI, サッカー, 映画, 料理, 旅行"
          onChange={(e) => set("interests", e.target.value)}
        />
      </label>

      <h2>データ</h2>
      <p className="muted">学習データはこのブラウザの中にだけあります。消える前にバックアップしてください。</p>
      <div className="row">
        <button onClick={download}>バックアップを保存</button>
        <button onClick={() => file.current?.click()}>バックアップを読み込む</button>
        <input
          ref={file}
          hidden
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void restore(f);
          }}
        />
      </div>
      {message && <p className="notice">{message}</p>}
    </section>
  );
}

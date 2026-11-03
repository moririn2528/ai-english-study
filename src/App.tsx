import { useEffect, useState } from "react";
import { loadSettings, loadReviews, saveSettings } from "./lib/db";
import { isDue } from "./lib/srs";
import { DEFAULT_SETTINGS, type Settings } from "./lib/types";
import { ConversationView } from "./views/Conversation";
import { RetrospectiveView } from "./views/Retrospective";
import { ReviewView } from "./views/Review";
import { SettingsView } from "./views/Settings";
import { ShadowingView } from "./views/Shadowing";

const TABS = [
  ["review", "復習"],
  ["shadowing", "シャドーイング"],
  ["conversation", "会話"],
  ["retro", "振り返り"],
  ["settings", "設定"],
] as const;
type Tab = (typeof TABS)[number][0];

export function App() {
  const [tab, setTab] = useState<Tab>("review");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [due, setDue] = useState(0);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);
  useEffect(() => {
    void loadReviews().then((rows) => setDue(rows.filter((r) => isDue(r, new Date())).length));
  }, [tab]);

  const updateSettings = (s: Settings) => {
    setSettings(s);
    void saveSettings(s);
  };

  return (
    <div className="app">
      <header>
        <h1>語学トレーニング</h1>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)}>
              {label}
              {id === "review" && due > 0 ? ` (${due})` : ""}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "settings" ? (
          <SettingsView settings={settings} onSettings={updateSettings} />
        ) : tab === "review" ? (
          <ReviewView settings={settings} />
        ) : tab === "shadowing" ? (
          <ShadowingView settings={settings} />
        ) : tab === "conversation" ? (
          <ConversationView settings={settings} />
        ) : (
          <RetrospectiveView settings={settings} />
        )}
      </main>
    </div>
  );
}

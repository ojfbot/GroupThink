import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeManager } from "../lib/theme";
import type { GroupThinkConfig } from "../types";

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (recommended)" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

function Options() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("auto");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ThemeManager.apply();
    chrome.runtime.sendMessage({ type: "get-config" }).then((config: GroupThinkConfig) => {
      if (config.anthropicApiKey) setApiKey(config.anthropicApiKey);
      if (config.model) setModel(config.model);
      if (config.theme) setTheme(config.theme);
    });
  }, []);

  const handleSave = async () => {
    await chrome.runtime.sendMessage({
      type: "set-config",
      config: {
        anthropicApiKey: apiKey,
        model,
        theme,
      },
    });
    ThemeManager.apply();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <h1>GroupThink</h1>
      <p className="subtitle">Settings</p>

      <div className="field">
        <label htmlFor="apiKey">Anthropic API Key</label>
        <input
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          autoComplete="off"
        />
        <p className="hint">
          Stored locally in your browser. Never sent anywhere except Anthropic's API.
        </p>
      </div>

      <div className="field">
        <label htmlFor="model">Model</label>
        <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="theme">Theme</label>
        <select
          id="theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as "light" | "dark" | "auto")}
        >
          <option value="auto">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>

      <div className="actions">
        <button className="btn-primary" onClick={handleSave}>
          Save
        </button>
        <span className={`saved ${saved ? "visible" : ""}`}>Saved</span>
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Options />);

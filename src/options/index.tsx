import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeManager } from "../lib/theme";
import type { GroupThinkConfig } from "../types";

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (recommended)" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

type EnrichmentLevel = "off" | "basic" | "full";

const ENRICHMENT_PERMISSIONS: Record<EnrichmentLevel, string[]> = {
  off: [],
  basic: ["history", "topSites"],
  full: ["history", "topSites", "bookmarks", "sessions"],
};

function Options() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("auto");
  const [enrichment, setEnrichment] = useState<EnrichmentLevel>("off");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ThemeManager.apply();
    chrome.runtime.sendMessage({ type: "get-config" }).then((config: GroupThinkConfig) => {
      if (config.anthropicApiKey) setApiKey(config.anthropicApiKey);
      if (config.model) setModel(config.model);
      if (config.theme) setTheme(config.theme);
      if (config.contextEnrichment) setEnrichment(config.contextEnrichment);
    });
  }, []);

  const handleEnrichmentChange = async (level: EnrichmentLevel) => {
    if (level === "off") {
      setEnrichment(level);
      return;
    }
    const perms = ENRICHMENT_PERMISSIONS[level];
    try {
      const granted = await chrome.permissions.request({ permissions: perms });
      if (granted) {
        setEnrichment(level);
      }
      // If denied, keep current level
    } catch {
      // Permission request failed — keep current level
    }
  };

  const handleSave = async () => {
    await chrome.runtime.sendMessage({
      type: "set-config",
      config: {
        anthropicApiKey: apiKey,
        model,
        theme,
        contextEnrichment: enrichment,
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

      <div className="field">
        <label htmlFor="enrichment">Browser Context</label>
        <select
          id="enrichment"
          value={enrichment}
          onChange={(e) => handleEnrichmentChange(e.target.value as EnrichmentLevel)}
        >
          <option value="off">Off — title and URL only</option>
          <option value="basic">Basic — visit frequency + top sites</option>
          <option value="full">Full — also bookmarks + recent history</option>
        </select>
        <p className="hint">
          When enabled, browser signals are sent to the LLM for smarter grouping. Data is gathered
          fresh per request and never stored.
          {enrichment !== "off" && " Additional browser permissions will be requested."}
        </p>
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

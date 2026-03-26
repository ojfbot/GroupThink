import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeManager } from "../lib/theme";
import type { GroupThinkConfig, LLMProvider } from "../types";

const ANTHROPIC_MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (recommended)" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (cheapest)" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
];

const OLLAMA_MODELS = [
  { value: "qwen2.5:7b", label: "Qwen 2.5 7B (recommended)" },
  { value: "llama3.1:8b", label: "Llama 3.1 8B" },
  { value: "mistral:7b", label: "Mistral 7B" },
  { value: "gemma2:9b", label: "Gemma 2 9B" },
];

type EnrichmentLevel = "off" | "basic" | "full";

const ENRICHMENT_PERMISSIONS: Record<EnrichmentLevel, string[]> = {
  off: [],
  basic: ["history", "topSites"],
  full: ["history", "topSites", "bookmarks", "sessions"],
};

function Options() {
  const [provider, setProvider] = useState<LLMProvider>("ollama");
  const [apiKey, setApiKey] = useState("");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434");
  const [model, setModel] = useState("qwen2.5:7b");
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("auto");
  const [enrichment, setEnrichment] = useState<EnrichmentLevel>("off");
  const [saved, setSaved] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [ollamaError, setOllamaError] = useState("");

  useEffect(() => {
    ThemeManager.apply();
    chrome.runtime.sendMessage({ type: "get-config" }).then((config: GroupThinkConfig) => {
      if (config.provider) setProvider(config.provider);
      if (config.anthropicApiKey) setApiKey(config.anthropicApiKey);
      if (config.ollamaBaseUrl) setOllamaBaseUrl(config.ollamaBaseUrl);
      if (config.model) setModel(config.model);
      if (config.theme) setTheme(config.theme);
      if (config.contextEnrichment) setEnrichment(config.contextEnrichment);
    });
  }, []);

  const handleProviderChange = (newProvider: LLMProvider) => {
    setProvider(newProvider);
    // Switch to default model for the new provider
    const models = newProvider === "ollama" ? OLLAMA_MODELS : ANTHROPIC_MODELS;
    setModel(models[0].value);
    setOllamaStatus("idle");
  };

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
    } catch {
      // Permission request failed — keep current level
    }
  };

  const testOllamaConnection = async () => {
    setOllamaStatus("testing");
    setOllamaError("");
    try {
      const url = ollamaBaseUrl.replace(/\/$/, "");
      const res = await fetch(`${url}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const modelNames = data.models?.map((m) => m.name) ?? [];
      if (modelNames.length === 0) {
        setOllamaStatus("error");
        setOllamaError("Ollama is running but has no models. Run: ollama pull qwen2.5:7b");
      } else {
        setOllamaStatus("ok");
      }
    } catch (err) {
      setOllamaStatus("error");
      setOllamaError(
        err instanceof Error
          ? `Cannot reach Ollama: ${err.message}`
          : "Cannot reach Ollama server",
      );
    }
  };

  const handleSave = async () => {
    await chrome.runtime.sendMessage({
      type: "set-config",
      config: {
        provider,
        anthropicApiKey: apiKey,
        ollamaBaseUrl,
        model,
        theme,
        contextEnrichment: enrichment,
      },
    });
    ThemeManager.apply();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const models = provider === "ollama" ? OLLAMA_MODELS : ANTHROPIC_MODELS;

  return (
    <>
      <h1>GroupThink</h1>
      <p className="subtitle">Settings</p>

      <div className="field">
        <label htmlFor="provider">LLM Provider</label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
        >
          <option value="ollama">Ollama (local — free)</option>
          <option value="anthropic">Anthropic (cloud)</option>
        </select>
        {provider === "ollama" && (
          <p className="hint">
            Runs against a local model on your machine. Install Ollama, pull a model, and run{" "}
            <code>ollama serve</code>.
          </p>
        )}
      </div>

      {provider === "anthropic" && (
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
      )}

      {provider === "ollama" && (
        <div className="field">
          <label htmlFor="ollamaBaseUrl">Ollama Server URL</label>
          <div className="field-row">
            <input
              id="ollamaBaseUrl"
              type="text"
              value={ollamaBaseUrl}
              onChange={(e) => {
                setOllamaBaseUrl(e.target.value);
                setOllamaStatus("idle");
              }}
              placeholder="http://localhost:11434"
            />
            <button
              type="button"
              className={`btn-test ${ollamaStatus === "ok" ? "btn-test--ok" : ""}`}
              onClick={testOllamaConnection}
              disabled={ollamaStatus === "testing"}
            >
              {ollamaStatus === "testing"
                ? "Testing…"
                : ollamaStatus === "ok"
                  ? "Connected"
                  : "Test Connection"}
            </button>
          </div>
          {ollamaStatus === "error" && <p className="hint hint--error">{ollamaError}</p>}
        </div>
      )}

      <div className="field">
        <label htmlFor="model">Model</label>
        <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
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
        <button type="button" className="btn-primary" onClick={handleSave}>
          Save
        </button>
        <span className={`saved ${saved ? "visible" : ""}`}>Saved</span>
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Options />);

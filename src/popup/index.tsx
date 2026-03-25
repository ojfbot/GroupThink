import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeManager } from "../lib/theme";
import type { GroupThinkConfig } from "../types";

function Popup() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    ThemeManager.apply();
    chrome.runtime.sendMessage({ type: "get-config" }).then((config: GroupThinkConfig) => {
      setConfigured(!!config.anthropicApiKey);
    });
  }, []);

  const openApp = () => {
    chrome.runtime.sendMessage({ type: "open-app" });
    window.close();
  };

  const openSettings = () => {
    chrome.runtime.openOptionsPage();
    window.close();
  };

  const isMac = navigator.platform.includes("Mac");

  return (
    <>
      <h1>GroupThink</h1>
      <p className={`status ${configured ? "status--ok" : "status--warn"}`}>
        {configured === null ? "..." : configured ? "Ready" : "API key needed"}
      </p>
      <div className="menu">
        <button onClick={openApp}>
          Open GroupThink
          <span className="shortcut">{isMac ? "\u2318\u21e7G" : "Alt+Shift+G"}</span>
        </button>
        <button onClick={openSettings}>Settings</button>
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Popup />);

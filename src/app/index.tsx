import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatBar } from "../components/ChatBar";
import { SpecificitySlider } from "../components/SpecificitySlider";
import { type GroupAssignment, TabChaos } from "../components/TabChaos";
import { TreemapView } from "../components/TreemapView";
import { flattenForSpecificity, shouldRePrompt } from "../lib/grouping";
import { ThemeManager } from "../lib/theme";
import type { ConversationMessage, GroupingResponse, GroupThinkConfig, TabInfo } from "../types";

type LoadingPhase = "idle" | "fetching-tabs" | "chaos" | "coalescing";

function App() {
  const [config, setConfig] = useState<GroupThinkConfig | null>(null);
  const [rawGrouping, setRawGrouping] = useState<GroupingResponse | null>(null);
  const [specificity, setSpecificity] = useState(5);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [tabCount, setTabCount] = useState(0);

  // Chaos animation state
  const [chaosTabs, setChaosTabs] = useState<TabInfo[]>([]);
  const [groupAssignments, setGroupAssignments] = useState<
    Map<number, GroupAssignment> | undefined
  >();
  const [treemapReady, setTreemapReady] = useState(false);
  const [focusLabel, setFocusLabel] = useState<string | undefined>();
  const [focusChildLabel, setFocusChildLabel] = useState<string | undefined>();
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const didInitRef = useRef(false);

  const isLoading = loadingPhase !== "idle";

  // Clear all pending timers
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // Load config + apply theme
  useEffect(() => {
    ThemeManager.apply();
    const cleanup = ThemeManager.onSystemChange(() => ThemeManager.apply());

    chrome.runtime.sendMessage({ type: "get-config" }).then((cfg: GroupThinkConfig) => {
      setConfig(cfg);
      setSpecificity(cfg.specificity);
    });

    return () => {
      cleanup();
      clearTimers();
    };
  }, [clearTimers]);

  const countTabs = useCallback(
    (result: GroupingResponse) =>
      result.groups.reduce(
        (sum, g) => sum + g.tabs.length + (g.children?.reduce((s, c) => s + c.tabs.length, 0) ?? 0),
        0,
      ) + result.ungrouped.length,
    [],
  );

  const doGrouping = useCallback(
    async (spec: number, opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;

      if (!silent) {
        clearTimers();
        setLoadingPhase("fetching-tabs");
        setError(null);
        setGroupAssignments(undefined);
        setRawGrouping(null);
        setTreemapReady(false);
      }

      try {
        if (!silent) {
          // Phase 1: fetch tabs immediately
          const tabs = (await chrome.runtime.sendMessage({ type: "get-tabs" })) as TabInfo[];
          setChaosTabs(tabs);
          setTabCount(tabs.length);
          setLoadingPhase("chaos");

          // Phase 2: after 1.5s, shift to coalescing
          const coalesceTimer = setTimeout(() => setLoadingPhase("coalescing"), 1500);
          timersRef.current.push(coalesceTimer);
        }

        // Call the LLM
        const result = (await chrome.runtime.sendMessage({
          type: "group-tabs",
          specificity: spec,
        })) as GroupingResponse & { error?: string };

        if (result.error) throw new Error(result.error);

        if (!silent) {
          // Build group assignments map for TabChaos
          const assignments = new Map<number, GroupAssignment>();
          result.groups.forEach((group, gi) => {
            group.tabs.forEach((tab, ti) => {
              assignments.set(tab.id, {
                groupIndex: gi,
                positionInGroup: ti,
                groupLabel: group.label,
              });
            });
            group.children?.forEach((child) => {
              child.tabs.forEach((tab, ti) => {
                assignments.set(tab.id, {
                  groupIndex: gi,
                  positionInGroup: ti,
                  groupLabel: group.label,
                });
              });
            });
          });
          setGroupAssignments(assignments);
          setRawGrouping(result);
          setTabCount(countTabs(result));
          setHistory([]);
          setFocusLabel(undefined);
          setFocusChildLabel(undefined);
          setLoadingPhase("idle");
        }

        if (silent) {
          setRawGrouping(result);
          setTabCount(countTabs(result));
        }
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "Failed to group tabs");
          setLoadingPhase("idle");
        }
      }
    },
    [clearTimers, countTabs],
  );

  // Initial grouping — runs once when config is ready
  const configReady = config && (config.provider === "ollama" || !!config.anthropicApiKey);
  useEffect(() => {
    if (!configReady || didInitRef.current) return;
    didInitRef.current = true;

    (async () => {
      try {
        const cached = (await chrome.runtime.sendMessage({
          type: "get-cached-grouping",
        })) as GroupingResponse | null;
        if (cached && cached.groups.length > 0) {
          setRawGrouping(cached);
          setTabCount(countTabs(cached));
          setSpecificity(cached.specificity ?? specificity);
          setLoadingPhase("idle");
          return;
        }
      } catch {
        // Cache read failed — fall through to full grouping
      }
      doGrouping(specificity);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once
  }, [configReady]);

  const handleSpecificityChange = useCallback(
    (newSpec: number) => {
      setSpecificity(newSpec);
      // Persist so background regrouping uses the user's preferred specificity
      chrome.runtime.sendMessage({ type: "set-config", config: { specificity: newSpec } });

      if (rawGrouping && shouldRePrompt(rawGrouping.specificity, newSpec, rawGrouping.groups)) {
        doGrouping(newSpec);
      }
    },
    [rawGrouping, doGrouping],
  );

  const handleChat = useCallback(
    async (message: string) => {
      if (!rawGrouping) return;

      setChatLoading(true);
      setError(null);

      const userMsg: ConversationMessage = {
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      const updatedHistory = [...history, userMsg];
      setHistory(updatedHistory);

      try {
        const result = (await chrome.runtime.sendMessage({
          type: "refine-grouping",
          currentGrouping: rawGrouping,
          userMessage: message,
          history: updatedHistory,
        })) as GroupingResponse & { error?: string };

        if (result.error) throw new Error(result.error);
        setRawGrouping(result);

        // Apply focus hints from LLM
        if (result.focusGroupLabel) {
          setFocusLabel(result.focusGroupLabel);
          setFocusChildLabel(result.focusChildLabel ?? undefined);
        } else {
          setFocusLabel(undefined);
          setFocusChildLabel(undefined);
        }

        const focusNote = result.focusGroupLabel
          ? ` → Focused: ${result.focusGroupLabel}${result.focusChildLabel ? ` / ${result.focusChildLabel}` : ""}`
          : "";
        const assistantMsg: ConversationMessage = {
          role: "assistant",
          content: JSON.stringify(result.groups.map((g) => g.label)) + focusNote,
          timestamp: Date.now(),
        };
        setHistory([...updatedHistory, assistantMsg]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refine grouping");
      } finally {
        setChatLoading(false);
      }
    },
    [rawGrouping, history],
  );

  const handleFocusTab = useCallback((tabId: number) => {
    chrome.runtime.sendMessage({ type: "split-view-tab", tabId });
  }, []);

  const handleCloseTab = useCallback(
    (tabId: number) => {
      chrome.runtime.sendMessage({ type: "close-tab", tabId });
      if (rawGrouping) {
        setRawGrouping({
          ...rawGrouping,
          groups: rawGrouping.groups.map((g) => ({
            ...g,
            tabs: g.tabs.filter((t) => t.id !== tabId),
            children: g.children?.map((c) => ({
              ...c,
              tabs: c.tabs.filter((t) => t.id !== tabId),
            })),
          })),
          ungrouped: rawGrouping.ungrouped.filter((t) => t.id !== tabId),
        });
        setTabCount((c) => c - 1);
      }
    },
    [rawGrouping],
  );

  // Flatten based on current slider position
  const displayGrouping = rawGrouping ? flattenForSpecificity(rawGrouping, specificity) : null;

  // Show chaos animation during loading phases — keep visible until treemap has first layout
  const showChaos =
    loadingPhase === "chaos" ||
    loadingPhase === "coalescing" ||
    (loadingPhase === "idle" && displayGrouping && !treemapReady);
  const chaosPhase: "chaos" | "coalescing" = loadingPhase === "chaos" ? "chaos" : "coalescing";

  // ── No API key state (only applies to Anthropic provider) ──
  if (config && config.provider === "anthropic" && !config.anthropicApiKey) {
    return (
      <div className="gt-app">
        <div className="gt-setup">
          <h1 className="gt-setup__title">GroupThink</h1>
          <p className="gt-setup__message">Add your Anthropic API key to get started.</p>
          <button
            className="gt-button gt-button--primary"
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gt-app">
      {/* Header */}
      <header className="gt-header">
        <div className="gt-header__left">
          <h1 className="gt-header__title">GroupThink</h1>
          {tabCount > 0 && <span className="gt-header__count">{tabCount} tabs</span>}
        </div>
        <div className="gt-header__center">
          <SpecificitySlider
            value={specificity}
            onChange={handleSpecificityChange}
            disabled={isLoading}
          />
        </div>
        <div className="gt-header__right">
          <button
            className="gt-button gt-button--ghost"
            onClick={() => doGrouping(specificity)}
            disabled={isLoading}
            title="Re-group tabs"
          >
            {isLoading ? "Grouping\u2026" : "Refresh"}
          </button>
          <button
            className="gt-button gt-button--ghost"
            onClick={() => chrome.runtime.openOptionsPage()}
            title="Settings"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="gt-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* Main content */}
      <main className="gt-main">
        {loadingPhase === "fetching-tabs" && (
          <div className="gt-loading">
            <div className="gt-loading__spinner" />
            <p className="gt-loading__text">Gathering tabs...</p>
          </div>
        )}

        {showChaos && (
          <TabChaos tabs={chaosTabs} phase={chaosPhase} groupAssignments={groupAssignments} />
        )}

        {displayGrouping && loadingPhase === "idle" && (
          <TreemapView
            grouping={displayGrouping}
            onFocusTab={handleFocusTab}
            onCloseTab={handleCloseTab}
            onReady={() => setTreemapReady(true)}
            requestedFocusLabel={focusLabel}
            requestedChildLabel={focusChildLabel}
            onFocusDismissed={() => {
              setFocusLabel(undefined);
              setFocusChildLabel(undefined);
            }}
          />
        )}

        {loadingPhase === "idle" && !displayGrouping && !error && (
          <div className="gt-empty">
            <p className="gt-empty__headline">Tell me how to rearrange your mind.</p>
            <p className="gt-empty__sub">Press refresh to group your open tabs.</p>
          </div>
        )}
      </main>

      {/* Chat bar */}
      <ChatBar onSend={handleChat} disabled={!displayGrouping || isLoading} loading={chatLoading} />
    </div>
  );
}

// ── Mount ──
const container = document.getElementById("root")!;
const root = createRoot(container);
root.render(<App />);

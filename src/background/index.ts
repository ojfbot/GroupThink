import { GroupThinkAI } from "../lib/ai";
import { gatherBrowserContext } from "../lib/browser-context";
import { ENV_CONFIG } from "../lib/env";
import { enforceSubgroups, mergeSmallGroups, mergeStepResults } from "../lib/grouping";
import { buildContextHints } from "../lib/prompts";
import { Storage } from "../lib/storage";
import { closeTab, focusTab, getAllTabs, splitViewTab } from "../lib/tabs";
import type {
  ConversationMessage,
  GroupingResponse,
  LLMGroupItem,
  LLMGroupingResult,
  TabGroup,
  TabInfo,
} from "../types";

// ── On-demand thumbnail cache ──

const thumbCache = new Map<number, string>();
const captureInFlight = new Set<number>();

async function captureTabThumbnail(tabId: number): Promise<string | null> {
  if (thumbCache.has(tabId)) return thumbCache.get(tabId)!;
  if (captureInFlight.has(tabId)) return null;
  captureInFlight.add(tabId);

  try {
    const target = { tabId };
    await chrome.debugger.attach(target, "1.3");
    try {
      const result = (await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 50,
      })) as { data: string };
      const dataUrl = `data:image/jpeg;base64,${result.data}`;
      thumbCache.set(tabId, dataUrl);
      return dataUrl;
    } finally {
      await chrome.debugger.detach(target).catch(() => {});
    }
  } catch (err) {
    console.warn(`[GroupThink] capture-tab ${tabId} failed:`, err);
    return null;
  } finally {
    captureInFlight.delete(tabId);
  }
}

// ── Hydrate LLM response with full TabInfo ──

function hydrate(llmResult: LLMGroupingResult, tabs: TabInfo[]): GroupingResponse {
  const tabMap = new Map(tabs.map((t) => [t.id, t]));
  const descriptions = llmResult.tabDescriptions ?? {};
  const tags = llmResult.tabTags ?? {};
  let idCounter = 0;

  function hydrateTab(tid: number): TabInfo | undefined {
    const tab = tabMap.get(tid);
    if (!tab) return undefined;
    const desc = descriptions[String(tid)];
    const tabTagList = tags[String(tid)];
    return {
      ...tab,
      ...(desc ? { description: desc } : {}),
      ...(tabTagList ? { tags: tabTagList } : {}),
    };
  }

  function hydrateGroup(item: LLMGroupItem): TabGroup {
    const id = `g-${idCounter++}`;
    return {
      id,
      label: item.label,
      sublabel: item.sublabel,
      tabs: item.tabIds.map(hydrateTab).filter(Boolean) as TabInfo[],
      collapsed: true,
      children: item.children?.map(hydrateGroup),
    };
  }

  return {
    groups: llmResult.groups.map(hydrateGroup),
    ungrouped: llmResult.ungrouped.map(hydrateTab).filter(Boolean) as TabInfo[],
    specificity: 5,
    timestamp: Date.now(),
  };
}

// ── Singleton tab management ──

const APP_PATH = "src/app/index.html";

async function openOrFocusApp(): Promise<void> {
  const appUrl = chrome.runtime.getURL(APP_PATH);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url?.startsWith(appUrl));

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: appUrl });
  }
}

// ── Keyboard command ──

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-groupthink") {
    openOrFocusApp();
  }
});

// ── Auto-configure on install ──

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    if (ENV_CONFIG?.ANTHROPIC_API_KEY) {
      await Storage.setConfig({
        anthropicApiKey: ENV_CONFIG.ANTHROPIC_API_KEY,
        model: ENV_CONFIG.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      });
      console.log("[GroupThink] Auto-configured from env.json");
    } else {
      // Open options so user can enter API key
      chrome.runtime.openOptionsPage();
    }
  }
});

// ── Message handler ──

chrome.runtime.onMessage.addListener(
  (message: { type: string; [key: string]: unknown }, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => {
        console.error("[GroupThink] Message handler error:", err);
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      });
    return true; // keep channel open for async response
  },
);

async function handleMessage(message: { type: string; [key: string]: unknown }): Promise<unknown> {
  console.log(`[GroupThink] ← ${message.type}`);
  const t0 = performance.now();

  switch (message.type) {
    case "ping":
      return { ok: true };

    case "get-config": {
      const cfg = await Storage.getConfig();
      if (!cfg.anthropicApiKey && ENV_CONFIG?.ANTHROPIC_API_KEY) {
        await Storage.setConfig({
          anthropicApiKey: ENV_CONFIG.ANTHROPIC_API_KEY,
          model: ENV_CONFIG.ANTHROPIC_MODEL || cfg.model,
        });
        return Storage.getConfig();
      }
      return cfg;
    }

    case "set-config": {
      await Storage.setConfig(message.config as Record<string, unknown>);
      console.log("[GroupThink] config updated");
      return { ok: true };
    }

    case "get-cached-grouping": {
      const grouping = await Storage.getGrouping();
      return grouping;
    }

    case "capture-tab": {
      const tabId = message.tabId as number;
      const thumbnail = await captureTabThumbnail(tabId);
      return { thumbnail };
    }

    case "get-tabs": {
      const tabs = await getAllTabs();
      console.log(
        `[GroupThink] get-tabs: ${tabs.length} tabs in ${Math.round(performance.now() - t0)}ms`,
      );
      return tabs;
    }

    case "group-tabs": {
      const config = await Storage.getConfig();
      if (!config.anthropicApiKey) {
        throw new Error("No API key configured. Open GroupThink settings to add one.");
      }

      const tabs = await getAllTabs();
      console.log(`[GroupThink] group-tabs: ${tabs.length} tabs found`);

      if (tabs.length === 0) {
        return {
          groups: [],
          ungrouped: [],
          specificity: message.specificity as number,
          timestamp: Date.now(),
        } satisfies GroupingResponse;
      }

      const ai = new GroupThinkAI(config.anthropicApiKey, config.model);
      const specificity = (message.specificity as number) ?? config.specificity;

      // ── Gather browser context (if enabled) ──
      let contextHints: string | undefined;
      if (config.contextEnrichment && config.contextEnrichment !== "off") {
        console.log(`[GroupThink] gathering browser context (${config.contextEnrichment})...`);
        const context = await gatherBrowserContext(tabs, config.contextEnrichment);
        contextHints = buildContextHints(context, tabs);
      }

      // ── Step 1: Initial grouping ──
      console.log("[GroupThink] step 1: initial grouping...");
      let llmResult = await ai.groupTabs(tabs, specificity, contextHints);
      console.log(
        `[GroupThink] step 1 complete: ${llmResult.groups.length} groups, ${llmResult.ungrouped.length} ungrouped`,
      );

      // ── Step 2: Sweep uncategorized ──
      if (llmResult.ungrouped.length > 0) {
        console.log(
          `[GroupThink] step 2: sweeping ${llmResult.ungrouped.length} uncategorized tabs...`,
        );
        const tabMap = new Map(tabs.map((t) => [t.id, t]));
        const ungroupedTabs = llmResult.ungrouped
          .map((id) => tabMap.get(id))
          .filter(Boolean)
          .map((t) => ({ id: t!.id, title: t!.title, url: t!.url }));

        const existingGroups = llmResult.groups.map((g) => ({
          label: g.label,
          tabIds: g.tabIds,
        }));

        const sweepResult = await ai.sweepUncategorized(existingGroups, ungroupedTabs);
        llmResult = mergeStepResults(llmResult, sweepResult);
        console.log(
          `[GroupThink] step 2 complete: ${llmResult.groups.length} groups, ${llmResult.ungrouped.length} ungrouped`,
        );
      } else {
        console.log("[GroupThink] step 2: skipped (0 ungrouped)");
      }

      // ── Step 3: Merge singletons (client-side) ──
      console.log("[GroupThink] step 3: merging singleton groups...");
      const tabSummaries = tabs.map((t) => ({ id: t.id, url: t.url }));
      llmResult = mergeSmallGroups(llmResult, tabSummaries);
      console.log(`[GroupThink] step 3 complete: ${llmResult.groups.length} groups`);

      // ── Step 4: Enforce subgroups for high specificity ──
      if (specificity >= 5) {
        console.log("[GroupThink] step 4: enforcing subgroups...");
        const tabDetails = tabs.map((t) => ({ id: t.id, url: t.url, title: t.title }));
        llmResult = enforceSubgroups(llmResult, specificity, tabDetails);
        console.log(`[GroupThink] step 4 complete: ${llmResult.groups.length} groups`);
      } else {
        console.log("[GroupThink] step 4: skipped (specificity < 5)");
      }

      // ── Hydrate + store ──
      console.log(`[GroupThink] hydrating ${llmResult.groups.length} groups...`);
      const grouping = hydrate(llmResult, tabs);
      grouping.specificity = specificity;

      console.log(
        `[GroupThink] group-tabs complete in ${Math.round(performance.now() - t0)}ms: ${grouping.groups.length} groups, ${grouping.groups.reduce((s, g) => s + g.tabs.length, 0)} tabs matched`,
      );

      await Storage.setGrouping(grouping);
      return grouping;
    }

    case "refine-grouping": {
      const config = await Storage.getConfig();
      if (!config.anthropicApiKey) {
        throw new Error("No API key configured.");
      }

      const currentGrouping = message.currentGrouping as GroupingResponse;
      const userMessage = message.userMessage as string;
      const history = (message.history as ConversationMessage[]) ?? [];

      // Serialize current grouping for the LLM
      const groupingJson = JSON.stringify({
        groups: currentGrouping.groups.map((g) => ({
          label: g.label,
          sublabel: g.sublabel,
          tabIds: g.tabs.map((t) => t.id),
          children: g.children?.map((c) => ({
            label: c.label,
            sublabel: c.sublabel,
            tabIds: c.tabs.map((t) => t.id),
          })),
        })),
        ungrouped: currentGrouping.ungrouped.map((t) => t.id),
      });

      const ai = new GroupThinkAI(config.anthropicApiKey, config.model);
      const chatHistory = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const llmResult = await ai.refineGrouping(groupingJson, userMessage, chatHistory);

      // Collect all tabs from current grouping to re-hydrate
      const allTabs = [
        ...currentGrouping.groups.flatMap((g) => [
          ...g.tabs,
          ...(g.children?.flatMap((c) => c.tabs) ?? []),
        ]),
        ...currentGrouping.ungrouped,
      ];
      const grouping = hydrate(llmResult, allTabs);
      grouping.specificity = currentGrouping.specificity;

      // Pass through focus hints from LLM
      if (llmResult.focusGroupLabel) {
        grouping.focusGroupLabel = llmResult.focusGroupLabel;
      }
      if (llmResult.focusChildLabel) {
        grouping.focusChildLabel = llmResult.focusChildLabel;
      }

      await Storage.setGrouping(grouping);
      return grouping;
    }

    case "focus-tab": {
      await focusTab(message.tabId as number);
      return { ok: true };
    }

    case "split-view-tab": {
      await splitViewTab(message.tabId as number);
      return { ok: true };
    }

    case "close-tab": {
      await closeTab(message.tabId as number);
      return { ok: true };
    }

    case "open-app": {
      await openOrFocusApp();
      return { ok: true };
    }

    default:
      console.warn("[GroupThink] Unknown message type:", message.type);
      return { error: `Unknown message type: ${message.type}` };
  }
}

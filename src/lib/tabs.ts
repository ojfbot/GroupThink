import type { TabInfo } from "../types";

/** Query all tabs, filtering out extension and chrome:// pages */
export async function getAllTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => {
      if (!t.url) return false;
      if (t.url.startsWith("chrome://")) return false;
      if (t.url.startsWith("chrome-extension://")) return false;
      if (t.url.startsWith("about:")) return false;
      if (t.url.startsWith("edge://")) return false;
      return true;
    })
    .map((t) => ({
      id: t.id!,
      title: t.title || "Untitled",
      url: t.url!,
      favIconUrl: t.favIconUrl,
      windowId: t.windowId!,
      index: t.index,
      pinned: t.pinned || false,
      groupId: t.groupId ?? -1,
    }));
}

/** Focus an existing tab */
export async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

/** Close a tab */
export async function closeTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId);
}

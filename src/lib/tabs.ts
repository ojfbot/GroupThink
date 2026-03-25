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

/**
 * Move a tab into a split view alongside the current GroupThink window.
 * Resizes the current window to the left half, moves the target tab
 * into a new window on the right half.
 */
export async function splitViewTab(tabId: number): Promise<void> {
  const currentWindow = await chrome.windows.getCurrent();

  // Get screen work area for accurate bounds
  let left = 0;
  let top = 0;
  let screenW = (currentWindow.width ?? 1200) * 2;
  let screenH = currentWindow.height ?? 800;

  try {
    const displays = await chrome.system.display.getInfo();
    // Find the display containing the current window
    const winLeft = currentWindow.left ?? 0;
    const match = displays.find((d) => {
      const b = d.workArea;
      return winLeft >= b.left && winLeft < b.left + b.width;
    });
    const area = (match ?? displays[0]).workArea;
    left = area.left;
    top = area.top;
    screenW = area.width;
    screenH = area.height;
  } catch {
    // system.display unavailable — use current window position as fallback
    left = currentWindow.left ?? 0;
    top = currentWindow.top ?? 0;
  }

  const halfW = Math.floor(screenW / 2);

  // Resize GroupThink window to left half
  await chrome.windows.update(currentWindow.id!, {
    state: "normal",
    left,
    top,
    width: halfW,
    height: screenH,
  });

  // Move the target tab into a new window on the right half
  await chrome.windows.create({
    tabId,
    left: left + halfW,
    top,
    width: halfW,
    height: screenH,
    state: "normal",
    focused: true,
  });
}

/** Close a tab */
export async function closeTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId);
}

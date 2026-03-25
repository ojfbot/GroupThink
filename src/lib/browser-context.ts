export interface TabContext {
  visitCount?: number;
  lastVisitTime?: number;
  isBookmarked?: boolean;
  bookmarkFolder?: string;
  isTopSite?: boolean;
}

export interface RecentlyClosed {
  title: string;
  url: string;
}

export interface BrowserContext {
  tabs: Map<number, TabContext>;
  recentlyClosed: RecentlyClosed[];
}

type EnrichmentLevel = "off" | "basic" | "full";

async function hasPermission(permission: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: [permission] });
  } catch {
    return false;
  }
}

/**
 * Gather browser context signals for tab enrichment.
 * Uses optional permissions — gracefully skips any API that isn't granted.
 */
export async function gatherBrowserContext(
  tabs: Array<{ id: number; url: string }>,
  level: EnrichmentLevel,
): Promise<BrowserContext> {
  const context: BrowserContext = {
    tabs: new Map(),
    recentlyClosed: [],
  };

  if (level === "off") return context;

  const t0 = performance.now();

  // Initialize context entries
  for (const tab of tabs) {
    context.tabs.set(tab.id, {});
  }

  // Run all enrichment in parallel
  const tasks: Promise<void>[] = [];

  // ── History: visit count + last visit time ──
  if (await hasPermission("history")) {
    tasks.push(enrichWithHistory(tabs, context));
  }

  // ── Top sites ──
  if (await hasPermission("topSites")) {
    tasks.push(enrichWithTopSites(tabs, context));
  }

  // ── Full level: bookmarks + sessions ──
  if (level === "full") {
    if (await hasPermission("bookmarks")) {
      tasks.push(enrichWithBookmarks(tabs, context));
    }
    if (await hasPermission("sessions")) {
      tasks.push(enrichWithSessions(context));
    }
  }

  await Promise.allSettled(tasks);

  console.log(
    `[GroupThink] browser context gathered in ${Math.round(performance.now() - t0)}ms ` +
      `(${context.tabs.size} tabs, ${context.recentlyClosed.length} recently closed)`,
  );

  return context;
}

async function enrichWithHistory(
  tabs: Array<{ id: number; url: string }>,
  context: BrowserContext,
): Promise<void> {
  await Promise.allSettled(
    tabs.map(async (tab) => {
      try {
        const visits = await chrome.history.getVisits({ url: tab.url });
        const entry = context.tabs.get(tab.id);
        if (entry) {
          entry.visitCount = visits.length;
          if (visits.length > 0) {
            entry.lastVisitTime = Math.max(...visits.map((v) => v.visitTime ?? 0));
          }
        }
      } catch {
        // Individual tab history lookup failed — skip
      }
    }),
  );
}

async function enrichWithTopSites(
  tabs: Array<{ id: number; url: string }>,
  context: BrowserContext,
): Promise<void> {
  try {
    const topSites = await chrome.topSites.get();
    const topDomains = new Set<string>();
    for (const site of topSites) {
      try {
        topDomains.add(new URL(site.url).hostname.replace("www.", ""));
      } catch {
        // Invalid URL — skip
      }
    }

    for (const tab of tabs) {
      try {
        const domain = new URL(tab.url).hostname.replace("www.", "");
        if (topDomains.has(domain)) {
          const entry = context.tabs.get(tab.id);
          if (entry) entry.isTopSite = true;
        }
      } catch {
        // Invalid tab URL — skip
      }
    }
  } catch {
    // topSites API failed — skip entirely
  }
}

async function enrichWithBookmarks(
  tabs: Array<{ id: number; url: string }>,
  context: BrowserContext,
): Promise<void> {
  await Promise.allSettled(
    tabs.map(async (tab) => {
      try {
        const results = await chrome.bookmarks.search({ url: tab.url });
        if (results.length > 0) {
          const entry = context.tabs.get(tab.id);
          if (entry) {
            entry.isBookmarked = true;
            // Get parent folder name
            const parentId = results[0].parentId;
            if (parentId) {
              try {
                const parents = await chrome.bookmarks.get(parentId);
                if (parents[0]?.title) {
                  entry.bookmarkFolder = parents[0].title;
                }
              } catch {
                // Parent lookup failed — still mark as bookmarked
              }
            }
          }
        }
      } catch {
        // Individual bookmark lookup failed — skip
      }
    }),
  );
}

async function enrichWithSessions(context: BrowserContext): Promise<void> {
  try {
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
    for (const session of sessions) {
      const tab = session.tab;
      if (tab?.title && tab?.url && !tab.url.startsWith("chrome")) {
        context.recentlyClosed.push({
          title: tab.title,
          url: tab.url,
        });
      }
    }
  } catch {
    // sessions API failed — skip
  }
}

import type { GroupingResponse, LLMGroupItem, LLMGroupingResult, TabGroup } from "../types";

/**
 * Flatten a hierarchical grouping based on specificity level.
 * Low specificity: collapse children into parents.
 * High specificity: show children as separate groups.
 */
export function flattenForSpecificity(
  grouping: GroupingResponse,
  specificity: number,
): GroupingResponse {
  // Below 4: always collapse children into parent
  if (specificity <= 3) {
    return {
      ...grouping,
      groups: grouping.groups.map((g) => collapseChildren(g)),
    };
  }

  // 4-6: show children only for groups with 6+ total tabs
  if (specificity <= 6) {
    return {
      ...grouping,
      groups: grouping.groups.map((g) => {
        const totalTabs = countTabs(g);
        return totalTabs >= 6 ? g : collapseChildren(g);
      }),
    };
  }

  // 7+: show full hierarchy
  return grouping;
}

function collapseChildren(group: TabGroup): TabGroup {
  if (!group.children?.length) return group;

  const seen = new Set<number>();
  const allTabs = [...group.tabs, ...group.children.flatMap((c) => c.tabs)].filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  return {
    ...group,
    tabs: allTabs,
    children: undefined,
  };
}

function countTabs(group: TabGroup): number {
  return group.tabs.length + (group.children?.reduce((sum, c) => sum + c.tabs.length, 0) ?? 0);
}

/**
 * Should we re-prompt the LLM when specificity changes?
 * Re-prompt if jumping across a major threshold and current data lacks depth.
 */
export function shouldRePrompt(
  currentSpecificity: number,
  newSpecificity: number,
  groups: TabGroup[],
): boolean {
  // Any jump of 3+ specificity points
  if (Math.abs(newSpecificity - currentSpecificity) >= 3) return true;

  // Crossing from broad to specific
  if (currentSpecificity <= 3 && newSpecificity >= 5) return true;
  if (currentSpecificity >= 7 && newSpecificity <= 3) return true;

  // Moving to mid-high specificity but large groups lack children
  if (newSpecificity >= 5) {
    const threshold = newSpecificity >= 7 ? 4 : 6;
    const hasLargeFlat = groups.some(
      (g) => countTabs(g) >= threshold && (!g.children || g.children.length === 0),
    );
    if (hasLargeFlat) return true;
  }

  return false;
}

/**
 * Post-LLM enforcement: ensure large groups have children at high specificity.
 * Uses title keyword clustering — no LLM call.
 */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "be",
  "with",
  "from",
  "by",
  "that",
  "this",
  "it",
  "new",
  "all",
  "your",
  "how",
  "get",
  "set",
  "use",
  "not",
  "can",
  "will",
  "just",
  "more",
  "about",
  "has",
  "been",
  "its",
  "you",
  "what",
  "when",
  "who",
  "which",
  "where",
  "why",
  "top",
  "best",
  "com",
  "www",
  "http",
  "https",
  "html",
  "page",
  "home",
  "app",
  "web",
]);

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[\s|\-/:,.()[\]{}<>]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function enforceSubgroups(
  result: LLMGroupingResult,
  specificity: number,
  tabs: { id: number; url: string; title: string }[],
): LLMGroupingResult {
  if (specificity < 5) return result;

  const threshold = specificity >= 7 ? 4 : 6;
  const tabMap = new Map(tabs.map((t) => [t.id, t]));
  const merged = structuredClone(result);

  for (const group of merged.groups) {
    if (group.tabIds.length < threshold) continue;
    if (group.children && group.children.length > 0) continue;

    // Extract keywords from each tab's title
    const tabKeywords = new Map<number, string[]>();
    const keywordFreq = new Map<string, number>();

    for (const tabId of group.tabIds) {
      const tab = tabMap.get(tabId);
      if (!tab) continue;
      const kws = extractKeywords(tab.title);
      tabKeywords.set(tabId, kws);
      for (const kw of new Set(kws)) {
        keywordFreq.set(kw, (keywordFreq.get(kw) ?? 0) + 1);
      }
    }

    // Pick top keywords that appear in 2+ tabs but not ALL tabs (otherwise not discriminating)
    const tabCount = group.tabIds.length;
    const candidates = [...keywordFreq.entries()]
      .filter(([, count]) => count >= 2 && count < tabCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw]) => kw);

    if (candidates.length < 2) {
      // Can't find meaningful clusters — leave group flat
      console.log(
        `[GroupThink] enforceSubgroups: "${group.label}" — no viable keyword clusters, leaving flat`,
      );
      continue;
    }

    // Assign each tab to its best-matching keyword cluster
    const clusters = new Map<string, number[]>();
    const assigned = new Set<number>();

    for (const keyword of candidates) {
      clusters.set(keyword, []);
    }

    for (const tabId of group.tabIds) {
      const kws = tabKeywords.get(tabId) ?? [];
      // Find the first (most frequent) candidate keyword this tab matches
      const match = candidates.find((c) => kws.includes(c));
      if (match && !assigned.has(tabId)) {
        clusters.get(match)!.push(tabId);
        assigned.add(tabId);
      }
    }

    // Unassigned tabs go into an "Other" cluster
    const unassigned = group.tabIds.filter((id) => !assigned.has(id));

    // Build children from clusters with 2+ tabs
    const children: LLMGroupItem[] = [];
    const overflow: number[] = [...unassigned];

    for (const [keyword, tabIds] of clusters) {
      if (tabIds.length >= 2) {
        children.push({
          label: keyword.charAt(0).toUpperCase() + keyword.slice(1),
          tabIds,
        });
      } else {
        overflow.push(...tabIds);
      }
    }

    // Merge overflow into the largest child
    if (overflow.length > 0 && children.length > 0) {
      children.sort((a, b) => b.tabIds.length - a.tabIds.length);
      children[0].tabIds.push(...overflow);
    }

    if (children.length >= 2) {
      group.children = children;
      group.tabIds = [];
      console.log(
        `[GroupThink] enforceSubgroups: decomposed "${group.label}" into ${children.length} children by keyword`,
      );
    } else {
      console.log(
        `[GroupThink] enforceSubgroups: "${group.label}" — only ${children.length} viable cluster(s), leaving flat`,
      );
    }
  }

  return merged;
}

/** Move a tab from one group to another */
export function moveTab(
  grouping: GroupingResponse,
  tabId: number,
  targetGroupId: string,
): GroupingResponse {
  const groups = grouping.groups.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => t.id !== tabId),
    children: g.children?.map((c) => ({
      ...c,
      tabs: c.tabs.filter((t) => t.id !== tabId),
    })),
  }));
  const ungrouped = grouping.ungrouped.filter((t) => t.id !== tabId);

  // Find the tab in the original data
  const allTabs = [
    ...grouping.groups.flatMap((g) => [...g.tabs, ...(g.children?.flatMap((c) => c.tabs) ?? [])]),
    ...grouping.ungrouped,
  ];
  const tab = allTabs.find((t) => t.id === tabId);
  if (!tab) return grouping;

  // Add to target
  const updatedGroups = groups.map((g) => {
    if (g.id === targetGroupId) {
      return { ...g, tabs: [...g.tabs, tab] };
    }
    return g;
  });

  return { ...grouping, groups: updatedGroups, ungrouped };
}

/**
 * Merge sweep results into step-1 results.
 * If a sweep group label matches an existing group, append tabIds.
 * Otherwise add as a new group.
 */
export function mergeStepResults(
  step1: LLMGroupingResult,
  sweep: LLMGroupingResult,
): LLMGroupingResult {
  const merged = structuredClone(step1);

  // Build a lookup of existing labels (case-insensitive)
  const labelMap = new Map<string, number>();
  for (let i = 0; i < merged.groups.length; i++) {
    labelMap.set(merged.groups[i].label.toLowerCase(), i);
  }

  for (const sweepGroup of sweep.groups) {
    const key = sweepGroup.label.toLowerCase();
    const existingIdx = labelMap.get(key);

    if (existingIdx !== undefined) {
      // Append tab IDs to existing group (deduplicate)
      const existing = merged.groups[existingIdx];
      const existingSet = new Set(existing.tabIds);
      for (const id of sweepGroup.tabIds) {
        if (!existingSet.has(id)) {
          existing.tabIds.push(id);
        }
      }
      console.log(
        `[GroupThink] merge: appended ${sweepGroup.tabIds.length} tabs to "${existing.label}"`,
      );
    } else {
      // New group from sweep
      merged.groups.push(sweepGroup);
      labelMap.set(key, merged.groups.length - 1);
      console.log(
        `[GroupThink] merge: new group "${sweepGroup.label}" with ${sweepGroup.tabIds.length} tabs`,
      );
    }
  }

  // Any remaining ungrouped from sweep stay ungrouped
  merged.ungrouped = sweep.ungrouped ?? [];

  console.log(
    `[GroupThink] merge complete: ${merged.groups.length} groups, ${merged.ungrouped.length} ungrouped`,
  );
  return merged;
}

/**
 * Merge singleton groups (1 tab) into the best-matching group by domain similarity.
 * Pure client-side, no LLM call.
 */
export function mergeSmallGroups(
  result: LLMGroupingResult,
  tabs: { id: number; url: string }[],
): LLMGroupingResult {
  const merged = structuredClone(result);
  const tabUrlMap = new Map(tabs.map((t) => [t.id, t.url]));

  function getDomain(tabId: number): string {
    const url = tabUrlMap.get(tabId);
    if (!url) return "";
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  function groupDomains(group: (typeof merged.groups)[0]): Set<string> {
    const domains = new Set<string>();
    for (const id of group.tabIds) {
      const d = getDomain(id);
      if (d) domains.add(d);
    }
    return domains;
  }

  // Find singletons
  const singletons: number[] = [];
  const kept: typeof merged.groups = [];

  for (let i = 0; i < merged.groups.length; i++) {
    if (merged.groups[i].tabIds.length <= 1 && !merged.groups[i].children?.length) {
      singletons.push(i);
    } else {
      kept.push(merged.groups[i]);
    }
  }

  if (singletons.length === 0 || kept.length === 0) return merged;

  console.log(`[GroupThink] mergeSmall: ${singletons.length} singleton groups to merge`);

  for (const si of singletons) {
    const singleton = merged.groups[si];
    if (singleton.tabIds.length === 0) continue;

    const singletonDomain = getDomain(singleton.tabIds[0]);
    let bestIdx = 0;
    let bestScore = 0;

    for (let ki = 0; ki < kept.length; ki++) {
      const domains = groupDomains(kept[ki]);
      // Exact domain match = 2, same base domain = 1
      if (domains.has(singletonDomain)) {
        bestIdx = ki;
        bestScore = 2;
        break;
      }
      // Check base domain (e.g. docs.github.com → github.com)
      const sBase = singletonDomain.split(".").slice(-2).join(".");
      for (const d of domains) {
        if (d.split(".").slice(-2).join(".") === sBase && bestScore < 1) {
          bestIdx = ki;
          bestScore = 1;
        }
      }
    }

    // If no domain match, just pick the largest group
    if (bestScore === 0) {
      let maxSize = 0;
      for (let ki = 0; ki < kept.length; ki++) {
        if (kept[ki].tabIds.length > maxSize) {
          maxSize = kept[ki].tabIds.length;
          bestIdx = ki;
        }
      }
    }

    kept[bestIdx].tabIds.push(...singleton.tabIds);
    console.log(`[GroupThink] mergeSmall: "${singleton.label}" → "${kept[bestIdx].label}"`);
  }

  merged.groups = kept;
  return merged;
}

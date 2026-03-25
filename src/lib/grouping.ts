import type { GroupingResponse, LLMGroupingResult, TabGroup } from "../types";

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
  // Moving from broad (<=3) to specific (>=7) or vice versa
  const crossesMajorThreshold =
    (currentSpecificity <= 3 && newSpecificity >= 7) ||
    (currentSpecificity >= 7 && newSpecificity <= 3);

  if (crossesMajorThreshold) return true;

  // Moving to high specificity but no groups have children
  if (newSpecificity >= 7) {
    const hasChildren = groups.some((g) => g.children && g.children.length > 0);
    if (!hasChildren) return true;
  }

  return false;
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

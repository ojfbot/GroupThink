import { hierarchy, treemap, treemapBinary, treemapSquarify } from "d3-hierarchy";
import type { GroupingResponse, TabGroup, TabInfo } from "../types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeRect {
  id: string;
  kind: "group" | "child-group" | "tab";
  rect: Rect;
  colorIndex: number;
  opacity: number;
  group?: TabGroup;
  tab?: TabInfo;
  parentGroupId: string | null;
}

const BREADCRUMB_H = 44;
const GUTTER_RATIO = 0.15;
const GUTTER_GAP = 4;

function countTabs(g: TabGroup): number {
  return g.tabs.length + (g.children?.reduce((s, c) => s + c.tabs.length, 0) ?? 0);
}

/** Build the list of virtual groups (including stragglers pseudo-group). */
function buildGroups(grouping: GroupingResponse): { group: TabGroup; count: number }[] {
  const groups = grouping.groups.map((g) => ({
    group: g,
    count: Math.max(countTabs(g), 1),
  }));

  if (grouping.ungrouped.length > 0) {
    groups.push({
      group: {
        id: "__stragglers",
        label: "Loose Tabs",
        tabs: grouping.ungrouped,
        collapsed: false,
      },
      count: grouping.ungrouped.length,
    });
  }

  return groups;
}

/** Run a d3 treemap and return leaf rects. */
function runTreemap(
  items: { weight: number; data: any }[],
  width: number,
  height: number,
  padding: number,
  paddingTop: number,
  useBinary = false,
): { data: any; rect: Rect }[] {
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const root = hierarchy({ children: items }).sum((d: any) => d.weight ?? 0);

  const layout = treemap<any>()
    .tile(useBinary ? treemapBinary : treemapSquarify)
    .size([width, height])
    .padding(padding)
    .paddingTop(paddingTop)
    .round(true);

  layout(root);

  return root.leaves().map((leaf: any) => ({
    data: leaf.data.data,
    rect: { x: leaf.x0, y: leaf.y0, w: leaf.x1 - leaf.x0, h: leaf.y1 - leaf.y0 },
  }));
}

/**
 * Compute a stable color index for each group.
 * Uses the group's position in the full group list (sorted by tab count desc)
 * so that colors don't shift when focusing/unfocusing.
 */
function buildColorMap(groups: { group: TabGroup; count: number }[]): Map<string, number> {
  const sorted = [...groups].sort((a, b) => b.count - a.count);
  const map = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    map.set(sorted[i].group.id, i);
  }
  return map;
}

/**
 * Adaptive padding based on tile count and viewport area.
 * More tiles or smaller viewport → less padding overhead.
 */
function adaptivePadding(count: number, area: number): { padding: number; paddingTop: number } {
  const areaPerTile = area / Math.max(count, 1);

  // Tiny tiles: minimal padding
  if (areaPerTile < 3000) {
    return { padding: 2, paddingTop: 14 };
  }
  // Small tiles: reduced padding
  if (areaPerTile < 8000) {
    return { padding: 3, paddingTop: 18 };
  }
  // Normal: standard padding
  return { padding: 4, paddingTop: 24 };
}

/**
 * Unified layout: outputs all NodeRects for any zoom state.
 *
 * focusedGroupId === null → overview (group tiles only)
 * focusedGroupId !== null → focused group + sibling gutter + tab tiles
 */
export function computeUnifiedLayout(
  grouping: GroupingResponse,
  width: number,
  height: number,
  focusedGroupId: string | null,
  focusedChildId: string | null = null,
): NodeRect[] {
  if (width <= 0 || height <= 0) return [];

  const groups = buildGroups(grouping);
  if (groups.length === 0) return [];

  const colorMap = buildColorMap(groups);

  // ── Overview mode ──
  if (!focusedGroupId) {
    const area = width * height;
    const { padding, paddingTop } = adaptivePadding(groups.length, area);
    // Use binary tiling for 6+ groups — better space utilization
    const useBinary = groups.length >= 6;

    const leaves = runTreemap(
      groups.map((g) => ({ weight: g.count, data: g })),
      width,
      height,
      padding,
      paddingTop,
      useBinary,
    );

    return leaves.map(({ data, rect }) => ({
      id: data.group.id,
      kind: "group" as const,
      rect,
      colorIndex: colorMap.get(data.group.id) ?? 0,
      opacity: 1,
      group: data.group,
      parentGroupId: null,
    }));
  }

  // ── Focused mode ──
  const nodes: NodeRect[] = [];
  const focused = groups.find((g) => g.group.id === focusedGroupId);
  if (!focused) return [];

  const siblings = groups.filter((g) => g.group.id !== focusedGroupId);

  // Focused group rect
  const gutterW = siblings.length > 0 ? Math.max(width * GUTTER_RATIO, 60) : 0;
  const focusedW = width - gutterW - (siblings.length > 0 ? GUTTER_GAP : 0);
  const contentH = height - BREADCRUMB_H;

  const focusedRect: Rect = { x: 0, y: BREADCRUMB_H, w: focusedW, h: contentH };

  // Focused group node (background/header)
  nodes.push({
    id: focused.group.id,
    kind: "group",
    rect: focusedRect,
    colorIndex: colorMap.get(focused.group.id) ?? 0,
    opacity: 1,
    group: focused.group,
    parentGroupId: null,
  });

  // Content inside focused group
  const groupLabelH = 28;
  const inset = 3;
  const innerX = inset;
  const innerY = BREADCRUMB_H + groupLabelH;
  const innerW = focusedW - inset * 2;
  const innerH = contentH - groupLabelH - inset;

  const hasChildren = focused.group.children && focused.group.children.length > 0;

  // Build child segments (used in both child-focused and normal child layout)
  let segments: { child: TabGroup; count: number }[] = [];
  if (hasChildren) {
    if (focused.group.tabs.length > 0) {
      segments.push({
        child: {
          id: `${focusedGroupId}__direct`,
          label: focused.group.label,
          tabs: focused.group.tabs,
          collapsed: false,
        },
        count: focused.group.tabs.length,
      });
    }
    for (const child of focused.group.children!) {
      if (child.tabs.length > 0) {
        segments.push({ child, count: child.tabs.length });
      }
    }

    // Deduplicate tabs across segments — each tab ID appears only once
    const seenTabIds = new Set<number>();
    for (const seg of segments) {
      const dedupedTabs = seg.child.tabs.filter((t) => {
        if (seenTabIds.has(t.id)) return false;
        seenTabIds.add(t.id);
        return true;
      });
      if (dedupedTabs.length !== seg.child.tabs.length) {
        seg.child = { ...seg.child, tabs: dedupedTabs };
      }
      seg.count = dedupedTabs.length;
    }
    segments = segments.filter((s) => s.count > 0);
  }

  // ── Child-focused mode ──
  if (focusedChildId && hasChildren) {
    const focusedChild = segments.find((s) => s.child.id === focusedChildId);
    if (focusedChild) {
      const siblingChildren = segments.filter((s) => s.child.id !== focusedChildId);

      // Child gutter
      const childGutterW = siblingChildren.length > 0 ? Math.max(innerW * GUTTER_RATIO, 50) : 0;
      const childMainW = innerW - childGutterW - (siblingChildren.length > 0 ? GUTTER_GAP : 0);
      const childMainH = innerH;

      // Focused child header
      const childHeaderH = 24;
      nodes.push({
        id: focusedChild.child.id,
        kind: "child-group",
        rect: { x: innerX, y: innerY, w: childMainW, h: childMainH },
        colorIndex: colorMap.get(focusedGroupId) ?? 0,
        opacity: 1,
        group: focusedChild.child,
        parentGroupId: focusedGroupId,
      });

      // Tabs inside focused child — fill the main area
      const childTabAreaW = childMainW - 4;
      const childTabAreaH = childMainH - childHeaderH - 2;
      if (childTabAreaW > 0 && childTabAreaH > 0) {
        const tabs = focusedChild.child.tabs;
        const tabPad = adaptivePadding(tabs.length, childTabAreaW * childTabAreaH);
        const tabLeaves = runTreemap(
          tabs.map((t) => ({ weight: 1, data: t })),
          childTabAreaW,
          childTabAreaH,
          tabPad.padding,
          0,
          tabs.length >= 10,
        );
        tabLeaves.forEach(({ data: tab, rect: tabRect }) => {
          nodes.push({
            id: `tab-${tab.id}`,
            kind: "tab",
            rect: {
              x: tabRect.x + innerX + 2,
              y: tabRect.y + innerY + childHeaderH,
              w: tabRect.w,
              h: tabRect.h,
            },
            colorIndex: colorMap.get(focusedGroupId) ?? 0,
            opacity: 1,
            tab,
            parentGroupId: focusedChild.child.id,
          });
        });
      }

      // Sibling children in gutter
      if (siblingChildren.length > 0) {
        const gutterX = innerX + childMainW + GUTTER_GAP;
        const gutterPad = adaptivePadding(siblingChildren.length, childGutterW * childMainH);
        const gutterLeaves = runTreemap(
          siblingChildren.map((s) => ({ weight: s.count, data: s })),
          childGutterW,
          childMainH,
          gutterPad.padding,
          Math.min(gutterPad.paddingTop, 14),
          true,
        );
        gutterLeaves.forEach(({ data: seg, rect: gutterRect }) => {
          nodes.push({
            id: seg.child.id,
            kind: "child-group",
            rect: {
              x: gutterRect.x + gutterX,
              y: gutterRect.y + innerY,
              w: gutterRect.w,
              h: gutterRect.h,
            },
            colorIndex: colorMap.get(focusedGroupId) ?? 0,
            opacity: 0.35,
            group: seg.child,
            parentGroupId: focusedGroupId,
          });
        });
      }
    }
  } else if (hasChildren) {
    // Normal two-level layout: child groups → tabs within each child
    const childPad = adaptivePadding(segments.length, innerW * innerH);
    const childLeaves = runTreemap(
      segments.map((s) => ({ weight: s.count, data: s })),
      innerW,
      innerH,
      childPad.padding,
      Math.min(childPad.paddingTop, 18),
      segments.length >= 4,
    );

    childLeaves.forEach(({ data: seg, rect: childRect }) => {
      const absRect: Rect = {
        x: childRect.x + innerX,
        y: childRect.y + innerY,
        w: childRect.w,
        h: childRect.h,
      };

      nodes.push({
        id: seg.child.id,
        kind: "child-group",
        rect: absRect,
        colorIndex: colorMap.get(focusedGroupId) ?? 0,
        opacity: 1,
        group: seg.child,
        parentGroupId: focusedGroupId,
      });

      const childLabelH = 20;
      const childInset = 2;
      const tabAreaW = absRect.w - childInset * 2;
      const tabAreaH = absRect.h - childLabelH - childInset;

      if (tabAreaW > 0 && tabAreaH > 0) {
        const childTabs: TabInfo[] = seg.child.tabs;
        const tabPad = adaptivePadding(childTabs.length, tabAreaW * tabAreaH);
        const tabLeaves = runTreemap(
          childTabs.map((t) => ({ weight: 1, data: t })),
          tabAreaW,
          tabAreaH,
          tabPad.padding,
          0,
          childTabs.length >= 8,
        );

        tabLeaves.forEach(({ data: tab, rect: tabRect }) => {
          nodes.push({
            id: `tab-${tab.id}`,
            kind: "tab",
            rect: {
              x: tabRect.x + absRect.x + childInset,
              y: tabRect.y + absRect.y + childLabelH,
              w: tabRect.w,
              h: tabRect.h,
            },
            colorIndex: colorMap.get(focusedGroupId) ?? 0,
            opacity: 1,
            tab,
            parentGroupId: seg.child.id,
          });
        });
      }
    });
  } else {
    // Flat layout: all tabs directly in the focused area (no children)
    const tabs = focused.group.tabs;
    const tabPad = adaptivePadding(tabs.length, innerW * innerH);
    const tabLeaves = runTreemap(
      tabs.map((t) => ({ weight: 1, data: t })),
      innerW,
      innerH,
      tabPad.padding,
      0,
      tabs.length >= 10,
    );

    tabLeaves.forEach(({ data: tab, rect }) => {
      nodes.push({
        id: `tab-${tab.id}`,
        kind: "tab",
        rect: {
          x: rect.x + innerX,
          y: rect.y + innerY,
          w: rect.w,
          h: rect.h,
        },
        colorIndex: colorMap.get(focusedGroupId) ?? 0,
        opacity: 1,
        tab,
        parentGroupId: focusedGroupId,
      });
    });
  }

  // Sibling gutter strip
  if (siblings.length > 0) {
    const gutterX = focusedW + GUTTER_GAP;
    const gutterPad = adaptivePadding(siblings.length, gutterW * contentH);

    const gutterLeaves = runTreemap(
      siblings.map((g) => ({ weight: g.count, data: g })),
      gutterW,
      contentH,
      gutterPad.padding,
      Math.min(gutterPad.paddingTop, 16),
      true, // always binary in narrow gutter
    );

    gutterLeaves.forEach(({ data, rect }) => {
      nodes.push({
        id: data.group.id,
        kind: "group",
        rect: {
          x: rect.x + gutterX,
          y: rect.y + BREADCRUMB_H,
          w: rect.w,
          h: rect.h,
        },
        colorIndex: colorMap.get(data.group.id) ?? 0,
        opacity: 0.35,
        group: data.group,
        parentGroupId: null,
      });
    });
  }

  return nodes;
}

import { useMemo } from "react";
import type { TabInfo } from "../types";

const MAX_TILES = 60;

const SKELETON_COLORS = [
  "hsl(210, 20%, 60%)",
  "hsl(340, 18%, 58%)",
  "hsl(160, 22%, 55%)",
  "hsl(40, 25%, 62%)",
  "hsl(270, 15%, 58%)",
  "hsl(190, 20%, 55%)",
  "hsl(20, 22%, 60%)",
  "hsl(300, 12%, 56%)",
  "hsl(120, 18%, 55%)",
  "hsl(60, 20%, 58%)",
];

export interface GroupAssignment {
  groupIndex: number;
  positionInGroup: number;
  groupLabel: string;
}

interface TabChaosProps {
  tabs: TabInfo[];
  phase: "chaos" | "coalescing" | "resolved";
  groupAssignments?: Map<number, GroupAssignment>;
}

export function TabChaos({ tabs, phase, groupAssignments }: TabChaosProps) {
  // Sample evenly if too many tabs
  const visibleTabs = useMemo(() => {
    if (tabs.length <= MAX_TILES) return tabs;
    const step = tabs.length / MAX_TILES;
    return Array.from({ length: MAX_TILES }, (_, i) => tabs[Math.floor(i * step)]);
  }, [tabs]);

  // Chaos positions: golden-ratio spiral scatter
  const chaosPositions = useMemo(() => {
    const total = visibleTabs.length;
    return visibleTabs.map((_, i) => {
      const angle = (i / total) * Math.PI * 2 + i * 0.618 * Math.PI;
      const radius = 18 + (i % 7) * 5;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;
      return { left: `${x}%`, top: `${y}%` };
    });
  }, [visibleTabs]);

  // Coalescing: shrink radius toward center
  const coalescingPositions = useMemo(() => {
    const total = visibleTabs.length;
    return visibleTabs.map((_, i) => {
      const angle = (i / total) * Math.PI * 2 + i * 0.618 * Math.PI;
      const radius = 10 + (i % 5) * 3;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;
      return { left: `${x}%`, top: `${y}%` };
    });
  }, [visibleTabs]);

  // Resolved positions: grid layout by group
  const resolvedPositions = useMemo(() => {
    if (!groupAssignments) return null;

    // Count unique groups
    const groupLabels: string[] = [];
    const groupCounts = new Map<number, number>();
    groupAssignments.forEach((a) => {
      if (!groupLabels[a.groupIndex]) groupLabels[a.groupIndex] = a.groupLabel;
      groupCounts.set(a.groupIndex, (groupCounts.get(a.groupIndex) ?? 0) + 1);
    });
    const numGroups = groupLabels.filter(Boolean).length || 1;

    // Compute grid columns
    const colWidth = 100 / Math.min(numGroups, 4);

    const positions = new Map<number, { left: string; top: string }>();
    visibleTabs.forEach((tab) => {
      const assignment = groupAssignments.get(tab.id);
      if (assignment) {
        const col = assignment.groupIndex % 4;
        const row = assignment.positionInGroup;
        positions.set(tab.id, {
          left: `${col * colWidth + colWidth / 2}%`,
          top: `${12 + row * 5}%`,
        });
      }
    });
    return { positions, groupLabels, numGroups, colWidth };
  }, [groupAssignments, visibleTabs]);

  // Pick position set based on phase
  const getPosition = (tab: TabInfo, index: number) => {
    if (phase === "resolved" && resolvedPositions?.positions.has(tab.id)) {
      return resolvedPositions.positions.get(tab.id)!;
    }
    if (phase === "coalescing") {
      return coalescingPositions[index];
    }
    return chaosPositions[index];
  };

  return (
    <div className={`gt-chaos gt-chaos--${phase}`}>
      {/* Progress bar */}
      <div className="gt-chaos__progress" />

      {/* Group labels (resolved only) */}
      {phase === "resolved" &&
        resolvedPositions &&
        resolvedPositions.groupLabels.map((label, gi) => {
          if (!label) return null;
          const col = gi % 4;
          return (
            <div
              key={`label-${gi}`}
              className="gt-chaos-label"
              style={{
                left: `${col * resolvedPositions.colWidth + resolvedPositions.colWidth / 2}%`,
                top: "4%",
              }}
            >
              {label}
            </div>
          );
        })}

      {/* Tab tiles */}
      {visibleTabs.map((tab, i) => {
        const pos = getPosition(tab, i);
        const domain = (() => {
          try {
            return new URL(tab.url).hostname.replace("www.", "");
          } catch {
            return "";
          }
        })();

        return (
          <div
            key={tab.id}
            className="gt-chaos-tile"
            style={{
              left: pos.left,
              top: pos.top,
              backgroundColor:
                phase === "resolved" ? "transparent" : SKELETON_COLORS[i % SKELETON_COLORS.length],
              animationDelay: `${(i * 0.07) % 3}s`,
            }}
          >
            <img
              src={tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
              alt=""
              width={16}
              height={16}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="gt-chaos-tile__title">{tab.title}</span>
          </div>
        );
      })}
    </div>
  );
}

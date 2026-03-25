import type React from "react";
import { useState } from "react";
import type { TabGroup as TabGroupType } from "../types";
import { TabCard } from "./TabCard";

interface TabGroupProps {
  group: TabGroupType;
  rank: number;
  isExpanded: boolean;
  onToggle: (groupId: string) => void;
  onFocusTab: (tabId: number) => void;
  onCloseTab: (tabId: number) => void;
  style?: React.CSSProperties;
  measureRef?: (node: HTMLDivElement | null) => void;
}

export function TabGroupCard({
  group,
  rank,
  isExpanded,
  onToggle,
  onFocusTab,
  onCloseTab,
  style,
  measureRef,
}: TabGroupProps) {
  const totalTabs =
    group.tabs.length + (group.children?.reduce((sum, c) => sum + c.tabs.length, 0) ?? 0);

  // All tabs flattened for favicon strip
  const allTabs = [...group.tabs, ...(group.children?.flatMap((c) => c.tabs) ?? [])];

  const rankClass = rank < 3 ? `gt-group--rank-${rank}` : "";

  return (
    <div
      className={`gt-group ${rankClass} ${isExpanded ? "gt-group--expanded" : ""}`}
      style={style}
      ref={measureRef}
      data-group-id={group.id}
    >
      <button
        className="gt-group__header"
        onClick={() => onToggle(group.id)}
        aria-expanded={isExpanded}
      >
        <div className="gt-group__titles">
          <h2 className="gt-group__label">{group.label}</h2>
          {isExpanded && group.sublabel && (
            <span className="gt-group__sublabel">{group.sublabel}</span>
          )}
        </div>
        <div className="gt-group__meta">
          {/* Favicon strip when collapsed */}
          {!isExpanded && allTabs.length > 0 && (
            <div className="gt-group__favicons">
              {allTabs.slice(0, 6).map((tab) => {
                const domain = (() => {
                  try {
                    return new URL(tab.url).hostname.replace("www.", "");
                  } catch {
                    return "";
                  }
                })();
                return (
                  <img
                    key={tab.id}
                    className="gt-group__favicon"
                    src={
                      tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                    }
                    alt=""
                    width={16}
                    height={16}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                );
              })}
              {allTabs.length > 6 && (
                <span className="gt-group__favicon-overflow">+{allTabs.length - 6}</span>
              )}
            </div>
          )}
          <span className="gt-group__count">{totalTabs}</span>
        </div>
      </button>

      {/* Expand region — animated via grid-template-rows */}
      <div className="gt-group__expand-region">
        <div className="gt-group__expand-inner">
          <div className="gt-group__body">
            {/* Hero tab (first tab, featured) */}
            {group.tabs.length > 0 && (
              <>
                <TabCard
                  tab={group.tabs[0]}
                  onFocus={onFocusTab}
                  onClose={onCloseTab}
                  featured={rank < 3}
                />
                {/* Remaining tabs */}
                {group.tabs.length > 1 && (
                  <div className="gt-group__tabs">
                    {group.tabs.slice(1).map((tab) => (
                      <TabCard key={tab.id} tab={tab} onFocus={onFocusTab} onClose={onCloseTab} />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Subcategories */}
            {group.children?.map((child) => (
              <ChildGroup
                key={child.id}
                group={child}
                onFocusTab={onFocusTab}
                onCloseTab={onCloseTab}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChildGroup({
  group,
  onFocusTab,
  onCloseTab,
}: {
  group: TabGroupType;
  onFocusTab: (tabId: number) => void;
  onCloseTab: (tabId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="gt-child-group">
      <button
        className="gt-child-group__header"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        <span className="gt-child-group__label">
          {group.label}
          {group.sublabel && <span className="gt-child-group__sublabel"> / {group.sublabel}</span>}
        </span>
        <span className="gt-child-group__count">{group.tabs.length}</span>
      </button>

      {expanded && (
        <div className="gt-child-group__tabs">
          {group.tabs.map((tab) => (
            <TabCard key={tab.id} tab={tab} onFocus={onFocusTab} onClose={onCloseTab} />
          ))}
        </div>
      )}
    </div>
  );
}

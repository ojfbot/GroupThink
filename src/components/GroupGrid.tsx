import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLLAPSED_SPAN, GAP_SPANS, ROW_UNIT } from "../lib/grid-constants";
import type { GroupingResponse, TabGroup } from "../types";
import { TabGroupCard } from "./TabGroup";

interface GroupGridProps {
  grouping: GroupingResponse;
  onFocusTab: (tabId: number) => void;
  onCloseTab: (tabId: number) => void;
}

function countGroupTabs(g: TabGroup): number {
  return g.tabs.length + (g.children?.reduce((s, c) => s + c.tabs.length, 0) ?? 0);
}

export function GroupGrid({ grouping, onFocusTab, onCloseTab }: GroupGridProps) {
  // Sort by tab count descending — rank is index after sort
  const sorted = useMemo(
    () =>
      [...grouping.groups]
        .map((g) => ({ group: g, count: countGroupTabs(g) }))
        .sort((a, b) => b.count - a.count),
    [grouping.groups],
  );

  // One-at-a-time expansion: auto-expand rank-0 on initial render
  const [expandedId, setExpandedId] = useState<string | null>(() =>
    sorted.length > 0 ? sorted[0].group.id : null,
  );

  // Measured span for the expanded card
  const [expandedSpan, setExpandedSpan] = useState(COLLAPSED_SPAN);
  const expandedNodeRef = useRef<HTMLDivElement | null>(null);

  // Callback ref — attached only to the currently expanded card
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    expandedNodeRef.current = node;
  }, []);

  // ResizeObserver on the expanded card
  useEffect(() => {
    const node = expandedNodeRef.current;
    if (!node || !expandedId) {
      setExpandedSpan(COLLAPSED_SPAN);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      requestAnimationFrame(() => {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        setExpandedSpan(Math.ceil(h / ROW_UNIT) + GAP_SPANS);
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [expandedId]);

  const handleToggle = (groupId: string) => {
    setExpandedId((prev) => (prev === groupId ? null : groupId));
  };

  if (grouping.groups.length === 0 && grouping.ungrouped.length === 0) {
    return (
      <div className="gt-empty">
        <p className="gt-empty__headline">Nothing to see here.</p>
        <p className="gt-empty__sub">Open some tabs and let the mind expand.</p>
      </div>
    );
  }

  return (
    <div className="gt-grid">
      {sorted.map(({ group }, rank) => {
        const isExp = expandedId === group.id;
        const span = isExp ? expandedSpan : COLLAPSED_SPAN;
        return (
          <TabGroupCard
            key={group.id}
            group={group}
            rank={rank}
            isExpanded={isExp}
            onToggle={handleToggle}
            onFocusTab={onFocusTab}
            onCloseTab={onCloseTab}
            style={{ gridRow: `span ${span}` }}
            measureRef={isExp ? measureRef : undefined}
          />
        );
      })}

      {/* Stragglers — inline masonry item */}
      {grouping.ungrouped.length > 0 &&
        (() => {
          const isStragglersExp = expandedId === "__stragglers";
          const stragglersSpan = isStragglersExp ? expandedSpan : COLLAPSED_SPAN;
          return (
            <div
              className={`gt-group gt-group--stragglers ${isStragglersExp ? "gt-group--expanded" : ""}`}
              onClick={() => handleToggle("__stragglers")}
              style={{ gridRow: `span ${stragglersSpan}` }}
              ref={isStragglersExp ? measureRef : undefined}
              data-group-id="__stragglers"
            >
              <div className="gt-group__header">
                <div className="gt-group__titles">
                  <h2 className="gt-group__label">Loose Tabs</h2>
                </div>
                <div className="gt-group__meta">
                  {!isStragglersExp && (
                    <div className="gt-group__favicons">
                      {grouping.ungrouped.slice(0, 6).map((tab) => {
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
                              tab.favIconUrl ||
                              `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
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
                      {grouping.ungrouped.length > 6 && (
                        <span className="gt-group__favicon-overflow">
                          +{grouping.ungrouped.length - 6}
                        </span>
                      )}
                    </div>
                  )}
                  <span className="gt-group__count">{grouping.ungrouped.length}</span>
                </div>
              </div>
              <div className="gt-group__expand-region">
                <div className="gt-group__expand-inner">
                  <div className="gt-group__body">
                    <div className="gt-group__tabs">
                      {grouping.ungrouped.map((tab) => {
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
                            className="gt-tab-card"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFocusTab(tab.id);
                            }}
                          >
                            <img
                              className="gt-tab-card__favicon"
                              src={
                                tab.favIconUrl ||
                                `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                              }
                              alt=""
                              width={16}
                              height={16}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                            <div className="gt-tab-card__info">
                              <span className="gt-tab-card__title">{tab.title}</span>
                              <span className="gt-tab-card__domain">{domain}</span>
                            </div>
                            <button
                              className="gt-tab-card__close"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseTab(tab.id);
                              }}
                              aria-label="Close tab"
                            >
                              &times;
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

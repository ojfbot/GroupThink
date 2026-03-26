import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeUnifiedLayout } from "../lib/treemap-layout";
import type { GroupingResponse } from "../types";
import { TreemapBreadcrumb } from "./TreemapBreadcrumb";
import { TreemapNode } from "./TreemapNode";

interface TreemapViewProps {
  grouping: GroupingResponse;
  onFocusTab: (tabId: number) => void;
  onCloseTab: (tabId: number) => void;
  onReady?: () => void;
  requestedFocusLabel?: string;
  requestedChildLabel?: string;
  onFocusDismissed?: () => void;
}

export function TreemapView({
  grouping,
  onFocusTab,
  onCloseTab,
  onReady,
  requestedFocusLabel,
  requestedChildLabel,
  onFocusDismissed,
}: TreemapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  const [focusedChildId, setFocusedChildId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const onReadyRef = useRef(onReady);

  const isDark = useMemo(() => {
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, []);

  // Keep ref in sync
  onReadyRef.current = onReady;

  // ResizeObserver
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let firedReady = false;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      if (!firedReady && width > 0 && height > 0) {
        firedReady = true;
        setReady(true);
        onReadyRef.current?.();
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Auto-focus when chat requests it
  useEffect(() => {
    if (!requestedFocusLabel) return;
    const normalizedReq = requestedFocusLabel.toLowerCase();
    const match = grouping.groups.find((g) => g.label.toLowerCase() === normalizedReq);
    if (match) {
      setFocusedGroupId(match.id);
      // If a child label is also requested, find and focus it
      if (requestedChildLabel && match.children) {
        const normalizedChild = requestedChildLabel.toLowerCase();
        const childMatch = match.children.find((c) => c.label.toLowerCase() === normalizedChild);
        if (childMatch) {
          setFocusedChildId(childMatch.id);
        } else {
          setFocusedChildId(null);
        }
      } else {
        setFocusedChildId(null);
      }
    }
  }, [requestedFocusLabel, requestedChildLabel, grouping.groups]);

  const zoomOut = useCallback(() => {
    if (focusedChildId) {
      setFocusedChildId(null);
      return;
    }
    setFocusedGroupId(null);
    onFocusDismissed?.();
  }, [focusedChildId, onFocusDismissed]);

  // Escape → zoom out (child first, then group)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (focusedChildId) {
          setFocusedChildId(null);
        } else if (focusedGroupId) {
          zoomOut();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [focusedGroupId, focusedChildId, zoomOut]);

  // Single unified layout
  const nodes = useMemo(
    () => computeUnifiedLayout(grouping, size.width, size.height, focusedGroupId, focusedChildId),
    [grouping, size.width, size.height, focusedGroupId, focusedChildId],
  );

  // Find focused group/child labels for breadcrumb
  const focusedLabel = useMemo(() => {
    if (!focusedGroupId) return "";
    if (focusedGroupId === "__stragglers") return "Loose Tabs";
    return grouping.groups.find((g) => g.id === focusedGroupId)?.label ?? "";
  }, [focusedGroupId, grouping]);

  const focusedChildLabel = useMemo(() => {
    if (!focusedChildId || !focusedGroupId) return "";
    const group = grouping.groups.find((g) => g.id === focusedGroupId);
    return group?.children?.find((c) => c.id === focusedChildId)?.label ?? "";
  }, [focusedChildId, focusedGroupId, grouping]);

  const handleClickGroup = useCallback(
    (groupId: string) => {
      if (focusedGroupId) {
        const focusedGroup = grouping.groups.find((g) => g.id === focusedGroupId);
        const isChild =
          focusedGroup?.children?.some((c) => c.id === groupId) ||
          groupId === `${focusedGroupId}__direct`;

        if (isChild) {
          // Toggle child focus within the focused group
          if (focusedChildId === groupId) {
            setFocusedChildId(null);
          } else {
            setFocusedChildId(groupId);
          }
          return;
        }

        // Check if this is a child of a sibling group — navigate to the parent
        const siblingParent = grouping.groups.find(
          (g) => g.id !== focusedGroupId && g.children?.some((c) => c.id === groupId),
        );
        if (siblingParent) {
          setFocusedGroupId(siblingParent.id);
          setFocusedChildId(null);
          return;
        }

        if (groupId !== focusedGroupId) {
          // Sibling group navigation — direct jump
          setFocusedGroupId(groupId);
          setFocusedChildId(null);
        } else {
          // Click focused group header → zoom out
          zoomOut();
        }
      } else {
        // Overview → zoom in
        setFocusedGroupId(groupId);
        setFocusedChildId(null);
      }
    },
    [focusedGroupId, focusedChildId, grouping, zoomOut],
  );

  return (
    <div
      className={`gt-treemap ${ready ? "gt-treemap--ready" : "gt-treemap--entering"}`}
      ref={containerRef}
    >
      {focusedGroupId && (
        <TreemapBreadcrumb
          groupLabel={focusedLabel}
          childLabel={focusedChildLabel || undefined}
          onBack={() => {
            setFocusedChildId(null);
            setFocusedGroupId(null);
            onFocusDismissed?.();
          }}
          onBackToGroup={() => setFocusedChildId(null)}
        />
      )}

      <div className="gt-treemap__canvas">
        {nodes.map((node) => (
          <TreemapNode
            key={node.id}
            node={node}
            isDark={isDark}
            isFocused={node.kind === "group" && node.id === focusedGroupId}
            onClickGroup={handleClickGroup}
            onFocusTab={onFocusTab}
            onCloseTab={onCloseTab}
          />
        ))}
      </div>
    </div>
  );
}

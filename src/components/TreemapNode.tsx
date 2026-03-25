import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  childBorderColor,
  childTileGradient,
  tabTileGradient,
  tileBorderColor,
  tileGradient,
} from "../lib/treemap-colors";
import type { NodeRect } from "../lib/treemap-layout";
import { TabPreview } from "./TabPreview";

interface TreemapNodeProps {
  node: NodeRect;
  isDark: boolean;
  isFocused: boolean;
  onClickGroup: (id: string) => void;
  onFocusTab: (id: number) => void;
  onCloseTab: (id: number) => void;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

export function TreemapNode({
  node,
  isDark,
  isFocused,
  onClickGroup,
  onFocusTab,
  onCloseTab,
}: TreemapNodeProps) {
  const gradient = useMemo(() => {
    if (node.kind === "child-group") return childTileGradient(node.colorIndex, isDark);
    if (node.kind === "tab") return tabTileGradient(node.colorIndex, isDark);
    return tileGradient(node.colorIndex, isDark);
  }, [node.colorIndex, node.kind, isDark]);

  const borderColor = useMemo(() => {
    if (node.kind === "child-group") return childBorderColor(node.colorIndex, isDark);
    return tileBorderColor(node.colorIndex, isDark);
  }, [node.colorIndex, node.kind, isDark]);

  const { x, y, w, h } = node.rect;

  const classList = [
    "gt-node",
    `gt-node--${node.kind}`,
    isFocused ? "gt-node--focused" : "",
    node.opacity < 1 ? "gt-node--dimmed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (node.kind === "group") {
    return (
      <GroupContent
        node={node}
        classList={classList}
        x={x}
        y={y}
        w={w}
        h={h}
        gradient={gradient}
        borderColor={borderColor}
        isFocused={isFocused}
        onClickGroup={onClickGroup}
      />
    );
  }

  if (node.kind === "child-group") {
    return (
      <ChildGroupContent
        node={node}
        classList={classList}
        x={x}
        y={y}
        w={w}
        h={h}
        gradient={gradient}
        borderColor={borderColor}
        onClickGroup={onClickGroup}
      />
    );
  }

  return (
    <TabContent
      node={node}
      classList={classList}
      x={x}
      y={y}
      w={w}
      h={h}
      gradient={gradient}
      borderColor={borderColor}
      onFocusTab={onFocusTab}
      onCloseTab={onCloseTab}
    />
  );
}

// ── Group rendering ──

function GroupContent({
  node,
  classList,
  x,
  y,
  w,
  h,
  gradient,
  borderColor,
  isFocused,
  onClickGroup,
}: {
  node: NodeRect;
  classList: string;
  x: number;
  y: number;
  w: number;
  h: number;
  gradient: string;
  borderColor: string;
  isFocused: boolean;
  onClickGroup: (id: string) => void;
}) {
  const group = node.group!;
  const isDimmed = node.opacity < 1;

  const allTabs = useMemo(
    () => [...group.tabs, ...(group.children?.flatMap((c) => c.tabs) ?? [])],
    [group],
  );

  const tabCount = allTabs.length;

  return (
    <button
      className={classList}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: gradient,
        borderColor,
        opacity: node.opacity,
        zIndex: isFocused ? 0 : undefined,
      }}
      onClick={() => onClickGroup(group.id)}
      data-node-id={node.id}
      data-group-id={group.id}
    >
      <span
        className={`gt-node__label ${isFocused ? "gt-node__label--focused" : ""}`}
        style={h < 30 || w < 60 ? { fontSize: "9px" } : undefined}
      >
        {group.label}
      </span>

      {!isFocused && h > 32 && w > 50 && <span className="gt-node__count">{tabCount}</span>}

      {!isDimmed && !isFocused && h > 50 && w > 80 && allTabs.length > 0 && (
        <div className="gt-node__favicons">
          {allTabs.slice(0, 6).map((tab) => (
            <img
              key={tab.id}
              className="gt-node__favicon"
              src={
                tab.favIconUrl ||
                `https://www.google.com/s2/favicons?domain=${getDomain(tab.url)}&sz=32`
              }
              alt=""
              width={14}
              height={14}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ))}
          {allTabs.length > 6 && (
            <span className="gt-node__favicon-overflow">+{allTabs.length - 6}</span>
          )}
        </div>
      )}

      {!isDimmed && h > 100 && group.sublabel && (
        <span className="gt-node__sublabel">{group.sublabel}</span>
      )}
    </button>
  );
}

// ── Child group rendering ──

function ChildGroupContent({
  node,
  classList,
  x,
  y,
  w,
  h,
  gradient,
  borderColor,
  onClickGroup,
}: {
  node: NodeRect;
  classList: string;
  x: number;
  y: number;
  w: number;
  h: number;
  gradient: string;
  borderColor: string;
  onClickGroup: (id: string) => void;
}) {
  const group = node.group!;

  return (
    <div
      className={classList}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: gradient,
        borderColor,
      }}
      onClick={() => onClickGroup(group.id)}
      data-node-id={node.id}
    >
      <span
        className="gt-node__child-label"
        style={w < 80 || h < 30 ? { fontSize: "8px" } : undefined}
      >
        {group.label}
        {w > 60 && group.sublabel && (
          <span className="gt-node__child-sublabel"> / {group.sublabel}</span>
        )}
      </span>
    </div>
  );
}

// ── Tab rendering ──

function TabContent({
  node,
  classList,
  x,
  y,
  w,
  h,
  gradient,
  borderColor,
  onFocusTab,
  onCloseTab,
}: {
  node: NodeRect;
  classList: string;
  x: number;
  y: number;
  w: number;
  h: number;
  gradient: string;
  borderColor: string;
  onFocusTab: (id: number) => void;
  onCloseTab: (id: number) => void;
}) {
  const tab = node.tab!;
  const isMicro = node.opacity < 1;
  const domain = useMemo(() => getDomain(tab.url), [tab.url]);
  const nodeRef = useRef<HTMLDivElement>(null);

  const [hovered, setHovered] = useState(false);
  const [capturedThumb, setCapturedThumb] = useState<string | null>(null);
  const [anchorScreen, setAnchorScreen] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

  const onEnter = useCallback(() => {
    if (isMicro) return;
    hoverTimer.current = setTimeout(() => {
      if (nodeRef.current) {
        const r = nodeRef.current.getBoundingClientRect();
        setAnchorScreen({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      setHovered(true);

      // Request on-demand capture if no thumbnail yet
      if (!tab.thumbnail && !capturedThumb) {
        chrome.runtime
          .sendMessage({ type: "capture-tab", tabId: tab.id })
          .then((res: { thumbnail?: string | null }) => {
            if (res?.thumbnail) setCapturedThumb(res.thumbnail);
          })
          .catch(() => {});
      }
    }, 200);
  }, [tab.thumbnail, tab.id, capturedThumb, isMicro]);

  const onLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setHovered(false);
  }, []);

  // Micro gutter tabs — minimal tile with favicon only
  if (isMicro) {
    return (
      <div
        className={`${classList} gt-node--micro`}
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          background: gradient,
          borderColor,
          opacity: node.opacity,
        }}
        onClick={() => onFocusTab(tab.id)}
        data-node-id={node.id}
      >
        {w > 10 && h > 10 && (
          <img
            className="gt-node__tab-favicon gt-node__tab-favicon--micro"
            src={tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
            alt=""
            width={12}
            height={12}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={nodeRef}
      className={classList}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: gradient,
        borderColor,
      }}
      onClick={() => onFocusTab(tab.id)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      data-node-id={node.id}
    >
      <img
        className="gt-node__tab-favicon"
        src={tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        alt=""
        width={16}
        height={16}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />

      {h > 32 && <span className="gt-node__tab-title">{tab.title}</span>}

      {h > 44 && tab.description && <span className="gt-node__tab-desc">{tab.description}</span>}

      {h > 56 && <span className="gt-node__tab-domain">{domain}</span>}

      {h > 64 && w > 120 && tab.tags && tab.tags.length > 0 && (
        <div className="gt-node__tab-tags">
          {tab.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="gt-tag"
              style={{ backgroundColor: `hsl(${node.colorIndex * 47 + 200}, 25%, ${40}%)` }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <button
        className="gt-node__tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onCloseTab(tab.id);
        }}
        aria-label="Close tab"
      >
        &times;
      </button>

      {hovered &&
        createPortal(
          <TabPreview
            tab={capturedThumb ? { ...tab, thumbnail: capturedThumb } : tab}
            anchorRect={anchorScreen}
            containerRect={{ width: window.innerWidth, height: window.innerHeight }}
          />,
          document.body,
        )}
    </div>
  );
}

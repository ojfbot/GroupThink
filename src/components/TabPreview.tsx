import { useMemo } from "react";
import type { TabInfo } from "../types";

interface TabPreviewProps {
  tab: TabInfo;
  anchorRect: { x: number; y: number; w: number; h: number };
  containerRect: { width: number; height: number };
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname}${path}${u.search}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

export function TabPreview({ tab, anchorRect, containerRect }: TabPreviewProps) {
  const domain = useMemo(() => getDomain(tab.url), [tab.url]);
  const fullUrl = useMemo(() => formatUrl(tab.url), [tab.url]);

  const previewW = 400;
  const previewH = tab.thumbnail ? 280 : 180;

  const left = Math.max(
    4,
    Math.min(anchorRect.x + anchorRect.w / 2 - previewW / 2, containerRect.width - previewW - 4),
  );

  const aboveY = anchorRect.y - previewH - 8;
  const belowY = anchorRect.y + anchorRect.h + 8;
  const top = aboveY >= 4 ? aboveY : belowY;

  return (
    <div className="gt-preview" style={{ left, top, width: previewW }}>
      {tab.thumbnail ? (
        /* PiP mode: screenshot hero with scrim overlay */
        <div className="gt-preview__pip">
          <img className="gt-preview__thumb" src={tab.thumbnail} alt="" draggable={false} />
          <div className="gt-preview__scrim">
            <div className="gt-preview__header">
              <span className="gt-preview__title">{tab.title}</span>
              {tab.pinned && <span className="gt-preview__badge">Pinned</span>}
            </div>
            {tab.description && <span className="gt-preview__desc">{tab.description}</span>}
            <span className="gt-preview__url">{fullUrl}</span>
          </div>
        </div>
      ) : (
        /* Fallback: large favicon + domain, info section below */
        <>
          <div className="gt-preview__fallback">
            <img
              className="gt-preview__favicon"
              src={tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              width={48}
              height={48}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="gt-preview__fallback-domain">{domain}</span>
          </div>
          <div className="gt-preview__info">
            <div className="gt-preview__header">
              <span className="gt-preview__title">{tab.title}</span>
              {tab.pinned && <span className="gt-preview__badge">Pinned</span>}
            </div>
            {tab.description && <span className="gt-preview__desc">{tab.description}</span>}
            <span className="gt-preview__url">{fullUrl}</span>
          </div>
        </>
      )}
    </div>
  );
}

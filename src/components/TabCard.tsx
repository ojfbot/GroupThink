import type { TabInfo } from "../types";

interface TabCardProps {
  tab: TabInfo;
  onFocus: (tabId: number) => void;
  onClose: (tabId: number) => void;
  featured?: boolean;
}

export function TabCard({ tab, onFocus, onClose, featured }: TabCardProps) {
  const domain = (() => {
    try {
      return new URL(tab.url).hostname.replace("www.", "");
    } catch {
      return "";
    }
  })();

  const faviconSize = featured ? 24 : 16;

  return (
    <div
      className={`gt-tab-card ${featured ? "gt-tab-card--featured" : ""}`}
      onClick={() => onFocus(tab.id)}
    >
      <img
        className="gt-tab-card__favicon"
        src={tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        alt=""
        width={faviconSize}
        height={faviconSize}
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
          onClose(tab.id);
        }}
        aria-label="Close tab"
      >
        &times;
      </button>
    </div>
  );
}

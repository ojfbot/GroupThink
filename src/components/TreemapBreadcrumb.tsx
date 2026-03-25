interface TreemapBreadcrumbProps {
  groupLabel: string;
  childLabel?: string;
  onBack: () => void;
  onBackToGroup?: () => void;
}

export function TreemapBreadcrumb({
  groupLabel,
  childLabel,
  onBack,
  onBackToGroup,
}: TreemapBreadcrumbProps) {
  return (
    <nav className="gt-breadcrumb">
      <button className="gt-breadcrumb__back" onClick={onBack}>
        All Groups
      </button>
      <span className="gt-breadcrumb__sep">/</span>
      {childLabel ? (
        <>
          <button className="gt-breadcrumb__back" onClick={onBackToGroup}>
            {groupLabel}
          </button>
          <span className="gt-breadcrumb__sep">/</span>
          <span className="gt-breadcrumb__current">{childLabel}</span>
        </>
      ) : (
        <span className="gt-breadcrumb__current">{groupLabel}</span>
      )}
    </nav>
  );
}

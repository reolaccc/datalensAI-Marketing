const NAV_ITEMS = [
  { label: "Overview", targetId: "report-overview" },
  { label: "Charts", targetId: "chart-grid" },
  { label: "Data", targetId: "dataset-summary" },
  { label: "Sessions", targetId: "session-directory" }
];

function scrollToId(targetId: string) {
  document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function LeftNav() {
  return (
    <nav className="left-nav panel">
      <div>
        <p className="eyebrow">Navigation</p>
      </div>

      <div className="left-nav-list">
        {NAV_ITEMS.map((item) => (
          <button className="left-nav-item" key={item.targetId} onClick={() => scrollToId(item.targetId)} type="button">
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

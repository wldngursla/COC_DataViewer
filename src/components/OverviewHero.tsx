export function OverviewHero({ fileName }: { fileName: string }) {
  return <header className="overview-hero">
    <div><span className="eyebrow">YOUR DRIVE, DECODED</span><h1>주행을 한눈에.</h1><p>차량의 움직임부터 배터리 에너지까지.<br/>이번 주행의 모든 순간을 살펴보세요.</p></div>
    <div className="run-file-card"><span className="run-file-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 3h10l6 6v20H7V3h2z M19 3v7h6 M11 17h10 M11 22h7"/></svg></span><div><small>CURRENT RUN</small><strong>{fileName}</strong><span>이 기기에서 안전하게 분석 중</span></div></div>
  </header>;
}

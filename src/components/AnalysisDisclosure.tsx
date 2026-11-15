import { useState, type ReactNode } from 'react';
/** Mount charts only after opening, so ECharts never initializes in a hidden box. */
export function AnalysisDisclosure({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="analysis-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span className="disclosure-icon" aria-hidden="true">⌘</span><span><strong>{title}</strong><small>{description}</small></span><span className="disclosure-chevron" aria-hidden="true">⌄</span></summary>
    {open && <div className="disclosure-content">{children}</div>}
  </details>;
}

/** Top navigation for the five implemented V1 analysis pages. */

export type ViewId = 'load' | 'overview' | 'graphs' | 'vehicle' | 'battery' | 'health';

interface NavTab {
  id: ViewId;
  label: string;
}

const TABS: NavTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'graphs', label: 'Graphs' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'battery', label: 'Battery' },
  { id: 'health', label: 'Data Health' },
];

interface AppNavProps {
  active: ViewId;
  /** tabs stay disabled until a run is parsed */
  runLoaded: boolean;
  onSelect: (view: ViewId) => void;
}

export function AppNav({ active, runLoaded, onSelect }: AppNavProps) {
  return (
    <nav className="app-nav" aria-label="분석 화면">
      {TABS.map((tab) => {
        const disabled = !runLoaded;
        return (
          <button
            key={tab.id}
            type="button"
            className={`nav-tab${active === tab.id ? ' nav-tab-active' : ''}`}
            disabled={disabled}
            title={!runLoaded ? '먼저 .log 파일을 로드하세요' : undefined}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

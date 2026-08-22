/**
 * Top navigation. Only Overview is functional in this stage — the remaining
 * tabs are visible but disabled ("Coming soon") so the V1 information
 * architecture is already in place.
 */

export type ViewId = 'load' | 'overview' | 'graphs' | 'vehicle' | 'battery' | 'health';

interface NavTab {
  id: ViewId;
  label: string;
  comingSoon: boolean;
}

const TABS: NavTab[] = [
  { id: 'overview', label: 'Overview', comingSoon: false },
  { id: 'graphs', label: 'Graphs', comingSoon: true },
  { id: 'vehicle', label: 'Vehicle', comingSoon: true },
  { id: 'battery', label: 'Battery', comingSoon: true },
  { id: 'health', label: 'Data Health', comingSoon: true },
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
        const disabled = tab.comingSoon || !runLoaded;
        return (
          <button
            key={tab.id}
            type="button"
            className={`nav-tab${active === tab.id ? ' nav-tab-active' : ''}`}
            disabled={disabled}
            title={tab.comingSoon ? 'Coming soon' : !runLoaded ? '먼저 .log 파일을 로드하세요' : undefined}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            {tab.comingSoon && <span className="nav-soon">soon</span>}
          </button>
        );
      })}
    </nav>
  );
}

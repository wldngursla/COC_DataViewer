import { useState } from 'react';
import './App.css';
import type { ViewId } from './components/AppNav';
import { AppNav } from './components/AppNav';
import type { LoadedRun } from './state/loadedRun';
import { FileLoadPage } from './pages/FileLoadPage';
import { OverviewPage } from './pages/OverviewPage';
import { GraphsPage } from './pages/GraphsPage';
import { DataHealthPage } from './pages/DataHealthPage';

function App() {
  // 파싱 결과는 App이 소유한다 — 탭을 오가도 같은 run을 재파싱 없이 공유
  const [run, setRun] = useState<LoadedRun | null>(null);
  const [view, setView] = useState<ViewId>('load');

  const handleLoaded = (loaded: LoadedRun) => {
    setRun(loaded);
    setView('overview');
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          COC <span className="app-title-accent">Data Viewer</span>
        </div>
        <AppNav active={view} runLoaded={run !== null} onSelect={setView} />
        <div className="app-header-right">
          {run !== null && (
            <button type="button" className="btn-file" onClick={() => setView('load')}>
              <span className="btn-file-name">{run.fileName}</span> · 파일
            </button>
          )}
          <div className="app-meta">V1 · offline</div>
        </div>
      </header>

      {view === 'load' || run === null ? (
        <FileLoadPage run={run} onLoaded={handleLoaded} />
      ) : view === 'graphs' ? (
        <GraphsPage run={run} />
      ) : view === 'health' ? (
        <DataHealthPage run={run} />
      ) : (
        <OverviewPage run={run} />
      )}
    </div>
  );
}

export default App;

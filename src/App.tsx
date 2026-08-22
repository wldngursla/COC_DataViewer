import './App.css';
import { FileLoadPage } from './pages/FileLoadPage';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          COC <span className="app-title-accent">Data Viewer</span>
        </div>
        <div className="app-meta">V1 · offline · protocol v1</div>
      </header>
      <FileLoadPage />
    </div>
  );
}

export default App;

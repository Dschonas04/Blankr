import { useEffect } from 'react';
import { useStore, setState, undo, redo, loadSaved } from './store';
import { connect } from './collab';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import PropertiesBar from './components/PropertiesBar';
import ActionBar from './components/ActionBar';
import ZoomControls from './components/ZoomControls';
import LayerPanel from './components/LayerPanel';
import StickyNotes from './components/StickyNotes';
import Toast from './components/Toast';
import CollabBar from './components/CollabBar';

export default function App() {
  const darkMode = useStore(s => s.darkMode);
  const fullscreen = useStore(s => s.fullscreen);

  /* Sync dark mode to <body> */
  useEffect(() => {
    document.body.dataset.theme = darkMode ? 'dark' : 'light';
  }, [darkMode]);

  /* Sync fullscreen class */
  useEffect(() => {
    document.body.classList.toggle('fullscreen', fullscreen);
  }, [fullscreen]);

  /* Load saved state + check URL for collab room */
  useEffect(() => {
    loadSaved();
    const room = new URLSearchParams(location.search).get('room');
    if (room) connect(room);
  }, []);

  /* Global keyboard shortcuts */
  useEffect(() => {
    function onKey(e) {
      const tag = e.target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || e.target.isContentEditable) return;
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }

      if (e.code === 'Space') return; // handled by Canvas

      switch (e.key.toLowerCase()) {
        case 'p': setState({ tool: 'pen' }); break;
        case 'l': setState({ tool: 'line' }); break;
        case 'a': setState({ tool: 'arrow' }); break;
        case 'r': setState({ tool: 'rect' }); break;
        case 'o': setState({ tool: 'circle' }); break;
        case 't': setState({ tool: 'text' }); break;
        case 'e': setState({ tool: 'eraser' }); break;
        case 'z': if (!cmd) setState({ tool: 'laser' }); break;
        case 'h': setState({ tool: 'hand' }); break;
        case 'f': if (!cmd) setState(s => ({ fullscreen: !s.fullscreen })); break;
        case 'd': if (!cmd) setState(s => ({ darkMode: !s.darkMode })); break;
        case 'escape': setState({ fullscreen: false }); break;
        default: break;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Canvas />
      <StickyNotes />

      {/* Brand */}
      <div className="ui-brand">
        <svg className="brand-logo" viewBox="0 0 28 28" width="28" height="28">
          <rect x="3" y="3" width="22" height="22" rx="6" fill="none" stroke="url(#bgrad)" strokeWidth="2.5" />
          <defs>
            <linearGradient id="bgrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>
        </svg>
        <span className="brand-text">Blankr</span>
      </div>

      <Toolbar />
      <PropertiesBar />
      <ActionBar />
      <ZoomControls />
      <LayerPanel />
      <CollabBar />
      <Toast />
    </>
  );
}

import { useEffect } from 'react';
import { useStore, setState, undo, redo, loadSaved } from './store';
import { freigabeAusAdresse, sitzungOeffnen } from './collab';
import { api } from './api';
import Anmeldung from './components/Anmeldung';
import FreigabeDialog from './components/FreigabeDialog';
import KontoDialog from './components/KontoDialog';
import Rechtliches, { FussLinks } from './components/Rechtliches';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import PropertiesBar from './components/PropertiesBar';
import ActionBar from './components/ActionBar';
import ZoomControls from './components/ZoomControls';
import LayerPanel from './components/LayerPanel';
import StickyNotes from './components/StickyNotes';
import Toast from './components/Toast';
import CollabBar from './components/CollabBar';
import ContextMenu from './components/ContextMenu';
import ChatPanel from './components/ChatPanel';
import BoardPicker from './components/BoardPicker';

export default function App() {
  const darkMode = useStore(s => s.darkMode);
  const fullscreen = useStore(s => s.fullscreen);
  const auth = useStore(s => s.auth);
  const anmeldungNoetig = useStore(s => s.anmeldungNoetig);
  const linkUngueltig = useStore(s => s.linkUngueltig);
  const nurLesen = useStore(s => s.nurLesen);
  const kontoId = auth?.konto?.id;
  const freigabe = freigabeAusAdresse();

  /* Zuerst fragen, wer man ist. Ohne erreichbaren Server bleibt nur der
     lokale Stand in diesem Browser. */
  useEffect(() => {
    api('/api/status')
      .then((status) => setState({ auth: status }))
      .catch(() => setState({ auth: { offline: true } }));
  }, []);

  /* Sync dark mode to <body> */
  useEffect(() => {
    document.body.dataset.theme = darkMode ? 'dark' : 'light';
  }, [darkMode]);

  /* Wer nur ansehen darf, sieht die Knoepfe nicht, die etwas aendern. */
  useEffect(() => {
    document.body.classList.toggle('nur-lesen', nurLesen);
  }, [nurLesen]);

  /* Sync fullscreen class */
  useEffect(() => {
    document.body.classList.toggle('fullscreen', fullscreen);
  }, [fullscreen]);

  /* Der Aufruf der Seite ist bereits die Sitzung: ein Freigabe-Link, ein
     eigenes Board aus der Adresse oder eine neue Sitzung. Angefangen wird
     erst, wenn feststeht, dass man darf -- mit Konto oder mit Link. */
  useEffect(() => {
    if (!auth) return;
    if (auth.offline) {
      loadSaved();
      return;
    }
    if (!kontoId && !freigabe) return;
    setState({ anmeldungNoetig: false });
    sitzungOeffnen().catch(() => {});
  }, [auth ? (auth.offline ? 'offline' : 'online') : null, kontoId, freigabe]);

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
        case 'v': if (!cmd) setState({ tool: 'select', selectedIdxs: [] }); break;
        case 'p': if (!cmd) setState({ tool: 'pen' }); break;
        case 'l': if (!cmd) setState({ tool: 'line' }); break;
        case 'a': if (!cmd) setState({ tool: 'arrow' }); break;
        case 'r': if (!cmd) setState({ tool: 'rect' }); break;
        case 'o': if (!cmd) setState({ tool: 'circle' }); break;
        case 't': if (!cmd) setState({ tool: 'text' }); break;
        case 'e': if (!cmd) setState({ tool: 'eraser' }); break;
        case 'z': if (!cmd) setState({ tool: 'laser' }); break;
        case 'h': if (!cmd) setState({ tool: 'hand' }); break;
        case 'f': if (!cmd) setState(s => ({ fullscreen: !s.fullscreen })); break;
        case 'd': if (!cmd) setState(s => ({ darkMode: !s.darkMode })); break;
        case 'escape': setState({ fullscreen: false, contextMenu: null }); break;
        default: break;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!auth) {
    return <div className="anmeldung"><p className="anmeldung-laedt">Blankr lädt …</p></div>;
  }

  if (linkUngueltig) {
    return (
      <div className="anmeldung">
        <div className="anmeldung-karte">
          <h1>Link nicht mehr gültig</h1>
          <p className="anmeldung-hinweis">{linkUngueltig} Bitte die Person, die dir den Link gegeben hat, um einen neuen.</p>
          {kontoId ? (
            <button type="button" className="knopf-primaer" onClick={() => { window.location.href = '/'; }}>Zu meinen Boards</button>
          ) : (
            <button type="button" className="knopf-primaer" onClick={() => { window.location.href = '/'; }}>Zur Anmeldung</button>
          )}
        </div>
        <FussLinks fest />
        <Rechtliches />
      </div>
    );
  }

  if (!auth.offline && !kontoId && (!freigabe || anmeldungNoetig)) {
    return (
      <>
        <Anmeldung />
        <Rechtliches />
      </>
    );
  }

  return (
    <>
      <Canvas />
      <StickyNotes />

      {/* Marke und Sitzung teilen sich die Ecke oben links. Unten links stiessen
          die Sitzungsleiste und die Eigenschaften schon ab 1440 px aneinander. */}
      <div className="ui-oben-links">
        <div className="ui-brand">
          <svg className="brand-logo" viewBox="0 0 28 28" width="28" height="28">
            <rect x="3" y="3" width="22" height="22" rx="6" fill="none" stroke="url(#bgrad)" strokeWidth="2.5" />
            <defs>
              <linearGradient id="bgrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#2383e2" />
                <stop offset="100%" stopColor="#2383e2" />
              </linearGradient>
            </defs>
          </svg>
          <span className="brand-text">Blankr</span>
          {nurLesen && <span className="nur-lesen-marke">Nur ansehen</span>}
          {auth.konto && (
            <button type="button" className="konto-knopf" onClick={() => setState({ kontoOffen: true })} title={`Konto: ${auth.konto.email}`}>
              {(auth.konto.name || '?').trim().charAt(0).toUpperCase()}
            </button>
          )}
        </div>
        <CollabBar />
      </div>

      {!nurLesen && <Toolbar />}
      {!nurLesen && <PropertiesBar />}
      <ActionBar />
      <ZoomControls />
      <LayerPanel />
      <Toast />
      <ContextMenu />
      <ChatPanel />
      <BoardPicker />
      <FreigabeDialog />
      <KontoDialog />
      <Rechtliches />
      <FussLinks />
    </>
  );
}

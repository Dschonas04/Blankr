import { useState, useRef, useEffect } from 'react';
import { useStore, getState, setState, undo, redo, pushUndo, showToast, scheduleAutosave } from '../store';
import * as collab from '../collab';

/* ── SVG Export helper ── */
function strokeSVG(s) {
  const st = `stroke="${s.color}" stroke-width="${s.width}" fill="${s.filled ? s.color : 'none'}" opacity="${s.opacity ?? 1}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (s.type) {
    case 'pen': {
      if (!s.points || s.points.length < 2) return '';
      return `<path d="${s.points.map((p, i) => (i ? `L${p.x},${p.y}` : `M${p.x},${p.y}`)).join(' ')}" ${st} fill="none"/>`;
    }
    case 'line': return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${st}/>`;
    case 'arrow': {
      let r = `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${st}/>`;
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), h = Math.max(14, s.width * 5);
      const ha = Math.PI / 6;
      r += `<polyline points="${s.x2 - h * Math.cos(a - ha)},${s.y2 - h * Math.sin(a - ha)} ${s.x2},${s.y2} ${s.x2 - h * Math.cos(a + ha)},${s.y2 - h * Math.sin(a + ha)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${s.opacity ?? 1}"/>`;
      return r;
    }
    case 'rect': return `<rect x="${Math.min(s.x1, s.x2)}" y="${Math.min(s.y1, s.y2)}" width="${Math.abs(s.x2 - s.x1)}" height="${Math.abs(s.y2 - s.y1)}" ${st}/>`;
    case 'circle': return `<ellipse cx="${(s.x1 + s.x2) / 2}" cy="${(s.y1 + s.y2) / 2}" rx="${Math.abs(s.x2 - s.x1) / 2}" ry="${Math.abs(s.y2 - s.y1) / 2}" ${st}/>`;
    case 'text': return `<text x="${s.x}" y="${s.y}" fill="${s.color}" font-size="${s.fontSize || 16}" font-family="Inter,sans-serif" opacity="${s.opacity ?? 1}">${(s.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
    default: return '';
  }
}

export default function ActionBar() {
  const darkMode = useStore(s => s.darkMode);
  const layerPanelOpen = useStore(s => s.layerPanelOpen);
  const collabConnected = useStore(s => s.collabConnected);
  const bgPattern = useStore(s => s.bgPattern);
  const gridSnap = useStore(s => s.gridSnap);
  const chatOpen = useStore(s => s.chatOpen);

  const [bgOpen, setBgOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bgPos, setBgPos] = useState({});
  const [exportPos, setExportPos] = useState({});
  const bgBtnRef = useRef(null);
  const exportBtnRef = useRef(null);

  /* Close popups on outside click */
  useEffect(() => {
    function onClick(e) {
      if (!e.target.closest('.popup, .a-btn')) {
        setBgOpen(false);
        setExportOpen(false);
      }
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  function toggleBg(e) {
    e.stopPropagation();
    const wasOpen = bgOpen;
    setExportOpen(false);
    if (wasOpen) { setBgOpen(false); return; }
    const r = bgBtnRef.current.getBoundingClientRect();
    setBgPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    setBgOpen(true);
  }

  function toggleExport(e) {
    e.stopPropagation();
    const wasOpen = exportOpen;
    setBgOpen(false);
    if (wasOpen) { setExportOpen(false); return; }
    const r = exportBtnRef.current.getBoundingClientRect();
    setExportPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    setExportOpen(true);
  }

  function handleClear() {
    const hasStrokes = getState().layers.some(l => l.strokes.length > 0);
    if (!hasStrokes) { showToast('Canvas ist bereits leer'); return; }
    if (!window.confirm('⚠️ Wirklich ALLES löschen?\n\nAlle Zeichnungen auf allen Ebenen werden entfernt. Diese Aktion kann mit Strg+Z rückgängig gemacht werden.')) return;
    pushUndo();
    setState(s => ({ layers: s.layers.map(l => ({ ...l, strokes: [] })), selectedIdxs: [] }));
    scheduleAutosave();
    showToast('🗑 Alles gelöscht');
    if (collab.isConnected()) collab.send({ type: 'clear' });
  }

  function handleCollab() {
    if (collabConnected) { collab.disconnect(); return; }
    const room = Math.random().toString(36).substring(2, 8);
    const u = new URL(window.location);
    u.searchParams.set('room', room);
    history.replaceState(null, '', u);
    collab.connect(room);
    showToast('🔗 Raum erstellt!');
  }

  function addSticky() {
    const { view } = getState();
    const wx = (-view.x + window.innerWidth / 2 - 100) / view.scale;
    const wy = (-view.y + window.innerHeight / 2 - 70) / view.scale;
    setState(s => ({
      stickyNotes: [...s.stickyNotes, { id: Date.now(), wx, wy, text: '', colorIdx: 0 }],
    }));
  }

  /* Exports */
  function exportPNG() {
    setExportOpen(false);
    const cvs = document.getElementById('whiteboard');
    const c2 = document.createElement('canvas');
    c2.width = cvs.width; c2.height = cvs.height;
    const c2x = c2.getContext('2d');
    c2x.fillStyle = darkMode ? '#1e1e32' : '#fff';
    c2x.fillRect(0, 0, c2.width, c2.height);
    c2x.drawImage(cvs, 0, 0);
    const a = document.createElement('a');
    a.download = 'blankr.png';
    a.href = c2.toDataURL('image/png');
    a.click();
    showToast('📸 PNG gespeichert');
  }

  function exportJPEG() {
    setExportOpen(false);
    const cvs = document.getElementById('whiteboard');
    const c2 = document.createElement('canvas');
    c2.width = cvs.width; c2.height = cvs.height;
    const c2x = c2.getContext('2d');
    c2x.fillStyle = darkMode ? '#1e1e32' : '#fff';
    c2x.fillRect(0, 0, c2.width, c2.height);
    c2x.drawImage(cvs, 0, 0);
    const a = document.createElement('a');
    a.download = 'blankr.jpg';
    a.href = c2.toDataURL('image/jpeg', 0.92);
    a.click();
    showToast('📸 JPEG gespeichert');
  }

  function exportSVG() {
    setExportOpen(false);
    const cvs = document.getElementById('whiteboard');
    const { view, layers } = getState();
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cvs.width}" height="${cvs.height}">`;
    svg += `<rect width="100%" height="100%" fill="${darkMode ? '#1e1e32' : '#fff'}"/>`;
    svg += `<g transform="translate(${view.x},${view.y}) scale(${view.scale})">`;
    for (const layer of layers) {
      if (!layer.visible) continue;
      svg += `<g opacity="${layer.opacity}">`;
      for (const s of layer.strokes) svg += strokeSVG(s);
      svg += '</g>';
    }
    svg += '</g></svg>';
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.download = 'blankr.svg';
    a.href = URL.createObjectURL(blob);
    a.click();
    showToast('🖼 SVG gespeichert');
  }

  function exportPDF() {
    setExportOpen(false);
    window.print();
    showToast('📄 Druckdialog geöffnet');
  }

  function exportJSON() {
    const { layers } = getState();
    const data = JSON.stringify({ version: 1, layers }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = 'blankr.json';
    a.href = URL.createObjectURL(blob);
    a.click();
    showToast('💾 JSON gespeichert');
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (data.layers && Array.isArray(data.layers)) {
            pushUndo();
            setState({ layers: data.layers, selectedIdxs: [] });
            scheduleAutosave();
            showToast('📂 JSON importiert');
          } else {
            showToast('⚠️ Ungültiges Format');
          }
        } catch {
          showToast('⚠️ JSON konnte nicht gelesen werden');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  const BG_OPTIONS = [
    { id: 'none', label: 'Leer', cls: 'bg-none' },
    { id: 'dots', label: 'Punkte', cls: 'bg-dots' },
    { id: 'grid', label: 'Raster', cls: 'bg-grid' },
    { id: 'lines', label: 'Linien', cls: 'bg-lines' },
  ];

  return (
    <>
      <div className="ui-actions">
        <div className="action-row">
          <button className="a-btn" title="Rückgängig (⌘Z)" onClick={undo}>
            <svg viewBox="0 0 24 24"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
          </button>
          <button className="a-btn" title="Wiederholen (⌘⇧Z)" onClick={redo}>
            <svg viewBox="0 0 24 24"><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></svg>
          </button>
        </div>
        <i className="action-sep" />
        <div className="action-row">
          <button ref={bgBtnRef} className="a-btn" title="Hintergrund" onClick={toggleBg}>
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
          </button>
          <button
            className={`a-btn${layerPanelOpen ? ' active' : ''}`}
            title="Ebenen"
            onClick={() => setState(s => ({ layerPanelOpen: !s.layerPanelOpen }))}
          >
            <svg viewBox="0 0 24 24"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.84Z" /><path d="m2 12 8.58 3.91a2 2 0 0 0 1.66 0L21 12" /><path d="m2 17 8.58 3.91a2 2 0 0 0 1.66 0L21 17" /></svg>
          </button>
          <button className="a-btn" title="Notiz" onClick={addSticky}>
            <svg viewBox="0 0 24 24"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /><polyline points="14 2 14 8 20 8" /></svg>
          </button>
        </div>
        <i className="action-sep" />
        <div className="action-row">
          <button ref={exportBtnRef} className="a-btn" title="Exportieren" onClick={toggleExport}>
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </button>
          <button className="a-btn" id="btn-clear" title="Alles löschen" onClick={handleClear}>
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          </button>
        </div>
        <i className="action-sep" />
        <div className="action-row">
          <button className={`a-btn${darkMode ? ' active' : ''}`} title="Dark Mode (D)" onClick={() => setState(s => ({ darkMode: !s.darkMode }))}>
            <svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" /></svg>
          </button>
          <button className={`a-btn${collabConnected ? ' active' : ''}`} title="Zusammenarbeit" onClick={handleCollab}>
            <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </button>
          <button className={`a-btn${gridSnap ? ' active' : ''}`} title="Raster-Snap" onClick={() => setState(s => ({ gridSnap: !s.gridSnap }))}>
            <svg viewBox="0 0 24 24"><path d="M3 3h18v18H3V3z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" strokeWidth="0.5" opacity="0.4"/><circle cx="9" cy="9" r="2" fill="currentColor"/></svg>
          </button>
          <button className={`a-btn${chatOpen ? ' active' : ''}`} title="Chat" onClick={() => setState(s => ({ chatOpen: !s.chatOpen }))}>
            <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </button>
        </div>
      </div>

      {/* Background popup */}
      {bgOpen && (
        <div className="popup" style={{ position: 'fixed', ...bgPos }}>
          <div className="popup-title">Hintergrund</div>
          <div className="popup-grid">
            {BG_OPTIONS.map(bg => (
              <button
                key={bg.id}
                className={`bg-opt${bgPattern === bg.id ? ' active' : ''}`}
                onClick={() => { setState({ bgPattern: bg.id }); scheduleAutosave(); }}
              >
                <div className={`bg-thumb ${bg.cls}`} />
                <span>{bg.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Export popup */}
      {exportOpen && (
        <div className="popup" style={{ position: 'fixed', ...exportPos }}>
          <div className="popup-title">Exportieren</div>
          <button className="popup-action" onClick={exportPNG}>
            <span className="popup-action-icon">📸</span> Als PNG speichern
          </button>
          <button className="popup-action" onClick={exportJPEG}>
            <span className="popup-action-icon">🖼️</span> Als JPEG speichern
          </button>
          <button className="popup-action" onClick={exportSVG}>
            <span className="popup-action-icon">✏️</span> Als SVG speichern
          </button>
          <button className="popup-action" onClick={exportPDF}>
            <span className="popup-action-icon">📄</span> Drucken / PDF
          </button>
          <hr style={{border:'none',borderTop:'1px solid var(--border)',margin:'4px 0'}}/>
          <button className="popup-action" onClick={() => { setExportOpen(false); exportJSON(); }}>
            <span className="popup-action-icon">💾</span> Als JSON speichern
          </button>
          <button className="popup-action" onClick={() => { setExportOpen(false); importJSON(); }}>
            <span className="popup-action-icon">📂</span> JSON importieren
          </button>
        </div>
      )}
    </>
  );
}

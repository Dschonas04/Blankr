import { useStore, setState, pushUndo, scheduleAutosave } from '../store';

export default function LayerPanel() {
  const open = useStore(s => s.layerPanelOpen);
  const layers = useStore(s => s.layers);
  const activeLayer = useStore(s => s.activeLayer);

  if (!open) return null;

  function addLayer() {
    setState(s => ({
      layers: [...s.layers, { name: `Ebene ${s.layers.length + 1}`, visible: true, opacity: 1, strokes: [] }],
      activeLayer: s.layers.length,
    }));
    scheduleAutosave();
  }

  function toggleVisibility(i) {
    setState(s => ({
      layers: s.layers.map((l, idx) => idx === i ? { ...l, visible: !l.visible } : l),
    }));
    scheduleAutosave();
  }

  function setOpacity(i, val) {
    setState(s => ({
      layers: s.layers.map((l, idx) => idx === i ? { ...l, opacity: val } : l),
    }));
    scheduleAutosave();
  }

  function deleteLayer(i) {
    if (layers.length <= 1) return;
    pushUndo();
    setState(s => {
      const newLayers = s.layers.filter((_, idx) => idx !== i);
      const newActive = s.activeLayer >= newLayers.length ? newLayers.length - 1 : s.activeLayer;
      return { layers: newLayers, activeLayer: newActive };
    });
    scheduleAutosave();
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="panel-title">Ebenen</span>
        <button className="panel-add" title="Neue Ebene" onClick={addLayer}>
          <svg viewBox="0 0 24 24" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <ul className="layer-list">
        {[...layers].reverse().map((layer, ri) => {
          const i = layers.length - 1 - ri;
          return (
            <li
              key={i}
              className={`layer-item${i === activeLayer ? ' active' : ''}`}
              onClick={(e) => {
                if (e.target.closest('.l-vis, .l-opacity, .l-del')) return;
                setState({ activeLayer: i });
              }}
            >
              <button className="l-vis" onClick={() => toggleVisibility(i)}>
                {layer.visible ? '👁' : '◌'}
              </button>
              <span className="l-name">{layer.name}</span>
              <input
                type="range"
                className="l-opacity"
                min="0"
                max="100"
                value={Math.round(layer.opacity * 100)}
                onChange={e => setOpacity(i, +e.target.value / 100)}
              />
              <button className="l-del" onClick={() => deleteLayer(i)}>✕</button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

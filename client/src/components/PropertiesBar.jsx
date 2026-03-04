import { useStore, setState, getState, pushUndo, scheduleAutosave } from '../store';

const COLORS = ['#1e1e1e', '#dc2626', '#16a34a', '#2563eb', '#ea580c', '#9333ea'];

export default function PropertiesBar() {
  const color = useStore(s => s.color);
  const lineWidth = useStore(s => s.lineWidth);
  const opacity = useStore(s => s.opacity);
  const filled = useStore(s => s.filled);
  const tool = useStore(s => s.tool);

  function setColor(c) {
    setState({ color: c });
    if (tool === 'eraser') setState({ tool: 'pen' });
    // Also update the selected stroke's colour
    if (getState().selectedIdxs.length > 0) {
      pushUndo();
      const st = getState();
      const layers = st.layers.map((l, li) => {
        if (li !== st.activeLayer) return l;
        const strokes = [...l.strokes];
        for (const idx of st.selectedIdxs) {
          if (strokes[idx]) strokes[idx] = { ...strokes[idx], color: c };
        }
        return { ...l, strokes };
      });
      setState({ layers });
      scheduleAutosave();
    }
  }

  return (
    <div className="ui-props">
      {/* Colors */}
      <div className="prop-section">
        <div className="color-row">
          {COLORS.map(c => (
            <button
              key={c}
              className={`swatch${color === c ? ' active' : ''}`}
              style={{ '--c': c }}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="custom-color">
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
            />
            <svg viewBox="0 0 24 24" width="16" height="16">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20" fill="none" />
            </svg>
          </label>
        </div>
      </div>

      <i className="prop-sep" />

      {/* Size */}
      <div className="prop-section">
        <span
          className="prop-dot"
          style={{ width: Math.max(4, lineWidth), height: Math.max(4, lineWidth) }}
        />
        <input
          type="range"
          className="prop-slider"
          min="1"
          max="30"
          value={lineWidth}
          onChange={e => setState({ lineWidth: +e.target.value })}
        />
      </div>

      <i className="prop-sep" />

      {/* Opacity */}
      <div className="prop-section">
        <span className="prop-label">◐</span>
        <input
          type="range"
          className="prop-slider"
          min="5"
          max="100"
          value={Math.round(opacity * 100)}
          onChange={e => setState({ opacity: +e.target.value / 100 })}
        />
      </div>

      <i className="prop-sep" />

      {/* Fill */}
      <button
        className={`prop-btn${filled ? ' fill-on' : ''}`}
        title="Füllung"
        onClick={() => setState({ filled: !filled })}
      >
        <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
      </button>
    </div>
  );
}

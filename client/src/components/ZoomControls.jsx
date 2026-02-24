import { useStore, getState, setState } from '../store';

export default function ZoomControls() {
  const scale = useStore(s => s.view.scale);

  function zoom(delta) {
    const v = getState().view;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const newScale = Math.min(5, Math.max(0.1, v.scale * delta));
    setState({
      view: {
        x: cx - (cx - v.x) * (newScale / v.scale),
        y: cy - (cy - v.y) * (newScale / v.scale),
        scale: newScale,
      },
    });
  }

  function reset() {
    setState({ view: { x: 0, y: 0, scale: 1 } });
  }

  return (
    <div className="ui-zoom">
      <button className="z-btn" title="Verkleinern" onClick={() => zoom(0.8)}>−</button>
      <button className="z-label" title="Zurücksetzen" onClick={reset}>
        {Math.round(scale * 100)}%
      </button>
      <button className="z-btn" title="Vergrößern" onClick={() => zoom(1.2)}>+</button>
    </div>
  );
}

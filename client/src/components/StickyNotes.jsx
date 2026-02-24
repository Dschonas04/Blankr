import { useState } from 'react';
import { useStore, setState, scheduleAutosave } from '../store';

const STICKY_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fde68a', '#e9d5ff'];

export default function StickyNotes() {
  const notes = useStore(s => s.stickyNotes);
  const view = useStore(s => s.view);

  return (
    <div id="sticky-container">
      {notes.map(note => (
        <StickyNote key={note.id} note={note} view={view} />
      ))}
    </div>
  );
}

function StickyNote({ note, view }) {
  const [screenPos, setScreenPos] = useState(null);

  const computedLeft = note.wx * view.scale + view.x;
  const computedTop = note.wy * view.scale + view.y;
  const left = screenPos ? screenPos.x : computedLeft;
  const top = screenPos ? screenPos.y : computedTop;

  function startDrag(e) {
    if (e.target.closest('.sticky-close, .sticky-color')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startLeft = left, startTop = top;

    function onMove(ev) {
      setScreenPos({ x: startLeft + (ev.clientX - startX), y: startTop + (ev.clientY - startY) });
    }

    function onUp(ev) {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const finalX = startLeft + (ev.clientX - startX);
      const finalY = startTop + (ev.clientY - startY);
      const newWx = (finalX - view.x) / view.scale;
      const newWy = (finalY - view.y) / view.scale;
      setScreenPos(null);
      setState(s => ({
        stickyNotes: s.stickyNotes.map(n =>
          n.id === note.id ? { ...n, wx: newWx, wy: newWy } : n
        ),
      }));
      scheduleAutosave();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function setColor(colorIdx) {
    setState(s => ({
      stickyNotes: s.stickyNotes.map(n =>
        n.id === note.id ? { ...n, colorIdx } : n
      ),
    }));
    scheduleAutosave();
  }

  function remove() {
    setState(s => ({ stickyNotes: s.stickyNotes.filter(n => n.id !== note.id) }));
    scheduleAutosave();
  }

  function onTextChange(e) {
    const text = e.target.value;
    setState(s => ({
      stickyNotes: s.stickyNotes.map(n =>
        n.id === note.id ? { ...n, text } : n
      ),
    }));
    scheduleAutosave();
  }

  return (
    <div
      className="sticky"
      style={{
        left, top,
        transform: `scale(${view.scale})`,
        background: STICKY_COLORS[note.colorIdx],
      }}
    >
      <div className="sticky-header" onMouseDown={startDrag}>
        <div className="sticky-colors">
          {STICKY_COLORS.map((c, i) => (
            <button
              key={i}
              className="sticky-color"
              style={{ background: c }}
              onClick={() => setColor(i)}
            />
          ))}
        </div>
        <button className="sticky-close" onClick={remove}>✕</button>
      </div>
      <textarea
        className="sticky-body"
        value={note.text}
        onChange={onTextChange}
        placeholder="Notiz…"
      />
    </div>
  );
}

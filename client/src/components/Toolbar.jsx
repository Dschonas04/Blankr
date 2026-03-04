import { useStore, setState } from '../store';

/* Tool groups separated by visual dividers */
const TOOL_GROUPS = [
  // Navigation & Selection
  [
    { id: 'select', label: 'Auswählen (V)',
      icon: <svg viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="m13 13 6 6" /></svg> },
    { id: 'hand', label: 'Bewegen (H)',
      icon: <svg viewBox="0 0 24 24"><path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.7-2.4L3.4 15a2 2 0 0 1 3.2-2.4L8 14" /></svg> },
  ],
  // Drawing
  [
    { id: 'pen', label: 'Stift (P)',
      icon: <svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg> },
    { id: 'line', label: 'Linie (L)',
      icon: <svg viewBox="0 0 24 24"><line x1="5" y1="19" x2="19" y2="5" /></svg> },
    { id: 'arrow', label: 'Pfeil (A)',
      icon: <svg viewBox="0 0 24 24"><line x1="5" y1="19" x2="19" y2="5" /><polyline points="10 5 19 5 19 14" /></svg> },
    { id: 'text', label: 'Text (T)',
      icon: <svg viewBox="0 0 24 24"><polyline points="4 7 4 4 20 4 20 7" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="8" y1="20" x2="16" y2="20" /></svg> },
  ],
  // Shapes
  [
    { id: 'rect', label: 'Rechteck (R)',
      icon: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /></svg> },
    { id: 'circle', label: 'Kreis (O)',
      icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg> },
    { id: 'triangle', label: 'Dreieck',
      icon: <svg viewBox="0 0 24 24"><polygon points="12 3 22 21 2 21" /></svg> },
    { id: 'diamond', label: 'Raute',
      icon: <svg viewBox="0 0 24 24"><polygon points="12 2 22 12 12 22 2 12" /></svg> },
    { id: 'star', label: 'Stern',
      icon: <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" /></svg> },
    { id: 'hexagon', label: 'Hexagon',
      icon: <svg viewBox="0 0 24 24"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7" /></svg> },
  ],
  // Utilities
  [
    { id: 'eraser', label: 'Radierer (E)',
      icon: <svg viewBox="0 0 24 24"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></svg> },
    { id: 'laser', label: 'Laser (Z)',
      icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeDasharray="2 3" /></svg> },
  ],
];

export default function Toolbar() {
  const tool = useStore(s => s.tool);

  return (
    <nav className="ui-tools">
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} className="t-group">
          {gi > 0 && <i className="t-sep" />}
          {group.map(t => (
            <button
              key={t.id}
              className={`t-btn${tool === t.id ? ' active' : ''}`}
              data-tip={t.label}
              onClick={() => setState({ tool: t.id })}
            >
              {t.icon}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/* ═══════════════════════════════════════
   Blankr — WebSocket Collaboration
   ═══════════════════════════════════════ */
import { getState, setState, showToast, scheduleAutosave } from './store';

let ws = null;
let userId = null;

/* ── Cursor batching ── */
let cursorBuf = {};
let cursorRaf = null;

function flushCursors() {
  setState(s => ({ remoteCursors: { ...s.remoteCursors, ...cursorBuf } }));
  cursorBuf = {};
  cursorRaf = null;
}

/* ── Public API ── */
export function isConnected() { return ws && ws.readyState === 1; }
export function getUserId() { return userId; }

export function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

export function sendStroke(data) { send({ type: 'stroke', data }); }
export function sendCursor(x, y) { send({ type: 'cursor', x, y }); }
export function sendClear() { send({ type: 'clear' }); }
export function sendUndo() { send({ type: 'undo' }); }

export function connect(room) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${room}`);

  ws.onopen = () => {
    setState({ collabConnected: true, collabRoom: room });
    showToast('🟢 Verbunden');
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const st = getState();

    switch (msg.type) {
      case 'init':
        userId = msg.userId;
        setState({ collabUsers: msg.users });
        if (!st.layers[0].strokes.length && msg.strokes?.length) {
          const layers = st.layers.map((l, i) =>
            i === 0 ? { ...l, strokes: msg.strokes } : l
          );
          setState({ layers });
        }
        break;

      case 'user-joined':
        showToast(`👋 ${msg.user.name}`);
        setState(s => ({ collabUsers: [...s.collabUsers, msg.user] }));
        break;

      case 'user-left':
        setState(s => ({
          collabUsers: s.collabUsers.filter(u => u.id !== msg.userId),
          remoteCursors: Object.fromEntries(
            Object.entries(s.remoteCursors).filter(([k]) => k !== msg.userId)
          ),
        }));
        break;

      case 'stroke': {
        const layers = st.layers.map((l, i) =>
          i === 0 ? { ...l, strokes: [...l.strokes, msg.data] } : l
        );
        setState({ layers });
        break;
      }

      case 'cursor': {
        const user = st.collabUsers.find(u => u.id === msg.userId);
        if (user) {
          cursorBuf[msg.userId] = { x: msg.x, y: msg.y, color: user.color, name: user.name };
          if (!cursorRaf) cursorRaf = requestAnimationFrame(flushCursors);
        }
        break;
      }

      case 'clear':
        setState(s => ({ layers: s.layers.map(l => ({ ...l, strokes: [] })) }));
        break;

      case 'undo':
        setState(s => {
          const layers = s.layers.map((l, i) =>
            i === 0 && l.strokes.length ? { ...l, strokes: l.strokes.slice(0, -1) } : l
          );
          return { layers };
        });
        break;

      case 'chat': {
        const user = st.collabUsers.find(u => u.id === msg.userId);
        const chatMsg = {
          id: msg.id || Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          name: user?.name || msg.userId?.slice(0, 6) || '?',
          color: user?.color || '#999',
          text: msg.text,
          time: Date.now(),
          own: false,
        };
        setState(s => ({ chatMessages: [...s.chatMessages, chatMsg] }));
        // Auto-open chat on new message
        if (!st.chatOpen) setState({ chatOpen: true });
        break;
      }
    }
  };

  ws.onclose = () => {
    disconnect();
    showToast('🔴 Getrennt');
  };
}

export function disconnect() {
  if (ws) { ws.close(); ws = null; }
  userId = null;
  setState({
    collabConnected: false,
    collabRoom: null,
    collabUsers: [],
    remoteCursors: {},
  });
  const u = new URL(window.location);
  u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

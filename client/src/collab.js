/* ═══════════════════════════════════════
   Blankr — Board-Synchronisation
   ═══════════════════════════════════════ */
import {
  SITE,
  applyRemoteOps,
  getState,
  replaceFromSnapshot,
  setOpSink,
  setState,
  showToast,
} from './store';

let ws = null;
let userId = null;
let currentBoard = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let intentionalClose = false;

/* ── Ausgehende Operationen ──
   Waehrend eines Zuges feuert der Editor bis zu 60 Aenderungen pro Sekunde.
   Sie werden kurz gesammelt und als ein Paket geschickt.

   Bewusst setTimeout und nicht requestAnimationFrame: rAF steht still,
   sobald der Tab in den Hintergrund geraet. Genau dann wuerden die eigenen
   Aenderungen liegenbleiben, waehrend man nebenbei in einem anderen Fenster
   arbeitet -- die Mitarbeiter saehen nichts mehr. */
const FLUSH_MS = 20;
let outbox = [];
let outboxTimer = null;

function flushOutbox() {
  outboxTimer = null;
  if (!outbox.length) return;
  const ops = outbox;
  outbox = [];
  if (isConnected()) send({ type: 'ops', ops });
  // Ohne Verbindung werden die Operationen verworfen: der lokale Zustand
  // ist bereits aktuell, und beim naechsten Verbinden gleicht der
  // Schnappschuss ohnehin alles ab.
}

setOpSink((ops) => {
  outbox.push(...ops);
  if (!outboxTimer) outboxTimer = setTimeout(flushOutbox, FLUSH_MS);
});

/* ── Zeiger anderer Teilnehmer ── */
let cursorBuf = {};
let cursorRaf = null;

function flushCursors() {
  setState((s) => ({ remoteCursors: { ...s.remoteCursors, ...cursorBuf } }));
  cursorBuf = {};
  cursorRaf = null;
}

/* ── Öffentliche API ── */
export function isConnected() {
  return ws && ws.readyState === 1;
}

export function getUserId() {
  return userId;
}

export function send(msg) {
  if (isConnected()) ws.send(JSON.stringify(msg));
}

export function sendCursor(x, y) {
  send({ type: 'cursor', x, y });
}

/* Beibehalten, weil die Werkzeuge sie importieren. Striche laufen jetzt
   ueber den Operationsstrom des Stores, deshalb tun diese nichts mehr. */
export function sendStroke() {}
export function sendClear() {}
export function sendUndo() {}

/* ── Board-Verwaltung über REST ── */
export async function listBoards() {
  const res = await fetch('/api/boards');
  if (!res.ok) throw new Error('Boards nicht abrufbar');
  return res.json();
}

export async function createBoard(name) {
  const res = await fetch('/api/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Board konnte nicht angelegt werden');
  return res.json();
}

export async function renameBoard(id, name) {
  const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Umbenennen fehlgeschlagen');
  return res.json();
}

export async function deleteBoard(id) {
  const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Löschen fehlgeschlagen');
}

/* ── Verbindung ── */
export function connect(board, boardName) {
  intentionalClose = false;
  currentBoard = board;
  clearTimeout(reconnectTimer);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?board=${encodeURIComponent(board)}&site=${SITE}`);

  ws.onopen = () => {
    reconnectDelay = 1000;
    setState({ collabConnected: true, collabRoom: board, collabBoardName: boardName || board });
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const st = getState();

    switch (msg.type) {
      case 'init':
        userId = msg.userId;
        setState({ collabUsers: msg.users, collabBoardName: msg.boardName || board });
        // Der Server ist die Quelle der Wahrheit; der lokale Stand wird
        // ersetzt, nicht zusammengefuehrt. Alles andere fuehrt dazu, dass
        // ein alter Autosave beim Beitritt fremde Boards verunreinigt.
        replaceFromSnapshot(msg.snapshot);
        showToast(`Verbunden mit „${msg.boardName || board}"`);
        break;

      case 'ops':
        applyRemoteOps(msg.ops || []);
        break;

      case 'user-joined':
        showToast(`${msg.user.name} ist dazugekommen`);
        setState((s) => ({ collabUsers: [...s.collabUsers, msg.user] }));
        break;

      case 'user-left':
        setState((s) => ({
          collabUsers: s.collabUsers.filter((u) => u.id !== msg.userId),
          remoteCursors: Object.fromEntries(
            Object.entries(s.remoteCursors).filter(([k]) => k !== msg.userId),
          ),
        }));
        break;

      case 'cursor': {
        const user = st.collabUsers.find((u) => u.id === msg.userId);
        if (user) {
          cursorBuf[msg.userId] = { x: msg.x, y: msg.y, color: user.color, name: user.name };
          if (!cursorRaf) cursorRaf = requestAnimationFrame(flushCursors);
        }
        break;
      }

      case 'chat': {
        const user = st.collabUsers.find((u) => u.id === msg.userId);
        setState((s) => ({
          chatMessages: [
            ...s.chatMessages,
            {
              id: msg.id || Date.now() + '_' + Math.random().toString(36).slice(2, 5),
              name: user?.name || msg.userId?.slice(0, 6) || '?',
              color: user?.color || '#999',
              text: msg.text,
              time: Date.now(),
              own: false,
            },
          ],
          chatOpen: true,
        }));
        break;
      }
    }
  };

  ws.onclose = () => {
    setState({ collabConnected: false, collabUsers: [], remoteCursors: {} });
    if (intentionalClose) return;
    // Automatisch neu verbinden. Beim Beitritt kommt ohnehin ein voller
    // Schnappschuss, damit ist der Zustand nach jedem Aussetzer wieder
    // deckungsgleich -- ohne dass jemand etwas neu laden muss.
    showToast(`Verbindung verloren, neuer Versuch in ${Math.round(reconnectDelay / 1000)} s`);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      connect(currentBoard, boardName);
    }, reconnectDelay);
  };
}

export function disconnect() {
  intentionalClose = true;
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
  userId = null;
  currentBoard = null;
  setState({
    collabConnected: false,
    collabRoom: null,
    collabBoardName: null,
    collabUsers: [],
    remoteCursors: {},
  });
  const u = new URL(window.location);
  u.searchParams.delete('board');
  u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

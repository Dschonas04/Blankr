import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { applyOps, collectGarbage, loadSnapshot, snapshot, snapshotOps } from '../shared/lww.mjs';
import * as boards from './boards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

/* ── Aktive Boards im Speicher ──
   Ein Board bleibt geladen, solange jemand darauf arbeitet. Danach wird es
   entladen -- der Inhalt liegt dann auf der Platte, nicht im Nichts wie
   vorher, als der Raum beim Weggehen des letzten Nutzers verschwand. */
const open = new Map(); // boardId -> { doc, users: Map<ws, user> }

const PALETTE = [
  '#e03131', '#1971c2', '#2f9e44', '#f08c00',
  '#9c36b5', '#0c8599', '#e8590c', '#5c940d',
];
let colorIdx = 0;

async function openBoard(id) {
  if (open.has(id)) return open.get(id);
  const doc = loadSnapshot(await boards.loadSnapshot(id), 'server');
  const entry = { doc, users: new Map() };
  open.set(id, entry);
  return entry;
}

function broadcast(entry, exclude, msg) {
  const data = JSON.stringify(msg);
  for (const [client] of entry.users) {
    if (client !== exclude && client.readyState === 1) client.send(data);
  }
}

function save(id) {
  boards.scheduleSave(id, () => {
    const entry = open.get(id);
    return entry ? snapshot(entry.doc) : null;
  });
}

/* ── REST: Boards verwalten ── */
app.get('/api/boards', (_req, res) => {
  res.json(
    boards.listBoards().map((b) => ({
      ...b,
      online: open.get(b.id)?.users.size || 0,
    })),
  );
});

app.post('/api/boards', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  res.status(201).json(boards.createBoard(name));
});

app.patch('/api/boards/:id', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  const board = boards.renameBoard(req.params.id, name);
  if (!board) return res.status(404).json({ error: 'Board unbekannt' });
  broadcastToBoard(req.params.id, { type: 'board-renamed', name: board.name });
  res.json(board);
});

app.delete('/api/boards/:id', async (req, res) => {
  const id = req.params.id;
  const entry = open.get(id);
  if (entry && entry.users.size) {
    return res.status(409).json({ error: 'Board wird gerade bearbeitet' });
  }
  const ok = await boards.removeBoard(id);
  open.delete(id);
  if (!ok) return res.status(404).json({ error: 'Board unbekannt' });
  res.status(204).end();
});

function broadcastToBoard(id, msg) {
  const entry = open.get(id);
  if (entry) broadcast(entry, null, msg);
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, boards: boards.listBoards().length, open: open.size });
});

/* ── WebSocket ── */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // "room" bleibt als Alias erhalten, damit alte Links weiter funktionieren.
  const boardId = url.searchParams.get('board') || url.searchParams.get('room');
  if (!boardId) {
    ws.close(1008, 'board fehlt');
    return;
  }

  const meta = boards.getBoardMeta(boardId);
  const entry = await openBoard(boardId);

  const userId = crypto.randomUUID();
  const user = {
    id: userId,
    color: PALETTE[colorIdx++ % PALETTE.length],
    name: `Gast ${colorIdx}`,
  };
  entry.users.set(ws, user);

  ws.send(
    JSON.stringify({
      type: 'init',
      userId,
      boardName: meta?.name || boardId,
      users: Array.from(entry.users.values()),
      snapshot: snapshot(entry.doc),
    }),
  );
  broadcast(entry, ws, { type: 'user-joined', user });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'ops': {
        if (!Array.isArray(msg.ops) || !msg.ops.length) return;
        // Nur weiterreichen, was den Serverzustand wirklich veraendert --
        // verspaetete oder doppelte Operationen sterben hier.
        const changed = applyOps(entry.doc, msg.ops);
        if (!changed) return;
        broadcast(entry, ws, { type: 'ops', ops: msg.ops });
        save(boardId);
        break;
      }
      case 'cursor':
        broadcast(entry, ws, { type: 'cursor', userId, x: msg.x, y: msg.y });
        break;
      case 'chat':
        broadcast(entry, ws, { type: 'chat', userId, text: msg.text, id: msg.id });
        break;
      case 'resync':
        // Notanker fuer den Client: kompletten Zustand erneut anfordern.
        ws.send(JSON.stringify({ type: 'ops', ops: snapshotOps(entry.doc) }));
        break;
    }
  });

  ws.on('close', () => {
    entry.users.delete(ws);
    broadcast(entry, null, { type: 'user-left', userId });
    if (entry.users.size === 0) {
      collectGarbage(entry.doc);
      boards.scheduleSave(boardId, () => snapshot(entry.doc), 0);
      // Kurz warten, damit der Schreibvorgang das Dokument noch vorfindet.
      setTimeout(() => {
        if (open.get(boardId)?.users.size === 0) open.delete(boardId);
      }, 5000);
    }
  });
});

/* ── Start und geordnetes Beenden ── */
const count = await boards.init();
server.listen(PORT, () => {
  console.log(`Blankr laeuft auf http://localhost:${PORT} (${count} Board(s), Daten in ${boards.DATA_DIR})`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} empfangen, speichere offene Boards ...`);
  await boards.flushAll((id) => (open.has(id) ? snapshot(open.get(id).doc) : null));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

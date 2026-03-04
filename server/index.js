const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, "..", "client", "dist")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/* ── Room management ── */
const rooms = new Map();
const PALETTE = [
  "#e03131","#1971c2","#2f9e44","#f08c00",
  "#9c36b5","#0c8599","#e8590c","#5c940d",
];
let colorIdx = 0;

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, { users: new Map(), strokes: [] });
  }
  return rooms.get(id);
}

function broadcast(room, exclude, msg) {
  const data = JSON.stringify(msg);
  for (const [ws] of room.users) {
    if (ws !== exclude && ws.readyState === 1) ws.send(data);
  }
}

/* ── WebSocket handling ── */
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("room");
  if (!roomId) { ws.close(); return; }

  const userId = crypto.randomUUID();
  const user = {
    id: userId,
    color: PALETTE[colorIdx++ % PALETTE.length],
    name: `User ${colorIdx}`,
  };

  const room = getRoom(roomId);
  room.users.set(ws, user);

  // Send initial state
  ws.send(JSON.stringify({
    type: "init",
    userId,
    users: Array.from(room.users.values()),
    strokes: room.strokes,
  }));

  broadcast(room, ws, { type: "user-joined", user });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case "stroke":
          room.strokes.push(msg.data);
          broadcast(room, ws, { type: "stroke", userId, data: msg.data });
          break;
        case "cursor":
          broadcast(room, ws, { type: "cursor", userId, x: msg.x, y: msg.y });
          break;
        case "clear":
          room.strokes = [];
          broadcast(room, ws, { type: "clear", userId });
          break;
        case "undo":
          room.strokes.pop();
          broadcast(room, ws, { type: "undo", userId });
          break;
        case "chat":
          broadcast(room, ws, { type: "chat", userId, text: msg.text, id: msg.id });
          break;
      }
    } catch (_) { /* ignore */ }
  });

  ws.on("close", () => {
    room.users.delete(ws);
    broadcast(room, null, { type: "user-left", userId });
    if (room.users.size === 0) rooms.delete(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`🟢 Blankr running → http://localhost:${PORT}`);
});

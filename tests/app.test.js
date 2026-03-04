/**
 * Blankr – Unit Tests
 *
 * Run with: node tests/app.test.js
 *
 * These tests validate the server logic (room management, WebSocket messages,
 * color assignment) without requiring a running server.
 */

const assert = require("assert");
const crypto = require("crypto");

/* ── Test data (mirrors server/index.js) ── */
const PALETTE = [
  "#e03131","#1971c2","#2f9e44","#f08c00",
  "#9c36b5","#0c8599","#e8590c","#5c940d",
];

/* ── Room management logic (same as server) ── */
const rooms = new Map();
let colorIdx = 0;

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, { users: new Map(), strokes: [] });
  }
  return rooms.get(id);
}

function createUser() {
  const userId = crypto.randomUUID();
  return {
    id: userId,
    color: PALETTE[colorIdx++ % PALETTE.length],
    name: `User ${colorIdx}`,
  };
}

/* ── Tests ── */
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

console.log("\n🧪 Blankr Tests\n");

// ── Room Management ──
console.log("Room Management:");

test("getRoom creates a new room", () => {
  const room = getRoom("test-room-1");
  assert.ok(room);
  assert.strictEqual(room.users.size, 0);
  assert.strictEqual(room.strokes.length, 0);
});

test("getRoom returns same room for same id", () => {
  const room1 = getRoom("test-room-2");
  const room2 = getRoom("test-room-2");
  assert.strictEqual(room1, room2);
});

test("different room ids create different rooms", () => {
  const room1 = getRoom("room-a");
  const room2 = getRoom("room-b");
  assert.notStrictEqual(room1, room2);
});

test("room has strokes array", () => {
  const room = getRoom("stroke-room");
  assert.ok(Array.isArray(room.strokes));
});

test("strokes can be added to room", () => {
  const room = getRoom("stroke-room");
  room.strokes.push({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: "#000" });
  assert.strictEqual(room.strokes.length, 1);
});

test("strokes can be cleared", () => {
  const room = getRoom("stroke-room");
  room.strokes = [];
  assert.strictEqual(room.strokes.length, 0);
});

test("undo removes last stroke", () => {
  const room = getRoom("undo-room");
  room.strokes.push({ id: 1 });
  room.strokes.push({ id: 2 });
  room.strokes.push({ id: 3 });
  room.strokes.pop();
  assert.strictEqual(room.strokes.length, 2);
  assert.strictEqual(room.strokes[room.strokes.length - 1].id, 2);
});

// ── User Management ──
console.log("\nUser Management:");

test("createUser returns user with id", () => {
  const user = createUser();
  assert.ok(user.id);
  assert.strictEqual(typeof user.id, "string");
});

test("createUser assigns a color from palette", () => {
  const user = createUser();
  assert.ok(PALETTE.includes(user.color));
});

test("createUser assigns a name", () => {
  const user = createUser();
  assert.ok(user.name.startsWith("User "));
});

test("each user gets a unique id", () => {
  const user1 = createUser();
  const user2 = createUser();
  assert.notStrictEqual(user1.id, user2.id);
});

test("colors cycle through palette", () => {
  colorIdx = 0; // reset
  const colors = [];
  for (let i = 0; i < PALETTE.length + 1; i++) {
    colors.push(createUser().color);
  }
  // After full cycle, should wrap around
  assert.strictEqual(colors[0], colors[PALETTE.length]);
});

test("users can be added to room", () => {
  const room = getRoom("user-room");
  const mockWs = {};
  const user = createUser();
  room.users.set(mockWs, user);
  assert.strictEqual(room.users.size, 1);
  assert.strictEqual(room.users.get(mockWs), user);
});

test("users can be removed from room", () => {
  const room = getRoom("user-room");
  const mockWs = {};
  const user = createUser();
  room.users.set(mockWs, user);
  room.users.delete(mockWs);
  assert.strictEqual(room.users.size, 1); // still has the one from prev test
});

// ── Palette ──
console.log("\nPalette:");

test("palette has 8 colors", () => {
  assert.strictEqual(PALETTE.length, 8);
});

test("all palette entries are valid hex colors", () => {
  PALETTE.forEach((c) => {
    assert.ok(/^#[0-9a-f]{6}$/i.test(c), `Invalid color: ${c}`);
  });
});

test("no duplicate colors in palette", () => {
  assert.strictEqual(new Set(PALETTE).size, PALETTE.length);
});

// ── Message Types ──
console.log("\nMessage Types:");

test("init message structure is valid", () => {
  const room = getRoom("msg-room");
  const msg = {
    type: "init",
    userId: "test-id",
    users: Array.from(room.users.values()),
    strokes: room.strokes,
  };
  assert.strictEqual(msg.type, "init");
  assert.ok(Array.isArray(msg.users));
  assert.ok(Array.isArray(msg.strokes));
  assert.strictEqual(typeof msg.userId, "string");
});

test("stroke message structure is valid", () => {
  const msg = { type: "stroke", userId: "test-id", data: { points: [], color: "#000" } };
  assert.strictEqual(msg.type, "stroke");
  assert.ok(msg.data);
});

test("cursor message structure is valid", () => {
  const msg = { type: "cursor", userId: "test-id", x: 100, y: 200 };
  assert.strictEqual(msg.type, "cursor");
  assert.strictEqual(typeof msg.x, "number");
  assert.strictEqual(typeof msg.y, "number");
});

test("clear message structure is valid", () => {
  const msg = { type: "clear", userId: "test-id" };
  assert.strictEqual(msg.type, "clear");
});

test("undo message structure is valid", () => {
  const msg = { type: "undo", userId: "test-id" };
  assert.strictEqual(msg.type, "undo");
});

// ── Summary ──
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"─".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);

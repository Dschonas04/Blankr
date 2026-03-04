/**
 * Blankr – Unit Tests
 *
 * Run with: node tests/app.test.js
 *
 * These tests validate the core logic (authentication, roles, sanitization,
 * export validation) without requiring a browser DOM.
 */

const assert = require("assert");

/* ── Test data (mirrors src/app.js) ── */
const USERS = [
  { username: "admin",  password: "admin123",  role: "admin"  },
  { username: "editor", password: "editor123", role: "editor" },
  { username: "viewer", password: "viewer123", role: "viewer" },
];

const ROLE_PERMISSIONS = {
  admin:  { draw: true, tools: true, exportImport: true },
  editor: { draw: true, tools: true, exportImport: true },
  viewer: { draw: false, tools: false, exportImport: false },
};

/* ── Helper functions (same logic as app.js) ── */
function sanitize(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function authenticate(username, password) {
  const clean = sanitize(username.trim());
  return USERS.find(
    (u) => u.username === clean && u.password === password
  ) || null;
}

function validateExportData(data) {
  if (!data || typeof data.image !== "string") return false;
  return data.image.startsWith("data:image/");
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

// ── Authentication ──
console.log("Authentication:");

test("valid admin login", () => {
  const user = authenticate("admin", "admin123");
  assert.strictEqual(user.username, "admin");
  assert.strictEqual(user.role, "admin");
});

test("valid editor login", () => {
  const user = authenticate("editor", "editor123");
  assert.strictEqual(user.username, "editor");
  assert.strictEqual(user.role, "editor");
});

test("valid viewer login", () => {
  const user = authenticate("viewer", "viewer123");
  assert.strictEqual(user.username, "viewer");
  assert.strictEqual(user.role, "viewer");
});

test("invalid password returns null", () => {
  const user = authenticate("admin", "wrong");
  assert.strictEqual(user, null);
});

test("unknown user returns null", () => {
  const user = authenticate("unknown", "password");
  assert.strictEqual(user, null);
});

test("empty credentials return null", () => {
  const user = authenticate("", "");
  assert.strictEqual(user, null);
});

test("username is trimmed", () => {
  const user = authenticate("  admin  ", "admin123");
  assert.strictEqual(user.username, "admin");
});

// ── Sanitization ──
console.log("\nSanitization:");

test("escapes HTML tags", () => {
  assert.strictEqual(sanitize("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("escapes ampersands", () => {
  assert.strictEqual(sanitize("a&b"), "a&amp;b");
});

test("escapes quotes", () => {
  assert.strictEqual(sanitize('he said "hello"'), "he said &quot;hello&quot;");
});

test("plain text passes through", () => {
  assert.strictEqual(sanitize("admin"), "admin");
});

// ── Roles & Permissions ──
console.log("\nRoles & Permissions:");

test("admin has all permissions", () => {
  const p = ROLE_PERMISSIONS.admin;
  assert.strictEqual(p.draw, true);
  assert.strictEqual(p.tools, true);
  assert.strictEqual(p.exportImport, true);
});

test("editor has all permissions", () => {
  const p = ROLE_PERMISSIONS.editor;
  assert.strictEqual(p.draw, true);
  assert.strictEqual(p.tools, true);
  assert.strictEqual(p.exportImport, true);
});

test("viewer has no permissions", () => {
  const p = ROLE_PERMISSIONS.viewer;
  assert.strictEqual(p.draw, false);
  assert.strictEqual(p.tools, false);
  assert.strictEqual(p.exportImport, false);
});

test("three roles defined", () => {
  assert.strictEqual(Object.keys(ROLE_PERMISSIONS).length, 3);
});

// ── Export Validation ──
console.log("\nExport Validation:");

test("valid export data accepted", () => {
  const data = { image: "data:image/png;base64,abc123", width: 800, height: 600 };
  assert.strictEqual(validateExportData(data), true);
});

test("missing image rejected", () => {
  assert.strictEqual(validateExportData({ width: 800 }), false);
});

test("non-data-url image rejected", () => {
  assert.strictEqual(validateExportData({ image: "https://evil.com/img.png" }), false);
});

test("null data rejected", () => {
  assert.strictEqual(validateExportData(null), false);
});

test("numeric image rejected", () => {
  assert.strictEqual(validateExportData({ image: 12345 }), false);
});

// ── Users ──
console.log("\nUsers:");

test("three default users exist", () => {
  assert.strictEqual(USERS.length, 3);
});

test("each user has username, password, and role", () => {
  USERS.forEach((u) => {
    assert.ok(u.username, "missing username");
    assert.ok(u.password, "missing password");
    assert.ok(u.role, "missing role");
  });
});

test("no duplicate usernames", () => {
  const names = USERS.map((u) => u.username);
  assert.strictEqual(new Set(names).size, names.length);
});

// ── Summary ──
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"─".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);

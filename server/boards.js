/**
 * Board-Ablage.
 *
 * Ein Board ist eine JSON-Datei mit dem CRDT-Schnappschuss, dazu ein Index
 * mit Namen und Zeitstempeln. Bewusst keine Datenbank: die Datenmenge ist
 * klein, und ein Verzeichnis mit lesbaren Dateien laesst sich sichern,
 * kopieren und im Zweifel von Hand reparieren.
 *
 * Geschrieben wird immer erst in eine temporaere Datei und dann umbenannt.
 * rename() ist auf einem POSIX-Dateisystem atomar -- ein Absturz mitten im
 * Schreiben kann so kein halbes Board hinterlassen.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.BLANKR_DATA || path.join(process.cwd(), 'data');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

let index = { boards: [] };

export async function init() {
  await fs.mkdir(BOARDS_DIR, { recursive: true });
  try {
    index = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
    if (!Array.isArray(index.boards)) index = { boards: [] };
  } catch {
    index = { boards: [] };
  }
  return index.boards.length;
}

async function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

let indexTimer = null;
function persistIndex() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    writeAtomic(INDEX_FILE, JSON.stringify(index, null, 2)).catch((err) =>
      console.error('Index konnte nicht geschrieben werden:', err.message),
    );
  }, 300);
}

export function listBoards() {
  return [...index.boards].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getBoardMeta(id) {
  return index.boards.find((b) => b.id === id) || null;
}

export function createBoard(name) {
  const board = {
    id: randomUUID().slice(0, 8),
    name: String(name || 'Neues Board').slice(0, 80),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  index.boards.push(board);
  persistIndex();
  return board;
}

export function renameBoard(id, name) {
  const board = getBoardMeta(id);
  if (!board) return null;
  board.name = String(name || board.name).slice(0, 80);
  board.updatedAt = Date.now();
  persistIndex();
  return board;
}

export async function removeBoard(id) {
  const before = index.boards.length;
  index.boards = index.boards.filter((b) => b.id !== id);
  if (index.boards.length === before) return false;
  persistIndex();
  await fs.rm(boardFile(id), { force: true });
  return true;
}

function boardFile(id) {
  // Nur die eigenen IDs zulassen -- verhindert, dass ein praeparierter
  // Board-Name aus dem Verzeichnis herausfuehrt.
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(BOARDS_DIR, `${safe}.json`);
}

export async function loadSnapshot(id) {
  try {
    return JSON.parse(await fs.readFile(boardFile(id), 'utf8'));
  } catch {
    return { clock: 0, entries: [] };
  }
}

/* Schreiben wird gebuendelt: bei aktivem Zeichnen aendert sich ein Board
   viele Male pro Sekunde, auf die Platte muss es aber nur gelegentlich. */
const pending = new Map();

export function scheduleSave(id, getSnapshot, delay = 2000) {
  if (pending.has(id)) return;
  const timer = setTimeout(async () => {
    pending.delete(id);
    try {
      const snap = getSnapshot();
      if (!snap) return; // Board wurde inzwischen entladen
      await writeAtomic(boardFile(id), JSON.stringify(snap));
      const meta = getBoardMeta(id);
      if (meta) {
        meta.updatedAt = Date.now();
        persistIndex();
      }
    } catch (err) {
      console.error(`Board ${id} konnte nicht gespeichert werden:`, err.message);
    }
  }, delay);
  pending.set(id, timer);
}

/** Alle ausstehenden Schreibvorgaenge sofort ausfuehren (Shutdown). */
export async function flushAll(snapshotFor) {
  for (const [id, timer] of pending) {
    clearTimeout(timer);
    try {
      const snap = snapshotFor(id);
      if (snap) await writeAtomic(boardFile(id), JSON.stringify(snap));
    } catch (err) {
      console.error(`Board ${id} konnte beim Beenden nicht gespeichert werden:`, err.message);
    }
  }
  pending.clear();
  clearTimeout(indexTimer);
  await writeAtomic(INDEX_FILE, JSON.stringify(index, null, 2)).catch(() => {});
}

export { DATA_DIR };

/** Tests der Board-Ablage gegen ein echtes, temporaeres Datenverzeichnis. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blankr-test-'));
process.env.BLANKR_DATA = dir;
const boards = await import('../server/boards.js');

test('Boards werden angelegt, gefunden und sortiert', async () => {
  await boards.init();
  const a = boards.createBoard('Sprint Planung');
  const b = boards.createBoard('Architektur');
  assert.equal(boards.getBoardMeta(a.id).name, 'Sprint Planung');

  // Nach Aktualisierungszeit absteigend
  boards.renameBoard(a.id, 'Sprint Planung Q3');
  const list = boards.listBoards();
  assert.equal(list[0].id, a.id);
  assert.equal(list.length, 2);
  assert.ok(list.some((x) => x.id === b.id));
});

test('Schnappschuss wird geschrieben und wieder gelesen', async () => {
  const board = boards.createBoard('Speichertest');
  const snap = { clock: 7, entries: [{ id: 's1', clock: 7, site: 'a', deleted: false, kind: 'stroke', data: { v: 1 } }] };
  boards.scheduleSave(board.id, () => snap, 0);
  await new Promise((r) => setTimeout(r, 60));

  const read = await boards.loadSnapshot(board.id);
  assert.deepEqual(read, snap);
});

test('unbekanntes Board liefert ein leeres Dokument statt eines Fehlers', async () => {
  assert.deepEqual(await boards.loadSnapshot('gibtsnicht'), { clock: 0, entries: [] });
});

test('Board-IDs koennen nicht aus dem Datenverzeichnis herausfuehren', async () => {
  // Ein praeparierter Pfad darf keine Datei ausserhalb von data/boards anlegen.
  boards.scheduleSave('../../etc/passwd', () => ({ clock: 1, entries: [] }), 0);
  await new Promise((r) => setTimeout(r, 60));
  const files = await fs.readdir(path.join(dir, 'boards'));
  assert.ok(files.every((f) => f.endsWith('.json')));
  assert.ok(files.includes('etcpasswd.json'), 'Pfadanteile werden entfernt, nicht befolgt');
});

test('Loeschen entfernt Eintrag und Datei', async () => {
  const board = boards.createBoard('Wegwerf');
  boards.scheduleSave(board.id, () => ({ clock: 1, entries: [] }), 0);
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(await boards.removeBoard(board.id), true);
  assert.equal(boards.getBoardMeta(board.id), null);
  await assert.rejects(fs.access(path.join(dir, 'boards', `${board.id}.json`)));
  assert.equal(await boards.removeBoard(board.id), false, 'zweites Loeschen meldet false');
});

test.after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

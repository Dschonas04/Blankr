/**
 * Tests fuer die Synchronisation.
 *
 * Geprueft wird der echte Code aus shared/ und client/src/sync/ -- nicht,
 * wie frueher, eine im Testfile nachgebaute Kopie der Serverlogik.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOp,
  applyOps,
  collectGarbage,
  createDoc,
  deleteEntry,
  lastWriter,
  live,
  loadSnapshot,
  setEntry,
  snapshot,
  snapshotOps,
} from '../shared/lww.mjs';
import { diffToOps, docToLayers, ensureIds } from '../client/src/sync/project.js';

const layer = (id, strokes = []) => ({ id, name: 'Ebene 1', visible: true, opacity: 1, strokes });

test('spaetere Schreiber gewinnen', () => {
  const doc = createDoc('a');
  applyOp(doc, { t: 'set', id: 'x', kind: 'stroke', data: { v: 1 }, clock: 1, site: 'a' });
  applyOp(doc, { t: 'set', id: 'x', kind: 'stroke', data: { v: 2 }, clock: 5, site: 'b' });
  assert.equal(doc.entries.get('x').data.v, 2);
});

test('bei gleicher Uhr entscheidet die Site-ID', () => {
  const docA = createDoc('a');
  const docB = createDoc('b');
  const opA = { t: 'set', id: 'x', kind: 'stroke', data: { v: 'a' }, clock: 3, site: 'a' };
  const opB = { t: 'set', id: 'x', kind: 'stroke', data: { v: 'b' }, clock: 3, site: 'b' };
  // Gleiche Operationen, entgegengesetzte Reihenfolge -> gleiches Ergebnis
  applyOps(docA, [opA, opB]);
  applyOps(docB, [opB, opA]);
  assert.equal(docA.entries.get('x').data.v, 'b');
  assert.deepEqual(docA.entries.get('x'), docB.entries.get('x'));
});

test('Operationen sind idempotent und kommutativ', () => {
  const ops = [
    { t: 'set', id: 'a', kind: 'stroke', data: { n: 1 }, clock: 1, site: 's1' },
    { t: 'set', id: 'b', kind: 'stroke', data: { n: 2 }, clock: 2, site: 's2' },
    { t: 'del', id: 'a', kind: 'stroke', clock: 3, site: 's2' },
    { t: 'set', id: 'b', kind: 'stroke', data: { n: 3 }, clock: 4, site: 's1' },
  ];
  const inOrder = createDoc('x');
  applyOps(inOrder, ops);

  const shuffled = createDoc('y');
  applyOps(shuffled, [ops[3], ops[2], ops[1], ops[0]]);
  // doppelt zugestellt
  applyOps(shuffled, ops);

  assert.deepEqual(
    live(inOrder, 'stroke').map((e) => [e.id, e.data]),
    live(shuffled, 'stroke').map((e) => [e.id, e.data]),
  );
  assert.equal(live(inOrder, 'stroke').length, 1);
});

test('eine verspaetete Aenderung belebt ein geloeschtes Objekt nicht wieder', () => {
  const doc = createDoc('a');
  applyOp(doc, { t: 'set', id: 'x', kind: 'stroke', data: { v: 1 }, clock: 10, site: 'a' });
  applyOp(doc, { t: 'del', id: 'x', kind: 'stroke', clock: 20, site: 'b' });
  // Nachzuegler mit alter Uhr
  applyOp(doc, { t: 'set', id: 'x', kind: 'stroke', data: { v: 2 }, clock: 15, site: 'a' });
  assert.equal(live(doc, 'stroke').length, 0);
});

test('Schnappschuss ueberlebt Serialisieren', () => {
  const doc = createDoc('a');
  setEntry(doc, 'l1', 'layer', { name: 'Ebene 1', visible: true, opacity: 1, order: 0 });
  setEntry(doc, 's1', 'stroke', { type: 'pen', layerId: 'l1', order: 0 });
  deleteEntry(doc, 's1');
  setEntry(doc, 's2', 'stroke', { type: 'rect', layerId: 'l1', order: 0 });

  const round = loadSnapshot(JSON.parse(JSON.stringify(snapshot(doc))), 'b');
  assert.equal(live(round, 'stroke').length, 1);
  assert.equal(live(round, 'stroke')[0].data.type, 'rect');
  assert.equal(round.clock, doc.clock);
  // Der Grabstein muss mitkommen, sonst kaeme s1 beim naechsten Abgleich zurueck.
  assert.equal(round.entries.get('s1').deleted, true);
});

test('snapshotOps stellt ein Dokument vollstaendig wieder her', () => {
  const source = createDoc('a');
  setEntry(source, 'l1', 'layer', { name: 'A', visible: true, opacity: 1, order: 0 });
  setEntry(source, 's1', 'stroke', { type: 'pen', layerId: 'l1', order: 0 });
  const target = createDoc('b');
  applyOps(target, snapshotOps(source));
  assert.deepEqual(snapshot(target).entries, snapshot(source).entries);
});

test('Grabsteine werden erst aufgeraeumt, wenn es sich lohnt', () => {
  const doc = createDoc('a');
  setEntry(doc, 's1', 'stroke', { v: 1 });
  deleteEntry(doc, 's1');
  assert.equal(collectGarbage(doc, 5000), 0, 'kleine Dokumente bleiben unangetastet');
  assert.equal(doc.entries.size, 1);
  assert.equal(collectGarbage(doc, 0), 1, 'ab der Schwelle wird geraeumt');
  assert.equal(doc.entries.size, 0);
});

test('ensureIds vergibt fehlende IDs und laesst vorhandene in Ruhe', () => {
  const withIds = [layer('l1', [{ id: 's1', type: 'pen' }])];
  assert.equal(ensureIds(withIds, 'site'), withIds, 'unveraendert -> selbe Referenz');

  const without = [{ name: 'Ebene 1', visible: true, opacity: 1, strokes: [{ type: 'pen' }] }];
  const fixed = ensureIds(without, 'site');
  assert.ok(fixed[0].id);
  assert.ok(fixed[0].strokes[0].id);
});

test('diffToOps meldet nur tatsaechliche Aenderungen', () => {
  const doc = createDoc('a');
  const s1 = { id: 's1', type: 'pen', x: 0 };
  const layers = [layer('l1', [s1])];

  assert.equal(diffToOps(doc, layers).length, 2, 'Ebene und Strich neu');
  assert.equal(diffToOps(doc, layers).length, 0, 'unveraendert -> keine Operationen');

  // Der Editor ersetzt bei einer Aenderung genau das betroffene Objekt.
  const moved = { ...s1, x: 40 };
  const ops = diffToOps(doc, [layer('l1', [moved])]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].id, 's1');
  assert.equal(ops[0].data.x, 40);
});

test('diffToOps erzeugt Loeschungen fuer entfernte Objekte', () => {
  const doc = createDoc('a');
  diffToOps(doc, [layer('l1', [{ id: 's1', type: 'pen' }, { id: 's2', type: 'rect' }])]);
  const ops = diffToOps(doc, [layer('l1', [{ id: 's1', type: 'pen' }])]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].t, 'del');
  assert.equal(ops[0].id, 's2');
});

test('unveraenderte Objekte werden nach einem Rueckgaengig nicht neu verschickt', () => {
  const doc = createDoc('a');
  const layers = [layer('l1', [{ id: 's1', type: 'pen' }, { id: 's2', type: 'rect' }])];
  diffToOps(doc, layers);

  // Rueckgaengig arbeitet mit einer tiefen Kopie -- jede Referenz ist neu,
  // die Daten sind aber identisch.
  const copy = JSON.parse(JSON.stringify(layers));
  assert.equal(diffToOps(doc, copy).length, 0);
});

test('zwei Clients laufen nach gegenseitigem Austausch zusammen', () => {
  const docA = createDoc('aaa');
  const docB = createDoc('bbb');

  // A legt die Ebene an, B uebernimmt sie
  const setup = diffToOps(docA, [layer('l1', [])]);
  applyOps(docB, setup);

  // Beide zeichnen gleichzeitig je ein Objekt
  const opsA = diffToOps(docA, [layer('l1', [{ id: 'sA', type: 'pen' }])]);
  const opsB = diffToOps(docB, [layer('l1', [{ id: 'sB', type: 'rect' }])]);

  applyOps(docA, opsB);
  applyOps(docB, opsA);

  const layersA = docToLayers(docA);
  const layersB = docToLayers(docB);
  assert.equal(layersA[0].strokes.length, 2);
  assert.deepEqual(
    layersA[0].strokes.map((s) => s.id),
    layersB[0].strokes.map((s) => s.id),
    'gleiche Reihenfolge auf beiden Seiten',
  );
});

test('docToLayers stellt Ebenen und Reihenfolge wieder her', () => {
  const doc = createDoc('a');
  setEntry(doc, 'l1', 'layer', { name: 'Unten', visible: true, opacity: 1, order: 0 });
  setEntry(doc, 'l2', 'layer', { name: 'Oben', visible: false, opacity: 0.5, order: 1 });
  setEntry(doc, 's2', 'stroke', { id: 's2', type: 'rect', layerId: 'l1', order: 1 });
  setEntry(doc, 's1', 'stroke', { id: 's1', type: 'pen', layerId: 'l1', order: 0 });

  const layers = docToLayers(doc);
  assert.equal(layers.length, 2);
  assert.equal(layers[0].name, 'Unten');
  assert.equal(layers[1].visible, false);
  assert.deepEqual(layers[0].strokes.map((s) => s.id), ['s1', 's2']);
  // layerId und order sind Transportfelder und gehoeren nicht in den Strich
  assert.equal('layerId' in layers[0].strokes[0], false);
});

test('lastWriter kennt den Urheber -- Grundlage fuer lokales Rueckgaengig', () => {
  const doc = createDoc('me');
  setEntry(doc, 's1', 'stroke', { v: 1 });
  applyOp(doc, { t: 'set', id: 's2', kind: 'stroke', data: { v: 1 }, clock: 99, site: 'other' });
  assert.equal(lastWriter(doc, 's1'), 'me');
  assert.equal(lastWriter(doc, 's2'), 'other');
});

/**
 * Dieselben Testvektoren wie server/lww_test.go.
 *
 * Die Zusammenfuehrung existiert zweimal -- in JavaScript fuer den Browser
 * und in Go fuer den Server. Beide muessen bitgenau dasselbe rechnen, sonst
 * laufen die Staende auseinander. Diese Datei und ihr Go-Gegenstueck lesen
 * dieselbe JSON-Datei, damit eine Aenderung an nur einer Implementierung
 * sofort auffaellt.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOps, createDoc, live } from '../shared/lww.mjs';

const vectors = JSON.parse(
  readFileSync(new URL('../shared/testvectors.json', import.meta.url), 'utf8'),
);

const liveSorted = (doc) =>
  live(doc, null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({ id: e.id, clock: e.clock, site: e.site, data: e.data }));

for (const c of vectors.cases) {
  test(`Vektor: ${c.name}`, () => {
    const reihenfolgen = {
      vorwaerts: c.ops,
      rueckwaerts: [...c.ops].reverse(),
      doppelt: [...c.ops, ...c.ops],
    };

    const erwartet = [...c.expect].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    for (const [name, ops] of Object.entries(reihenfolgen)) {
      const doc = createDoc('test');
      applyOps(doc, ops);
      assert.deepEqual(
        liveSorted(doc),
        erwartet.map((e) => ({ id: e.id, clock: e.clock, site: e.site, data: e.data })),
        `Reihenfolge "${name}" weicht ab`,
      );
    }
  });
}

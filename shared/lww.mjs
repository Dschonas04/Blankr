/**
 * LWW-Element-Set — der CRDT-Kern von Blankr.
 *
 * Wird unveraendert von Client und Server benutzt, damit beide Seiten
 * garantiert dieselbe Zusammenfuehrung rechnen.
 *
 * Modell: ein Dokument ist eine Menge von Eintraegen, jeder mit stabiler ID.
 * Jeder Eintrag traegt eine Lamport-Uhr und die Site-ID seines letzten
 * Schreibers. Beim Zusammenfuehren gewinnt die hoehere Uhr; bei Gleichstand
 * die lexikografisch groessere Site-ID. Diese Regel ist kommutativ,
 * assoziativ und idempotent -- Operationen duerfen also in beliebiger
 * Reihenfolge, mehrfach und verspaetet eintreffen und ergeben trotzdem
 * ueberall denselben Zustand.
 *
 * Loeschen setzt einen Grabstein statt den Eintrag zu entfernen. Sonst
 * koennte eine verspaetete Aenderung ein geloeschtes Objekt wieder
 * auferstehen lassen.
 */

/** @typedef {{ id: string, clock: number, site: string, deleted: boolean, kind: string, data: object|null }} Entry */

export function createDoc(site) {
  return { site, clock: 0, entries: new Map() };
}

/** Naechster Zeitstempel dieser Site. */
export function tick(doc) {
  doc.clock += 1;
  return doc.clock;
}

/** Fremde Uhr beobachten -- haelt die eigene Uhr immer voraus. */
export function observe(doc, clock) {
  if (clock > doc.clock) doc.clock = clock;
}

/** Gewinnt a gegen b? */
function wins(a, b) {
  if (!b) return true;
  if (a.clock !== b.clock) return a.clock > b.clock;
  return a.site > b.site;
}

/**
 * Wendet eine Operation an.
 * @returns {boolean} true, wenn sich das Dokument dadurch geaendert hat
 */
export function applyOp(doc, op) {
  observe(doc, op.clock);
  const current = doc.entries.get(op.id);
  const incoming = {
    id: op.id,
    clock: op.clock,
    site: op.site,
    deleted: op.t === 'del',
    kind: op.kind || current?.kind || 'stroke',
    data: op.t === 'del' ? null : op.data,
  };
  if (!wins(incoming, current)) return false;
  doc.entries.set(op.id, incoming);
  return true;
}

export function applyOps(doc, ops) {
  let changed = false;
  for (const op of ops) {
    if (applyOp(doc, op)) changed = true;
  }
  return changed;
}

export function setEntry(doc, id, kind, data) {
  const op = { t: 'set', id, kind, data, clock: tick(doc), site: doc.site };
  applyOp(doc, op);
  return op;
}

export function deleteEntry(doc, id) {
  const existing = doc.entries.get(id);
  const op = { t: 'del', id, kind: existing?.kind || 'stroke', clock: tick(doc), site: doc.site };
  applyOp(doc, op);
  return op;
}

/** Alle lebenden Eintraege einer Art. */
export function live(doc, kind) {
  const out = [];
  for (const e of doc.entries.values()) {
    if (!e.deleted && (!kind || e.kind === kind)) out.push(e);
  }
  return out;
}

export function lastWriter(doc, id) {
  return doc.entries.get(id)?.site || null;
}

/** Vollstaendiger Zustand als transportierbares Objekt. */
export function snapshot(doc) {
  return {
    clock: doc.clock,
    entries: Array.from(doc.entries.values()),
  };
}

export function loadSnapshot(snap, site) {
  const doc = createDoc(site);
  if (!snap || !Array.isArray(snap.entries)) return doc;
  for (const e of snap.entries) {
    if (!e || typeof e.id !== 'string') continue;
    doc.entries.set(e.id, {
      id: e.id,
      clock: Number(e.clock) || 0,
      site: String(e.site || '?'),
      deleted: !!e.deleted,
      kind: e.kind || 'stroke',
      data: e.deleted ? null : e.data || null,
    });
  }
  doc.clock = Math.max(Number(snap.clock) || 0, ...Array.from(doc.entries.values(), (e) => e.clock), 0);
  return doc;
}

/** Snapshot als Operationsfolge -- fuer den Erstabgleich beim Verbinden. */
export function snapshotOps(doc) {
  return Array.from(doc.entries.values(), (e) =>
    e.deleted
      ? { t: 'del', id: e.id, kind: e.kind, clock: e.clock, site: e.site }
      : { t: 'set', id: e.id, kind: e.kind, data: e.data, clock: e.clock, site: e.site },
  );
}

/**
 * Grabsteine aufraeumen. Nur fuer Eintraege, die lange genug tot sind, dass
 * keine verspaetete Operation sie mehr wiederbeleben kann.
 */
export function collectGarbage(doc, keepEntries = 5000) {
  const dead = live(doc, null).length;
  const total = doc.entries.size;
  if (total - dead < keepEntries) return 0;
  let removed = 0;
  for (const [id, e] of doc.entries) {
    if (e.deleted) {
      doc.entries.delete(id);
      removed += 1;
    }
  }
  return removed;
}

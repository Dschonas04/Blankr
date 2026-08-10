/**
 * Uebersetzung zwischen dem CRDT-Dokument und der Ebenen-/Strichstruktur,
 * mit der der Editor arbeitet.
 *
 * Der Editor adressiert Objekte weiterhin ueber Array-Indizes -- das ist
 * innerhalb eines Clients voellig in Ordnung und haette einen Umbau aller
 * Werkzeuge bedeutet. Nach aussen traegt aber jedes Objekt eine stabile ID,
 * und nur die wandert ueber das Netz. Diese Datei ist die Schleuse dazwischen.
 */

import { deleteEntry, live, setEntry } from '../../../shared/lww.mjs';

let counter = 0;
export function newId(site) {
  counter += 1;
  return `${site.slice(0, 6)}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/**
 * Merkt sich zu jeder ID die zuletzt abgeglichene Objektreferenz.
 * Damit erkennt der Abgleich Aenderungen ueber Referenzvergleich statt
 * ueber teures Serialisieren -- der Editor erzeugt bei jeder Aenderung
 * ohnehin neue Objekte fuer genau die betroffenen Striche.
 */
function refsOf(doc) {
  if (!doc.__refs) doc.__refs = new Map();
  return doc.__refs;
}

/** Vergibt fehlende IDs. Gibt dieselbe Referenz zurueck, wenn nichts fehlte. */
export function ensureIds(layers, site) {
  let touched = false;
  const out = layers.map((layer) => {
    let layerChanged = false;
    const id = layer.id || newId(site);
    if (!layer.id) layerChanged = true;

    const strokes = (layer.strokes || []).map((s) => {
      if (s && s.id) return s;
      layerChanged = true;
      return { ...s, id: newId(site) };
    });

    if (!layerChanged) return layer;
    touched = true;
    return { ...layer, id, strokes };
  });
  return touched ? out : layers;
}

/**
 * Vergleicht den aktuellen Editorzustand mit dem Dokument und erzeugt die
 * noetigen Operationen. Das Dokument wird dabei direkt mitgefuehrt.
 */
export function diffToOps(doc, layers) {
  const refs = refsOf(doc);
  const ops = [];
  const seen = new Set();

  layers.forEach((layer, layerIndex) => {
    seen.add(layer.id);
    const meta = { name: layer.name, visible: layer.visible, opacity: layer.opacity, order: layerIndex };
    const prevMeta = doc.entries.get(layer.id);
    if (
      !prevMeta ||
      prevMeta.deleted ||
      prevMeta.data.name !== meta.name ||
      prevMeta.data.visible !== meta.visible ||
      prevMeta.data.opacity !== meta.opacity ||
      prevMeta.data.order !== meta.order
    ) {
      ops.push(setEntry(doc, layer.id, 'layer', meta));
    }

    (layer.strokes || []).forEach((stroke, order) => {
      seen.add(stroke.id);
      const known = refs.get(stroke.id);
      const samePlace = known && known.order === order && known.layerId === layer.id;

      // Gleiche Referenz an gleicher Stelle -> garantiert unveraendert.
      if (samePlace && known.ref === stroke) return;

      // Andere Referenz heisst nicht zwingend andere Daten: Rueckgaengig und
      // das Laden eines Schnappschusses bauen jedes Objekt neu auf. Ohne
      // diesen Wertvergleich ginge danach das gesamte Board erneut ueber die
      // Leitung. Der Vergleich laeuft nur fuer Objekte, deren Referenz sich
      // geaendert hat -- im Zeichenbetrieb also fuer eine Handvoll.
      const json = JSON.stringify(stroke);
      if (samePlace && known.json === json) {
        refs.set(stroke.id, { ref: stroke, json, order, layerId: layer.id });
        return;
      }

      refs.set(stroke.id, { ref: stroke, json, order, layerId: layer.id });
      ops.push(setEntry(doc, stroke.id, 'stroke', { ...stroke, layerId: layer.id, order }));
    });
  });

  for (const entry of doc.entries.values()) {
    if (entry.deleted || seen.has(entry.id)) continue;
    refs.delete(entry.id);
    ops.push(deleteEntry(doc, entry.id));
  }

  return ops;
}

/** Baut aus dem Dokument die Ebenenstruktur fuer den Editor. */
export function docToLayers(doc) {
  const refs = refsOf(doc);
  const layerEntries = live(doc, 'layer').sort(
    (a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id),
  );

  const buckets = new Map();
  for (const entry of live(doc, 'stroke')) {
    const layerId = entry.data.layerId;
    if (!buckets.has(layerId)) buckets.set(layerId, []);
    buckets.get(layerId).push(entry);
  }

  const layers = layerEntries.map((entry) => {
    const bucket = (buckets.get(entry.id) || []).sort(
      // ID als zweites Kriterium: zwei Clients koennen gleichzeitig auf
      // derselben Position einfuegen, die Reihenfolge muss trotzdem
      // ueberall gleich herauskommen.
      (a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id),
    );
    const strokes = bucket.map((e, order) => {
      const { layerId: _l, order: _o, ...stroke } = e.data;
      refs.set(e.id, { ref: stroke, json: JSON.stringify(stroke), order, layerId: entry.id });
      return stroke;
    });
    return {
      id: entry.id,
      name: entry.data.name,
      visible: entry.data.visible,
      opacity: entry.data.opacity,
      strokes,
    };
  });

  return layers.length ? layers : null;
}

/** Vergisst die Referenzen -- nach einem Board-Wechsel noetig. */
export function resetRefs(doc) {
  doc.__refs = new Map();
}

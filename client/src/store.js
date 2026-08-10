/* ═══════════════════════════════════════
   Blankr — External Store
   useSyncExternalStore, ohne State-Bibliothek
   ═══════════════════════════════════════ */
import { useSyncExternalStore } from 'react';
import { createDoc, applyOps, lastWriter, loadSnapshot, snapshot } from '../../shared/lww.mjs';
import { diffToOps, docToLayers, ensureIds, newId, resetRefs } from './sync/project.js';

const MAX_HISTORY = 50;
const AUTOSAVE_KEY = 'blankr_state';

/**
 * Site-ID dieses Tabs.
 *
 * Absichtlich sessionStorage und nicht localStorage: zwei Tabs desselben
 * Browsers sind zwei unabhaengig schreibende Teilnehmer. Teilten sie sich
 * eine ID, koennten zwei gleichzeitige Aenderungen dieselbe Uhr und
 * dieselbe Site tragen -- dann greift die Konfliktregel nicht mehr und die
 * beiden Staende laufen auseinander. sessionStorage ueberlebt trotzdem das
 * Neuladen, sodass "meine Objekte" beim Rueckgaengigmachen meine bleiben.
 */
function loadSite() {
  try {
    let s = sessionStorage.getItem('blankr_site');
    if (!s) {
      s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem('blankr_site', s);
    }
    return s;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export const SITE = loadSite();
const doc = createDoc(SITE);

export function getDoc() {
  return doc;
}

/* ── Initial state ── */
const initial = {
  tool: 'select',
  color: '#1e1e1e',
  lineWidth: 3,
  opacity: 1,
  filled: false,
  fontSize: 20,
  bgPattern: 'dots',
  darkMode: false,
  fullscreen: false,
  view: { x: 0, y: 0, scale: 1 },
  layers: [{ id: newId(SITE), name: 'Ebene 1', visible: true, opacity: 1, strokes: [] }],
  activeLayer: 0,
  selectedIdxs: [],
  clipboard: [],
  gridSnap: false,
  stickyNotes: [],
  toastMsg: null,
  layerPanelOpen: false,
  chatOpen: false,
  chatMessages: [],
  contextMenu: null,
  collabConnected: false,
  collabRoom: null,
  collabBoardName: null,
  collabUsers: [],
  remoteCursors: {},
  boardPickerOpen: false,
  boards: [],
};

let state = { ...initial };
const listeners = new Set();
let undoStack = [];
let redoStack = [];

/* ── Operationen nach aussen ──
   Der Store kennt die Transportschicht nicht; collab.js meldet sich hier an.
   Das haelt die Abhaengigkeit einseitig und vermeidet einen Importzyklus. */
let opSink = null;
export function setOpSink(fn) {
  opSink = fn;
}

let applyingRemote = false;

/* ── Rueckgaengig-Punkte pro Geste ──
   Der Editor hat frueher beim Zeichnen, Verschieben und Loeschen auf dem
   Canvas gar keinen History-Eintrag angelegt -- Strg+Z konnte einen
   gezeichneten Strich also nie zuruecknehmen. Statt in jeder der rund
   zwanzig Schreibstellen einen Aufruf zu ergaenzen, klammert der Canvas
   eine Zeigergeste, und der Store legt darin genau einen Punkt an: den
   Zustand vor der ersten Aenderung. */
let gestureActive = false;
let gestureSnapshotTaken = false;

export function beginGesture() {
  gestureActive = true;
  gestureSnapshotTaken = false;
}

export function endGesture() {
  gestureActive = false;
}

/* ── Core ── */
function emit() {
  listeners.forEach((fn) => fn());
}

export function getState() {
  return state;
}

export function setState(partial) {
  const next = typeof partial === 'function' ? partial(state) : partial;

  // Jede Aenderung an den Ebenen laeuft durch genau diesen Punkt: sie wird
  // mit dem CRDT-Dokument abgeglichen und als Operationsfolge verschickt.
  // Dadurch mussten die rund 20 Schreibstellen im Editor nicht angefasst
  // werden -- und keine kann den Abgleich versehentlich umgehen.
  if (next && next.layers && next.layers !== state.layers && !applyingRemote) {
    if (gestureActive && !gestureSnapshotTaken) {
      gestureSnapshotTaken = true;
      pushUndo();
    }
    next.layers = ensureIds(next.layers, SITE);
    const ops = diffToOps(doc, next.layers);
    if (ops.length && opSink) opSink(ops);
  }

  state = { ...state, ...next };
  emit();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(selector) {
  return useSyncExternalStore(subscribe, () => selector(state));
}

/* ── Eingehende Operationen ── */
export function applyRemoteOps(ops) {
  if (!applyOps(doc, ops)) return;
  const layers = docToLayers(doc);
  if (!layers) return;
  applyingRemote = true;
  try {
    // Die Auswahl zeigt auf Indizes; wenn fremde Objekte dazwischenrutschen,
    // zeigt sie ins Leere. Lieber aufheben als das falsche Objekt bearbeiten.
    setState({ layers, selectedIdxs: [] });
  } finally {
    applyingRemote = false;
  }
  scheduleAutosave();
}

/** Vollstaendiger Zustand vom Server (Beitritt oder Wiederverbindung). */
export function replaceFromSnapshot(snap) {
  const fresh = loadSnapshot(snap, SITE);
  doc.entries = fresh.entries;
  doc.clock = fresh.clock;
  resetRefs(doc);
  const layers = docToLayers(doc);
  applyingRemote = true;
  try {
    setState({
      layers: layers || [{ id: newId(SITE), name: 'Ebene 1', visible: true, opacity: 1, strokes: [] }],
      selectedIdxs: [],
      activeLayer: 0,
    });
  } finally {
    applyingRemote = false;
  }
  undoStack = [];
  redoStack = [];
}

/** Eigener Zustand als Startpunkt fuer ein neues, leeres Board. */
export function currentSnapshot() {
  return snapshot(doc);
}

/* ── History ── */
export function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(state.layers)));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

/**
 * Stellt einen frueheren Stand her -- aber nur fuer Objekte, die zuletzt
 * von diesem Client geschrieben wurden.
 *
 * Ein naives Zurueckspielen des kompletten Schnappschusses wuerde in einer
 * gemeinsamen Sitzung fremde Aenderungen mit rueckgaengig machen. Das war
 * der Grund, warum "undo" vorher als globales "letzten Strich entfernen"
 * ueber alle Teilnehmer lief.
 */
function restoreOwn(target) {
  // "Meine" Objekte sind die, bei denen ich der letzte Schreiber war --
  // Grabsteine eingeschlossen, sonst liesse sich ein eigenes Loeschen
  // nicht zuruecknehmen.
  const isOwn = (id) => lastWriter(doc, id) === SITE;

  return state.layers.map((layer, i) => {
    const targetOwn = new Map();
    for (const s of target[i]?.strokes || []) {
      if (isOwn(s.id)) targetOwn.set(s.id, s);
    }

    const strokes = [];
    for (const s of layer.strokes || []) {
      if (!isOwn(s.id)) {
        strokes.push(s); // fremdes Objekt bleibt unangetastet
      } else if (targetOwn.has(s.id)) {
        strokes.push(targetOwn.get(s.id)); // eigenes Objekt auf den alten Stand
        targetOwn.delete(s.id);
      }
      // eigenes Objekt, das es damals nicht gab -> faellt weg
    }
    // eigene Objekte, die damals existierten und inzwischen geloescht wurden
    for (const s of targetOwn.values()) strokes.push(s);

    return { ...layer, strokes };
  });
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.parse(JSON.stringify(state.layers)));
  const target = undoStack.pop();
  setState({ layers: state.collabConnected ? restoreOwn(target) : target, selectedIdxs: [] });
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.parse(JSON.stringify(state.layers)));
  const target = redoStack.pop();
  setState({ layers: state.collabConnected ? restoreOwn(target) : target, selectedIdxs: [] });
}

/* ── Toast ── */
let toastTimer = null;
export function showToast(msg) {
  clearTimeout(toastTimer);
  setState({ toastMsg: msg });
  toastTimer = setTimeout(() => setState({ toastMsg: null }), 2200);
}

/* ── Autosave ──
   Nur fuer den lokalen Einzelbetrieb. In einer gemeinsamen Sitzung ist der
   Server die Quelle der Wahrheit; dann wird nichts lokal gespeichert. */
let autosaveTimer = null;
export function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(save, 2000);
}

function save() {
  if (state.collabConnected) return;
  try {
    localStorage.setItem(
      AUTOSAVE_KEY,
      JSON.stringify({
        layers: state.layers,
        activeLayer: state.activeLayer,
        bgPattern: state.bgPattern,
        darkMode: state.darkMode,
        view: state.view,
        stickyNotes: state.stickyNotes.map((n) => ({
          id: n.id,
          wx: n.wx,
          wy: n.wy,
          text: n.text,
          colorIdx: n.colorIdx,
        })),
      }),
    );
  } catch {
    /* Speicher voll oder gesperrt -- nicht der Rede wert */
  }
}

export function loadSaved() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    const u = {};
    if (d.layers) u.layers = d.layers;
    if (d.activeLayer != null) u.activeLayer = d.activeLayer;
    if (d.bgPattern) u.bgPattern = d.bgPattern;
    if (d.darkMode) u.darkMode = true;
    if (d.view) u.view = d.view;
    if (d.stickyNotes) u.stickyNotes = d.stickyNotes;
    setState(u);
  } catch {
    /* beschaedigter Autosave -- mit leerem Board starten */
  }
}

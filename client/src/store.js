/* ═══════════════════════════════════════
   Blankr — External Store
   useSyncExternalStore for zero-dep state
   ═══════════════════════════════════════ */
import { useSyncExternalStore } from 'react';

const MAX_HISTORY = 50;
const AUTOSAVE_KEY = 'blankr_state';

/* ── Initial state ── */
const initial = {
  tool: 'pen',
  color: '#1e1e1e',
  lineWidth: 3,
  opacity: 1,
  filled: false,
  bgPattern: 'dots',
  darkMode: false,
  fullscreen: false,
  view: { x: 0, y: 0, scale: 1 },
  layers: [{ name: 'Ebene 1', visible: true, opacity: 1, strokes: [] }],
  activeLayer: 0,
  stickyNotes: [],
  toastMsg: null,
  layerPanelOpen: false,
  collabConnected: false,
  collabRoom: null,
  collabUsers: [],
  remoteCursors: {},
};

let state = { ...initial };
const listeners = new Set();
let undoStack = [];
let redoStack = [];

/* ── Core ── */
function emit() { listeners.forEach(fn => fn()); }

export function getState() { return state; }

export function setState(partial) {
  const next = typeof partial === 'function' ? partial(state) : partial;
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

/* ── History ── */
export function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(state.layers)));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.parse(JSON.stringify(state.layers)));
  setState({ layers: undoStack.pop() });
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.parse(JSON.stringify(state.layers)));
  setState({ layers: redoStack.pop() });
}

/* ── Toast ── */
let toastTimer = null;
export function showToast(msg) {
  clearTimeout(toastTimer);
  setState({ toastMsg: msg });
  toastTimer = setTimeout(() => setState({ toastMsg: null }), 2200);
}

/* ── Autosave ── */
let autosaveTimer = null;
export function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(save, 2000);
}

function save() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      layers: state.layers,
      activeLayer: state.activeLayer,
      bgPattern: state.bgPattern,
      darkMode: state.darkMode,
      view: state.view,
      stickyNotes: state.stickyNotes.map(n => ({
        id: n.id, wx: n.wx, wy: n.wy, text: n.text, colorIdx: n.colorIdx,
      })),
    }));
  } catch (_) {}
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
  } catch (_) {}
}

// Right-click Context Menu

import { getState, setState, pushUndo, scheduleAutosave } from '../store';
import { useStore } from '../store';
import { moveStroke, getBBox } from './canvas/geometry';

export default function ContextMenu() {
  const ctx = useStore(s => s.contextMenu);
  const selectedIdxs = useStore(s => s.selectedIdxs);

  if (!ctx) return null;

  const strokes = getState().layers[getState().activeLayer]?.strokes || [];
  const hasSel = selectedIdxs.length > 0;
  const hasClip = (getState().clipboard || []).length > 0;

  function close() { setState({ contextMenu: null }); }

  function doCopy() {
    if (!hasSel) return close();
    const copied = selectedIdxs.map(i => JSON.parse(JSON.stringify(strokes[i]))).filter(Boolean);
    setState({ clipboard: copied, contextMenu: null });
  }

  function doCut() {
    if (!hasSel) return close();
    pushUndo();
    const copied = selectedIdxs.map(i => JSON.parse(JSON.stringify(strokes[i]))).filter(Boolean);
    const toDelete = new Set(selectedIdxs);
    const newStrokes = strokes.filter((_, i) => !toDelete.has(i));
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: newStrokes };
    setState({ clipboard: copied, layers, selectedIdxs: [], contextMenu: null });
    scheduleAutosave();
  }

  function doPaste() {
    const clip = getState().clipboard;
    if (!clip || !clip.length) return close();
    pushUndo();
    const pasted = clip.map(s => moveStroke(JSON.parse(JSON.stringify(s)), 20, 20));
    const newStrokes = [...strokes, ...pasted];
    const newIdxs = pasted.map((_, i) => strokes.length + i);
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: newStrokes };
    setState({ layers, selectedIdxs: newIdxs, clipboard: pasted, contextMenu: null });
    scheduleAutosave();
  }

  function doDuplicate() {
    if (!hasSel) return close();
    pushUndo();
    const duped = selectedIdxs.map(i => moveStroke(JSON.parse(JSON.stringify(strokes[i])), 20, 20)).filter(Boolean);
    const newStrokes = [...strokes, ...duped];
    const newIdxs = duped.map((_, i) => strokes.length + i);
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: newStrokes };
    setState({ layers, selectedIdxs: newIdxs, contextMenu: null });
    scheduleAutosave();
  }

  function doDelete() {
    if (!hasSel) return close();
    pushUndo();
    const toDelete = new Set(selectedIdxs);
    const newStrokes = strokes.filter((_, i) => !toDelete.has(i));
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: newStrokes };
    setState({ layers, selectedIdxs: [], contextMenu: null });
    scheduleAutosave();
  }

  function doSelectAll() {
    setState({ selectedIdxs: strokes.map((_, i) => i), contextMenu: null });
  }

  function doBringFront() {
    if (!hasSel) return close();
    pushUndo();
    const sel = new Set(selectedIdxs);
    const selected = selectedIdxs.map(i => strokes[i]).filter(Boolean);
    const rest = strokes.filter((_, i) => !sel.has(i));
    const result = [...rest, ...selected];
    const newIdxs = selected.map((_, i) => rest.length + i);
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: result };
    setState({ layers, selectedIdxs: newIdxs, contextMenu: null });
    scheduleAutosave();
  }

  function doSendBack() {
    if (!hasSel) return close();
    pushUndo();
    const sel = new Set(selectedIdxs);
    const selected = selectedIdxs.map(i => strokes[i]).filter(Boolean);
    const rest = strokes.filter((_, i) => !sel.has(i));
    const result = [...selected, ...rest];
    const newIdxs = selected.map((_, i) => i);
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: result };
    setState({ layers, selectedIdxs: newIdxs, contextMenu: null });
    scheduleAutosave();
  }

  function doGroup() {
    if (selectedIdxs.length < 2) return close();
    pushUndo();
    const gid = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const newStrokes = [...strokes];
    for (const idx of selectedIdxs) {
      if (newStrokes[idx]) newStrokes[idx] = { ...newStrokes[idx], groupId: gid };
    }
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: newStrokes };
    setState({ layers, contextMenu: null });
    scheduleAutosave();
  }

  function doUngroup() {
    if (!hasSel) return close();
    pushUndo();
    const newStrokes = [...strokes];
    for (const idx of selectedIdxs) {
      if (newStrokes[idx]) {
        const s = { ...newStrokes[idx] };
        delete s.groupId;
        newStrokes[idx] = s;
      }
    }
    const layers = [...getState().layers];
    layers[getState().activeLayer] = { ...layers[getState().activeLayer], strokes: newStrokes };
    setState({ layers, contextMenu: null });
    scheduleAutosave();
  }

  return (
    <>
      <div className="ctx-backdrop" onClick={close} />
      <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
        <button className="ctx-item" onClick={doCopy} disabled={!hasSel}>
          Kopieren <span className="ctx-key">⌘C</span>
        </button>
        <button className="ctx-item" onClick={doCut} disabled={!hasSel}>
          Ausschneiden <span className="ctx-key">⌘X</span>
        </button>
        <button className="ctx-item" onClick={doPaste} disabled={!hasClip}>
          Einfügen <span className="ctx-key">⌘V</span>
        </button>
        <button className="ctx-item" onClick={doDuplicate} disabled={!hasSel}>
          Duplizieren <span className="ctx-key">⌘D</span>
        </button>
        <hr className="ctx-sep" />
        <button className="ctx-item" onClick={doBringFront} disabled={!hasSel}>
          Nach vorne <span className="ctx-key">⌘⇧]</span>
        </button>
        <button className="ctx-item" onClick={doSendBack} disabled={!hasSel}>
          Nach hinten <span className="ctx-key">⌘⇧[</span>
        </button>
        <hr className="ctx-sep" />
        <button className="ctx-item" onClick={doGroup} disabled={selectedIdxs.length < 2}>
          Gruppieren <span className="ctx-key">⌘G</span>
        </button>
        <button className="ctx-item" onClick={doUngroup} disabled={!hasSel}>
          Gruppierung aufheben <span className="ctx-key">⌘⇧G</span>
        </button>
        <hr className="ctx-sep" />
        <button className="ctx-item" onClick={doSelectAll}>
          Alles auswählen <span className="ctx-key">⌘A</span>
        </button>
        <button className="ctx-item ctx-delete" onClick={doDelete} disabled={!hasSel}>
          Löschen <span className="ctx-key">⌫</span>
        </button>
      </div>
    </>
  );
}

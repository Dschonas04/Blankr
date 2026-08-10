// Canvas — Tastatur, Zwischenablage und Einfuegen
//
// Herausgeloest aus events.js: dieser Teil kommt mit vier Beruehrungspunkten
// zur Zeichenschleife aus (canvas, dpr, Neuzeichnen anfordern, Space-Taste)
// und laesst sich deshalb sauber trennen. events.js schrumpft dadurch von
// gut 1100 auf rund 860 Zeilen.

import { getState, setState } from '../../store.js';
import { NUDGE_STEP, NUDGE_STEP_LARGE } from './constants.js';
import { moveStroke } from './geometry.js';

/**
 * @param {object} ctx
 * @param {HTMLCanvasElement} ctx.canvas
 * @param {number} ctx.dpr
 * @param {() => void} ctx.requestRender  fordert ein Neuzeichnen an
 * @param {() => boolean} ctx.isSpaceDown
 * @param {(v: boolean) => void} ctx.setSpaceDown
 * @param {() => Array} ctx.getStrokes    Striche der aktiven Ebene
 * @param {() => void} ctx.autosave
 */
export function createKeyboardHandlers(ctx) {
  const { canvas, dpr, getStrokes, autosave } = ctx;

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    const st = getState();
    const strokes = getStrokes();
    const meta = e.metaKey || e.ctrlKey;

    // Space pan
    if (e.code === 'Space' && !ctx.isSpaceDown()) {
      ctx.setSpaceDown(true);
      canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }

    // Delete
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedIdxs.length > 0) {
      e.preventDefault();
      const toDelete = new Set(st.selectedIdxs);
      const newStrokes = strokes.filter((_, i) => !toDelete.has(i));
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers, selectedIdxs: [] });
      autosave(); ctx.requestRender();
      return;
    }

    // Ctrl+A select all
    if (meta && e.key === 'a') {
      e.preventDefault();
      setState({ selectedIdxs: strokes.map((_, i) => i) });
      ctx.requestRender();
      return;
    }

    // Ctrl+C copy
    if (meta && e.key === 'c' && st.selectedIdxs.length > 0) {
      e.preventDefault();
      const copied = st.selectedIdxs.map(i => JSON.parse(JSON.stringify(strokes[i]))).filter(Boolean);
      setState({ clipboard: copied });
      return;
    }

    // Ctrl+X cut
    if (meta && e.key === 'x' && st.selectedIdxs.length > 0) {
      e.preventDefault();
      const copied = st.selectedIdxs.map(i => JSON.parse(JSON.stringify(strokes[i]))).filter(Boolean);
      const toDelete = new Set(st.selectedIdxs);
      const newStrokes = strokes.filter((_, i) => !toDelete.has(i));
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ clipboard: copied, layers, selectedIdxs: [] });
      autosave(); ctx.requestRender();
      return;
    }

    // Ctrl+V paste
    if (meta && e.key === 'v') {
      e.preventDefault();
      // Try clipboard image first
      if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(items => {
          for (const item of items) {
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                item.getType(type).then(blob => pasteImageBlob(blob));
                return;
              }
            }
          }
          pasteFromInternal();
        }).catch(() => pasteFromInternal());
      } else {
        pasteFromInternal();
      }
      return;
    }

    // Ctrl+D duplicate
    if (meta && e.key === 'd' && st.selectedIdxs.length > 0) {
      e.preventDefault();
      const duped = st.selectedIdxs.map(i => {
        const s = JSON.parse(JSON.stringify(strokes[i]));
        return moveStroke(s, 20, 20);
      }).filter(Boolean);
      const newStrokes = [...strokes, ...duped];
      const newIdxs = duped.map((_, i) => strokes.length + i);
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers, selectedIdxs: newIdxs });
      autosave(); ctx.requestRender();
      return;
    }

    // Ctrl+G group
    if (meta && e.key === 'g' && !e.shiftKey && st.selectedIdxs.length > 1) {
      e.preventDefault();
      const gid = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const newStrokes = [...strokes];
      for (const idx of st.selectedIdxs) {
        if (newStrokes[idx]) newStrokes[idx] = { ...newStrokes[idx], groupId: gid };
      }
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers });
      autosave(); ctx.requestRender();
      return;
    }

    // Ctrl+Shift+G ungroup
    if (meta && e.key === 'G' && e.shiftKey && st.selectedIdxs.length > 0) {
      e.preventDefault();
      const newStrokes = [...strokes];
      for (const idx of st.selectedIdxs) {
        if (newStrokes[idx]) {
          const s = { ...newStrokes[idx] };
          delete s.groupId;
          newStrokes[idx] = s;
        }
      }
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers });
      autosave(); ctx.requestRender();
      return;
    }

    // Z-order: Ctrl+] bring forward, Ctrl+[ send backward
    // Ctrl+Shift+] bring to front, Ctrl+Shift+[ send to back
    if (meta && (e.key === ']' || e.key === '[') && st.selectedIdxs.length > 0) {
      e.preventDefault();
      const sel = new Set(st.selectedIdxs);
      const selected = st.selectedIdxs.map(i => strokes[i]).filter(Boolean);
      const rest = strokes.filter((_, i) => !sel.has(i));
      let result;

      if (e.key === ']' && e.shiftKey) {
        result = [...rest, ...selected]; // front
      } else if (e.key === '[' && e.shiftKey) {
        result = [...selected, ...rest]; // back
      } else if (e.key === ']') {
        result = [...strokes];
        const sorted = [...st.selectedIdxs].sort((a, b) => b - a);
        for (const idx of sorted) {
          if (idx < result.length - 1 && !sel.has(idx + 1)) {
            [result[idx], result[idx + 1]] = [result[idx + 1], result[idx]];
          }
        }
      } else {
        result = [...strokes];
        const sorted = [...st.selectedIdxs].sort((a, b) => a - b);
        for (const idx of sorted) {
          if (idx > 0 && !sel.has(idx - 1)) {
            [result[idx], result[idx - 1]] = [result[idx - 1], result[idx]];
          }
        }
      }

      const newIdxs = [];
      for (let i = 0; i < result.length; i++) {
        if (selected.includes(result[i])) newIdxs.push(i);
      }
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: result };
      setState({ layers, selectedIdxs: newIdxs });
      autosave(); ctx.requestRender();
      return;
    }

    // Arrow keys nudge
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && st.selectedIdxs.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      const newStrokes = [...strokes];
      for (const idx of st.selectedIdxs) {
        if (newStrokes[idx]) newStrokes[idx] = moveStroke(newStrokes[idx], dx, dy);
      }
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers });
      autosave(); ctx.requestRender();
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      setState({ selectedIdxs: [], contextMenu: null });
      ctx.requestRender();
      return;
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      ctx.setSpaceDown(false);
      canvas.style.cursor = getState().tool === 'hand' ? 'grab' : 'default';
    }
  }

  // ---- paste helpers ----
  function pasteFromInternal() {
    const st = getState();
    const clip = st.clipboard;
    if (!clip || !clip.length) return;
    const strokes = getStrokes();
    const pasted = clip.map(s => moveStroke(JSON.parse(JSON.stringify(s)), 20, 20));
    const newStrokes = [...strokes, ...pasted];
    const newIdxs = pasted.map((_, i) => strokes.length + i);
    const layers = [...st.layers];
    layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
    setState({ layers, selectedIdxs: newIdxs, clipboard: pasted });
    autosave(); ctx.requestRender();
  }

  function pasteImageBlob(blob) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const v = getState().view;
        const cx = W / 2 / dpr / v.scale - v.x;
        const cy = H / 2 / dpr / v.scale - v.y;
        const st2 = getState();
        const strokes2 = st2.layers[st2.activeLayer]?.strokes || [];
        const newStroke = {
          type: 'image',
          x: cx - img.width / 2, y: cy - img.height / 2,
          w: img.width, h: img.height,
          src: reader.result, _img: img
        };
        const layers = [...st2.layers];
        layers[st2.activeLayer] = { ...layers[st2.activeLayer], strokes: [...strokes2, newStroke] };
        setState({ layers, selectedIdxs: [strokes2.length] });
        autosave(); ctx.requestRender();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(blob);
  }

  // ---- clipboard paste event (for drag/drop paste) ----
  function onPaste(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        pasteImageBlob(item.getAsFile());
        return;
      }
    }
  }

  // ---- touch ----
  return { onKeyDown, onKeyUp, onPaste, pasteFromInternal, pasteImageBlob };
}

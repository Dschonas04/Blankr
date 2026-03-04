/* ═══════════════════════════════════════
   Canvas — React Component (thin shell)
   All logic lives in canvas/ sub-modules.
   ═══════════════════════════════════════ */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getState, setState, pushUndo, scheduleAutosave, useStore } from '../store';
import { setupCanvasEvents } from './canvas/events';
import { getBBox } from './canvas/geometry';

const FONT_SIZES = [12, 14, 16, 20, 24, 32, 40, 48, 64, 72];

export default function Canvas() {
  const canvasRef = useRef(null);
  const editorRef = useRef(null);
  const committedRef = useRef(false);
  const blurTimerRef = useRef(null);
  const [textEdit, setTextEdit] = useState(null);

  // Selected text stroke (for floating toolbar)
  const selStroke = useStore(s => {
    if (s.tool !== 'select' || s.selectedStrokeIdx == null) return null;
    const st = s.layers[s.activeLayer]?.strokes?.[s.selectedStrokeIdx];
    return (st?.type === 'text') ? st : null;
  });
  const view = useStore(s => s.view);
  const darkMode = useStore(s => s.darkMode);

  /* Set up the imperative canvas engine */
  useEffect(() => {
    const cvs = canvasRef.current;
    return setupCanvasEvents(cvs, setTextEdit);
  }, []);

  /* Expose editingIdx so the render loop can skip drawing that stroke */
  useEffect(() => {
    window.__blankr_editingIdx = textEdit?.editIdx ?? null;
  }, [textEdit]);

  /* ── Commit inline text ── */
  const commitText = useCallback((el) => {
    if (committedRef.current) return;
    committedRef.current = true;
    clearTimeout(blurTimerRef.current);
    const te = textEdit;
    if (!te) { setTextEdit(null); return; }
    const text = (el?.innerText || '').replace(/\n$/, '');

    if (te.editIdx != null) {
      pushUndo();
      const st = getState();
      const layers = st.layers.map((l, i) => {
        if (i !== st.activeLayer) return l;
        const strokes = [...l.strokes];
        if (text && text.trim()) {
          strokes[te.editIdx] = { ...strokes[te.editIdx], text: text.trim() };
        } else {
          strokes.splice(te.editIdx, 1);
        }
        return { ...l, strokes };
      });
      setState({ layers, selectedStrokeIdx: (text && text.trim()) ? te.editIdx : null });
      scheduleAutosave();
    } else if (text && text.trim()) {
      pushUndo();
      const st = getState();
      const newIdx = (st.layers[st.activeLayer]?.strokes || []).length;
      const layers = st.layers.map((l, i) =>
        i === st.activeLayer
          ? {
              ...l,
              strokes: [
                ...l.strokes,
                {
                  type: 'text', x: te.wx, y: te.wy,
                  text: text.trim(), color: st.color,
                  fontSize: st.fontSize || 20, opacity: st.opacity,
                },
              ],
            }
          : l
      );
      setState({ layers, tool: 'select', selectedStrokeIdx: newIdx });
      scheduleAutosave();
    }
    setTextEdit(null);
  }, [textEdit]);

  const handleBlur = useCallback((e) => {
    const el = e.target;
    clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => commitText(el), 120);
  }, [commitText]);

  /* Focus editor on open */
  useEffect(() => {
    if (textEdit) {
      committedRef.current = false;
      const focus = () => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        // Place cursor at end
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      };
      requestAnimationFrame(focus);
      const t1 = setTimeout(focus, 50);
      const t2 = setTimeout(focus, 150);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [textEdit]);

  useEffect(() => () => clearTimeout(blurTimerRef.current), []);

  /* ── Floating toolbar helpers ── */
  function updateStroke(updates) {
    const st = getState();
    if (st.selectedStrokeIdx == null) return;
    const layers = st.layers.map((l, li) => {
      if (li !== st.activeLayer) return l;
      const strokes = [...l.strokes];
      strokes[st.selectedStrokeIdx] = { ...strokes[st.selectedStrokeIdx], ...updates };
      return { ...l, strokes };
    });
    setState({ layers });
    scheduleAutosave();
  }

  /* ── Compute inline editor style ── */
  let editorStyle = null;
  if (textEdit) {
    const fs = textEdit.fontSize || getState().fontSize || 20;
    const col = textEdit.color || getState().color || '#1e1e1e';
    const bold = textEdit.bold ? 'bold' : 'normal';
    const italic = textEdit.italic ? 'italic' : 'normal';
    const v = getState().view;
    const scaledFs = fs * v.scale;
    editorStyle = {
      position: 'fixed',
      left: textEdit.sx,
      top: textEdit.sy,
      zIndex: 200,
      fontSize: `${scaledFs}px`,
      fontFamily: "'Inter', sans-serif",
      fontWeight: bold,
      fontStyle: italic,
      color: darkMode ? '#e0e0e0' : col,
      lineHeight: 1.3,
      minWidth: `${Math.max(60, scaledFs * 3)}px`,
      minHeight: `${scaledFs * 1.4}px`,
      outline: 'none',
      padding: '2px 4px',
      background: 'transparent',
      border: '2px solid rgba(99,102,241,0.5)',
      borderRadius: '3px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      caretColor: 'var(--accent)',
      pointerEvents: 'auto',
      transformOrigin: 'top left',
    };
  }

  /* ── Floating toolbar position ── */
  let toolbarStyle = null;
  if (selStroke && !textEdit) {
    const bb = getBBox(selStroke);
    if (bb) {
      const sx = (bb.x + bb.w) * view.scale + view.x + 8;
      const sy = (bb.y + bb.h) * view.scale + view.y + 8;
      toolbarStyle = {
        position: 'fixed', left: sx, top: sy, zIndex: 150,
      };
    }
  }

  return (
    <>
      <canvas id="whiteboard" ref={canvasRef} />

      {/* WYSIWYG inline text editor */}
      {textEdit && (
        <div
          ref={editorRef}
          className="text-inline-editor"
          style={editorStyle}
          contentEditable
          suppressContentEditableWarning
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onFocus={() => clearTimeout(blurTimerRef.current)}
          onBlur={handleBlur}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              committedRef.current = true;
              clearTimeout(blurTimerRef.current);
              setTextEdit(null);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitText(e.target);
            }
          }}
        >
          {textEdit.initialText || ''}
        </div>
      )}

      {/* Floating text format toolbar near selected text */}
      {toolbarStyle && (
        <div className="text-format-toolbar" style={toolbarStyle}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          <select
            className="tft-select"
            value={selStroke.fontSize || 16}
            onChange={e => { pushUndo(); updateStroke({ fontSize: +e.target.value }); }}
          >
            {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
          </select>
          <button
            className={`tft-btn${selStroke.bold ? ' active' : ''}`}
            title="Fett"
            onClick={() => { pushUndo(); updateStroke({ bold: !selStroke.bold }); }}
          >B</button>
          <button
            className={`tft-btn tft-italic${selStroke.italic ? ' active' : ''}`}
            title="Kursiv"
            onClick={() => { pushUndo(); updateStroke({ italic: !selStroke.italic }); }}
          >I</button>
        </div>
      )}
    </>
  );
}

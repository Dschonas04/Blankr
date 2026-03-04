/* ═══════════════════════════════════════
   Canvas — Event Handlers
   Sets up all pointer/keyboard/touch
   events and the render loop.
   Returns a cleanup function.
   ═══════════════════════════════════════ */

import { CONNECTOR_SNAP_DIST, LASER_FADE_MS } from './constants.js';
import {
  getBBox, getCenter, getConnectorAnchors, rotatePoint,
  moveStroke, resizeStroke, moveEndpoint, isLineLike,
} from './geometry.js';
import { hitTest, hitHandle, handleCursor } from './hitTest.js';
import { drawBackground, renderStroke, drawSelectionBox } from './render.js';
import { getState, setState, subscribe, pushUndo, scheduleAutosave, showToast } from '../../store';
import * as collab from '../../collab';

/**
 * Initialise all canvas interaction.
 * @param {HTMLCanvasElement} cvs
 * @param {Function} setTextEdit — React state setter for the text input overlay
 * @returns {Function} cleanup
 */
export function setupCanvasEvents(cvs, setTextEdit) {
  const ctx = cvs.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');
  const imgCache = new Map();

  /* ── Mutable local state ── */
  let drawing = false, currentStroke = null;
  let panning = false, panSX = 0, panSY = 0, panVX = 0, panVY = 0;
  let spaceDown = false;
  let laserTrails = [];
  let needsRender = true;
  let pinchActive = false, pinchD0 = 0, pinchS0 = 1;
  let dpr = 1;

  // Select state
  let dragging = false, dragStartWX = 0, dragStartWY = 0;
  let dragOrigStroke = null;
  let resizingHandle = null, resizeOrigBB = null;
  let endpointDragging = null; // 'p1' | 'p2'
  let rotating = false, rotateStartAngle = 0, rotateOrigRotation = 0;

  // Eraser state (object eraser)
  let erasing = false;
  let erasedIndices = new Set();

  // Connector state
  let connectorStart = null;

  /* ── Helpers ── */
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    cvs.width = w * dpr;
    cvs.height = h * dpr;
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';
    off.width = w * dpr;
    off.height = h * dpr;
    needsRender = true;
  }

  function screenToWorld(sx, sy) {
    const v = getState().view;
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  }

  function ptrPos(e) {
    const r = cvs.getBoundingClientRect();
    if (e.touches?.length)
      return { sx: e.touches[0].clientX - r.left, sy: e.touches[0].clientY - r.top };
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  // Custom red-dot cursor for the laser tool
  const laserSVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Ccircle cx='10' cy='10' r='5' fill='red' opacity='0.85'/%3E%3Ccircle cx='10' cy='10' r='3' fill='white' opacity='0.6'/%3E%3C/svg%3E") 10 10, crosshair`;

  function setCursor() {
    const t = getState().tool;
    const map = {
      select: 'default', connector: 'crosshair',
      pen: 'crosshair', line: 'crosshair', arrow: 'crosshair',
      rect: 'crosshair', circle: 'crosshair', text: 'text',
      eraser: 'cell', laser: laserSVG, hand: 'grab',
    };
    cvs.style.cursor = spaceDown ? 'grab' : (map[t] || 'crosshair');
  }

  function getImage(url) {
    if (!url) return null;
    if (imgCache.has(url)) return imgCache.get(url);
    const img = new Image();
    img.onload = () => { imgCache.set(url, img); needsRender = true; };
    img.src = url;
    imgCache.set(url, null);
    return null;
  }

  function updateLayer(idx, stroke) {
    const st = getState();
    const layers = st.layers.map((l, li) => {
      if (li !== st.activeLayer) return l;
      const strokes = [...l.strokes];
      strokes[idx] = stroke;
      return { ...l, strokes };
    });
    setState({ layers });
  }

  /** Object eraser: remove any stroke under (wx, wy). */
  function eraseAt(wx, wy) {
    const st = getState();
    const strokes = st.layers[st.activeLayer]?.strokes || [];
    let changed = false;
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (erasedIndices.has(i)) continue;
      if (hitTest(strokes[i], wx, wy)) {
        erasedIndices.add(i);
        changed = true;
      }
    }
    if (changed) {
      const layers = st.layers.map((l, li) => {
        if (li !== st.activeLayer) return l;
        return { ...l, strokes: l.strokes.filter((_, si) => !erasedIndices.has(si)) };
      });
      setState({ layers, selectedStrokeIdx: null });
      // Re-index: after filtering, indices shift, so reset tracking
      erasedIndices = new Set();
      needsRender = true;
    }
  }

  /* ═══════════════ RENDER ═══════════════ */
  function render() {
    const state = getState();
    const { view, layers, selectedStrokeIdx, activeLayer, tool } = state;
    const w = cvs.width / dpr, h = cvs.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    drawBackground(ctx, cvs, dpr, state);

    // Layers
    for (const layer of layers) {
      if (!layer.visible) continue;
      offCtx.save();
      offCtx.scale(dpr, dpr);
      offCtx.clearRect(0, 0, w, h);
      offCtx.translate(view.x, view.y);
      offCtx.scale(view.scale, view.scale);
      const editingIdx = window.__blankr_editingIdx;
      const isActiveLayer = (layer === layers[activeLayer]);
      for (let si = 0; si < layer.strokes.length; si++) {
        // Skip stroke being edited inline (WYSIWYG)
        if (isActiveLayer && editingIdx != null && si === editingIdx) continue;
        renderStroke(offCtx, layer.strokes[si], getImage, state.darkMode);
      }
      offCtx.restore();
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Selection overlay
    if (tool === 'select' && selectedStrokeIdx != null) {
      const strokes = layers[activeLayer]?.strokes;
      if (strokes && strokes[selectedStrokeIdx]) {
        ctx.save();
        ctx.translate(view.x, view.y);
        ctx.scale(view.scale, view.scale);
        drawSelectionBox(ctx, strokes[selectedStrokeIdx], view);
        ctx.restore();
      }
    }

    // Connector preview
    if (tool === 'connector' && connectorStart && currentStroke) {
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(currentStroke.x1, currentStroke.y1);
      ctx.lineTo(currentStroke.x2, currentStroke.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Current stroke preview
    if (currentStroke && !connectorStart) {
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      renderStroke(ctx, currentStroke, getImage, state.darkMode);
      ctx.restore();
    }

    // Laser
    const now = Date.now();
    laserTrails = laserTrails.filter(p => now - p.time < LASER_FADE_MS);
    if (laserTrails.length) {
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      for (const p of laserTrails) {
        const age = (now - p.time) / LASER_FADE_MS;
        ctx.globalAlpha = 1 - age;
        const r = 4 * (1 + age * 0.5);
        ctx.fillStyle = '#ff3333';
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,50,50,0.25)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.restore();
  }

  /* ═══════════════ POINTER DOWN ═══════════════ */
  function onDown(e) {
    if (e.target !== cvs) return;
    const { sx, sy } = ptrPos(e);
    const { x, y } = screenToWorld(sx, sy);
    const st = getState();

    // Pan (middle button / space / hand tool)
    if (e.button === 1 || spaceDown || st.tool === 'hand') {
      panning = true; panSX = sx; panSY = sy;
      panVX = st.view.x; panVY = st.view.y;
      cvs.style.cursor = 'grabbing';
      e.preventDefault(); return;
    }

    /* ── Select tool ── */
    if (st.tool === 'select') {
      e.preventDefault();
      const strokes = st.layers[st.activeLayer]?.strokes || [];

      // Check handles on currently selected stroke
      if (st.selectedStrokeIdx != null && strokes[st.selectedStrokeIdx]) {
        const sel = strokes[st.selectedStrokeIdx];
        const handle = hitHandle(sel, x, y, st.view.scale);

        if (handle === 'rotate') {
          rotating = true;
          const { cx, cy } = getCenter(sel);
          rotateStartAngle = Math.atan2(y - cy, x - cx);
          rotateOrigRotation = sel.rotation || 0;
          dragOrigStroke = JSON.parse(JSON.stringify(sel));
          cvs.style.cursor = 'crosshair';
          pushUndo(); needsRender = true;
          return;
        }

        // Endpoint handles for line-like strokes
        if (handle === 'p1' || handle === 'p2') {
          endpointDragging = handle;
          dragOrigStroke = JSON.parse(JSON.stringify(sel));
          cvs.style.cursor = 'pointer';
          pushUndo(); needsRender = true;
          return;
        }

        // Corner resize handles for shapes
        if (handle) {
          resizingHandle = handle;
          resizeOrigBB = getBBox(sel);
          dragOrigStroke = JSON.parse(JSON.stringify(sel));
          dragStartWX = x; dragStartWY = y;
          cvs.style.cursor = handleCursor(handle) || 'nwse-resize';
          pushUndo(); needsRender = true;
          return;
        }
      }

      // Find stroke under cursor
      let found = -1;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (hitTest(strokes[i], x, y)) { found = i; break; }
      }
      if (found >= 0) {
        setState({ selectedStrokeIdx: found });
        dragging = true;
        dragStartWX = x; dragStartWY = y;
        dragOrigStroke = JSON.parse(JSON.stringify(strokes[found]));
        cvs.style.cursor = 'move';
        pushUndo();
      } else {
        setState({ selectedStrokeIdx: null });
      }
      needsRender = true;
      return;
    }

    /* ── Connector tool ── */
    if (st.tool === 'connector') {
      e.preventDefault();
      const strokes = st.layers[st.activeLayer]?.strokes || [];
      let bestDist = CONNECTOR_SNAP_DIST / st.view.scale, bestAnchor = null, bestIdx = -1;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (strokes[i].type === 'connector') continue;
        for (const a of getConnectorAnchors(strokes[i])) {
          const d = Math.hypot(x - a.x, y - a.y);
          if (d < bestDist) { bestDist = d; bestAnchor = a; bestIdx = i; }
        }
      }
      if (bestAnchor) {
        connectorStart = { strokeIdx: bestIdx, anchor: bestAnchor };
        currentStroke = { type: 'connector', x1: bestAnchor.x, y1: bestAnchor.y, x2: x, y2: y, color: '#6366f1', width: 2, opacity: 1 };
        drawing = true;
      }
      needsRender = true;
      return;
    }

    /* ── Text tool ── */
    if (st.tool === 'text') {
      e.preventDefault();
      const v = st.view;
      // Position the inline editor exactly where the text will render
      setTextEdit({
        sx: sx, sy: sy,
        wx: x, wy: y,
        fontSize: st.fontSize || 20,
        color: st.color,
      });
      return;
    }

    /* ── Laser ── */
    if (st.tool === 'laser') {
      drawing = true;
      laserTrails.push({ x, y, time: Date.now() });
      e.preventDefault(); return;
    }

    /* ── Eraser (object eraser) ── */
    if (st.tool === 'eraser') {
      e.preventDefault();
      erasing = true;
      erasedIndices = new Set();
      pushUndo();
      eraseAt(x, y);
      return;
    }

    /* ── Drawing tools ── */
    e.preventDefault();
    drawing = true;
    pushUndo();
    const base = { color: st.color, width: st.lineWidth, opacity: st.opacity, filled: st.filled };

    switch (st.tool) {
      case 'pen':
        currentStroke = { type: 'pen', points: [{ x, y }], ...base }; break;
      case 'line':   currentStroke = { type: 'line',   x1: x, y1: y, x2: x, y2: y, ...base }; break;
      case 'arrow':  currentStroke = { type: 'arrow',  x1: x, y1: y, x2: x, y2: y, ...base }; break;
      case 'rect':   currentStroke = { type: 'rect',   x1: x, y1: y, x2: x, y2: y, ...base }; break;
      case 'circle': currentStroke = { type: 'circle', x1: x, y1: y, x2: x, y2: y, ...base }; break;
    }
    needsRender = true;
  }

  /* ═══════════════ POINTER MOVE ═══════════════ */
  function onMove(e) {
    const { sx, sy } = ptrPos(e);
    const { x, y } = screenToWorld(sx, sy);

    if (collab.isConnected()) collab.send({ type: 'cursor', x: sx, y: sy });

    // Panning
    if (panning) {
      setState({ view: { ...getState().view, x: panVX + (sx - panSX), y: panVY + (sy - panSY) } });
      needsRender = true; return;
    }

    /* ── Rotating ── */
    if (rotating && getState().tool === 'select') {
      e.preventDefault();
      const st = getState();
      const idx = st.selectedStrokeIdx;
      if (idx != null && dragOrigStroke) {
        const { cx, cy } = getCenter(dragOrigStroke);
        const currentAngle = Math.atan2(y - cy, x - cx);
        const delta = currentAngle - rotateStartAngle;
        const updated = { ...dragOrigStroke, rotation: rotateOrigRotation + delta };
        updateLayer(idx, updated);
        needsRender = true;
      }
      return;
    }

    /* ── Eraser dragging ── */
    if (erasing && getState().tool === 'eraser') {
      e.preventDefault();
      eraseAt(x, y);
      return;
    }

    /* ── Endpoint dragging (line/arrow/connector) ── */
    if (endpointDragging && getState().tool === 'select') {
      e.preventDefault();
      const st = getState();
      const idx = st.selectedStrokeIdx;
      if (idx != null && dragOrigStroke) {
        // If stroke is rotated, un-rotate mouse pos to model space
        let epX = x, epY = y;
        if (dragOrigStroke.rotation) {
          const { cx, cy } = getCenter(dragOrigStroke);
          const p = rotatePoint(x, y, cx, cy, -dragOrigStroke.rotation);
          epX = p.x; epY = p.y;
        }
        const moved = moveEndpoint(dragOrigStroke, endpointDragging, epX, epY);
        moved.rotation = dragOrigStroke.rotation;
        updateLayer(idx, moved);
        dragOrigStroke = JSON.parse(JSON.stringify(moved));
        needsRender = true;
      }
      return;
    }

    /* ── Resizing (corner handles) ── */
    if (resizingHandle && getState().tool === 'select') {
      e.preventDefault();
      const dx = x - dragStartWX, dy = y - dragStartWY;
      const st = getState();
      const idx = st.selectedStrokeIdx;
      if (idx != null && dragOrigStroke && resizeOrigBB) {
        const resized = resizeStroke(dragOrigStroke, resizingHandle, dx, dy, resizeOrigBB);
        updateLayer(idx, resized);
        needsRender = true;
      }
      return;
    }

    /* ── Dragging (whole stroke move) ── */
    if (dragging && getState().tool === 'select') {
      e.preventDefault();
      const dx = x - dragStartWX, dy = y - dragStartWY;
      const st = getState();
      const idx = st.selectedStrokeIdx;
      if (idx != null && dragOrigStroke) {
        const moved = moveStroke(dragOrigStroke, dx, dy);
        moved.rotation = dragOrigStroke.rotation;
        updateLayer(idx, moved);
        needsRender = true;
      }
      return;
    }

    /* ── Connector dragging ── */
    if (drawing && getState().tool === 'connector' && currentStroke) {
      e.preventDefault();
      currentStroke.x2 = x; currentStroke.y2 = y;
      needsRender = true;
      return;
    }

    /* ── Hover cursors ── */
    if (!drawing) {
      if (getState().tool === 'select' && !panning) {
        const st = getState();
        const strokes = st.layers[st.activeLayer]?.strokes || [];
        // Check handles on selected stroke
        if (st.selectedStrokeIdx != null && strokes[st.selectedStrokeIdx]) {
          const handle = hitHandle(strokes[st.selectedStrokeIdx], x, y, st.view.scale);
          const cur = handleCursor(handle);
          if (cur) { cvs.style.cursor = cur; return; }
        }
        // Check if hovering a stroke
        let hover = false;
        for (let i = strokes.length - 1; i >= 0; i--) {
          if (hitTest(strokes[i], x, y)) { hover = true; break; }
        }
        cvs.style.cursor = hover ? 'move' : 'default';
      }
      return;
    }

    e.preventDefault();

    /* ── Laser ── */
    if (getState().tool === 'laser') {
      laserTrails.push({ x, y, time: Date.now() });
      needsRender = true; return;
    }

    /* ── Drawing in progress ── */
    if (!currentStroke) return;
    switch (currentStroke.type) {
      case 'pen': currentStroke.points.push({ x, y }); break;
      default: currentStroke.x2 = x; currentStroke.y2 = y;
    }
    needsRender = true;
  }

  /* ═══════════════ POINTER UP ═══════════════ */
  function onUp() {
    if (erasing) {
      erasing = false; erasedIndices = new Set();
      setCursor(); scheduleAutosave(); needsRender = true; return;
    }
    if (panning) { panning = false; setCursor(); return; }

    if (rotating) {
      rotating = false; dragOrigStroke = null;
      setCursor(); scheduleAutosave(); needsRender = true; return;
    }
    if (endpointDragging) {
      endpointDragging = null; dragOrigStroke = null;
      setCursor(); scheduleAutosave(); needsRender = true; return;
    }
    if (resizingHandle) {
      resizingHandle = null; resizeOrigBB = null; dragOrigStroke = null;
      setCursor(); scheduleAutosave(); needsRender = true; return;
    }
    if (dragging) {
      dragging = false; dragOrigStroke = null;
      setCursor(); scheduleAutosave(); needsRender = true; return;
    }

    /* ── Connector finish ── */
    if (getState().tool === 'connector' && connectorStart && currentStroke) {
      const st = getState();
      const strokes = st.layers[st.activeLayer]?.strokes || [];
      let bestDist = CONNECTOR_SNAP_DIST / st.view.scale, bestAnchor = null;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (i === connectorStart.strokeIdx || strokes[i].type === 'connector') continue;
        for (const a of getConnectorAnchors(strokes[i])) {
          const d = Math.hypot(currentStroke.x2 - a.x, currentStroke.y2 - a.y);
          if (d < bestDist) { bestDist = d; bestAnchor = a; }
        }
      }
      if (bestAnchor) {
        pushUndo();
        const conn = { ...currentStroke, x2: bestAnchor.x, y2: bestAnchor.y };
        const st2 = getState();
        const layers = st2.layers.map((l, i) =>
          i === st2.activeLayer ? { ...l, strokes: [...l.strokes, conn] } : l
        );
        setState({ layers });
        scheduleAutosave();
        showToast('🔗 Verbunden');
      }
      connectorStart = null; currentStroke = null; drawing = false; needsRender = true;
      return;
    }

    if (getState().tool === 'laser') { drawing = false; return; }
    if (!drawing || !currentStroke) { drawing = false; return; }
    drawing = false;

    const st = getState();
    const layers = st.layers.map((l, i) =>
      i === st.activeLayer ? { ...l, strokes: [...l.strokes, currentStroke] } : l
    );
    setState({ layers });

    if (collab.isConnected()) collab.send({ type: 'stroke', data: currentStroke });
    currentStroke = null;
    needsRender = true;
    scheduleAutosave();
  }

  /* ═══════════════ WHEEL ZOOM ═══════════════ */
  function onWheel(e) {
    e.preventDefault();
    const { sx, sy } = ptrPos(e);
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    const v = getState().view;
    const newScale = Math.min(5, Math.max(0.1, v.scale * delta));
    setState({
      view: {
        x: sx - (sx - v.x) * (newScale / v.scale),
        y: sy - (sy - v.y) * (newScale / v.scale),
        scale: newScale,
      },
    });
    needsRender = true;
  }

  /* ═══════════════ TOUCH ═══════════════ */
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinchActive = true;
      pinchD0 = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchS0 = getState().view.scale;
      return;
    }
    onDown(e);
  }

  function onTouchMove(e) {
    if (e.touches.length === 2 && pinchActive) {
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setState(s => ({
        view: { ...s.view, scale: Math.min(5, Math.max(0.1, pinchS0 * (d / pinchD0))) },
      }));
      needsRender = true; return;
    }
    onMove(e);
  }

  function onTouchEnd() { pinchActive = false; onUp(); }

  /* ═══════════════ DRAG & DROP IMAGES ═══════════════ */
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const { sx, sy } = ptrPos(e);
        const { x, y } = screenToWorld(sx, sy);
        const scale = img.width > 400 ? 400 / img.width : 1;
        pushUndo();
        const st = getState();
        const layers = st.layers.map((l, i) =>
          i === st.activeLayer
            ? {
                ...l,
                strokes: [...l.strokes, {
                  type: 'image', x, y,
                  w: img.width * scale, h: img.height * scale,
                  data: ev.target.result, opacity: 1,
                }],
              }
            : l
        );
        setState({ layers });
        scheduleAutosave();
        showToast('🖼 Bild eingefügt');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ═══════════════ KEYBOARD ═══════════════ */
  function onKeyDown(e) {
    if (e.code === 'Space' && !spaceDown &&
        !['TEXTAREA', 'INPUT'].includes(e.target.tagName) &&
        !e.target.isContentEditable) {
      spaceDown = true; setCursor(); e.preventDefault();
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        getState().tool === 'select' &&
        !['TEXTAREA', 'INPUT'].includes(e.target.tagName) &&
        !e.target.isContentEditable) {
      const st = getState();
      if (st.selectedStrokeIdx != null) {
        e.preventDefault(); pushUndo();
        const layers = st.layers.map((l, li) => {
          if (li !== st.activeLayer) return l;
          return { ...l, strokes: l.strokes.filter((_, si) => si !== st.selectedStrokeIdx) };
        });
        setState({ layers, selectedStrokeIdx: null });
        scheduleAutosave();
        needsRender = true;
      }
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') { spaceDown = false; setCursor(); }
  }

  /* ═══════════════ DOUBLE-CLICK (edit text) ═══════════════ */
  function onDblClick(e) {
    if (getState().tool !== 'select') return;
    const { sx, sy } = ptrPos(e);
    const { x, y } = screenToWorld(sx, sy);
    const st = getState();
    const strokes = st.layers[st.activeLayer]?.strokes || [];
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].type === 'text' && hitTest(strokes[i], x, y)) {
        const s = strokes[i];
        // Position at exactly where the text renders (s.x, s.y is the baseline origin)
        const editSX = s.x * st.view.scale + st.view.x;
        const editSY = (s.y - (s.fontSize || 16)) * st.view.scale + st.view.y;
        setTextEdit({
          sx: editSX, sy: editSY, wx: s.x, wy: s.y,
          editIdx: i, initialText: s.text,
          fontSize: s.fontSize || 16,
          color: s.color,
          bold: s.bold,
          italic: s.italic,
        });
        e.preventDefault();
        return;
      }
    }
  }

  /* ═══════════════ SETUP ═══════════════ */
  const unsub = subscribe(() => { needsRender = true; setCursor(); });

  window.addEventListener('resize', resize);
  cvs.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  cvs.addEventListener('wheel', onWheel, { passive: false });
  cvs.addEventListener('touchstart', onTouchStart, { passive: false });
  cvs.addEventListener('touchmove', onTouchMove, { passive: false });
  cvs.addEventListener('touchend', onTouchEnd);
  cvs.addEventListener('dragover', onDragOver);
  cvs.addEventListener('drop', onDrop);
  cvs.addEventListener('dblclick', onDblClick);
  cvs.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  resize();

  let raf;
  function loop() {
    if (needsRender || laserTrails.length) { render(); needsRender = false; }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  /* ═══════════════ CLEANUP ═══════════════ */
  return function cleanup() {
    cancelAnimationFrame(raf);
    unsub();
    window.removeEventListener('resize', resize);
    cvs.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    cvs.removeEventListener('wheel', onWheel);
    cvs.removeEventListener('touchstart', onTouchStart);
    cvs.removeEventListener('touchmove', onTouchMove);
    cvs.removeEventListener('touchend', onTouchEnd);
    cvs.removeEventListener('dblclick', onDblClick);
    cvs.removeEventListener('dragover', onDragOver);
    cvs.removeEventListener('drop', onDrop);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
  };
}

// Canvas - Event Handlers & Render Loop

import { getState, setState } from '../../store.js';
import {
  LASER_FADE_MS, HANDLE_SIZE, CONNECTOR_SNAP_DIST,
  ENDPOINT_HIT_RADIUS, SNAP_THRESHOLD, NUDGE_STEP, NUDGE_STEP_LARGE, GRID_SIZE
} from './constants.js';
import {
  drawBackground, renderStroke, drawSelectionBox,
  drawRubberBand, drawAlignGuides, adaptColor
} from './render.js';
import {
  getBBox, getCenter, getConnectorAnchors, moveStroke,
  resizeStroke, moveEndpoint, isLineLike, snapToGrid, computeAlignGuides
} from './geometry.js';
import { hitTest, hitHandle, handleCursor } from './hitTest.js';
import { sendStroke, sendCursor, sendClear, sendUndo } from '../../collab.js';

export function setupCanvasEvents(canvas, setTextEdit) {
  const offscreen = document.createElement('canvas');
  const ctx = offscreen.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let W, H;
  let needsRender = true;

  // ---- mutable local state ----
  let drawing = false;
  let currentStroke = null;
  let panning = false;
  let panStartX = 0, panStartY = 0, panViewX = 0, panViewY = 0;
  let spaceDown = false;
  let laserTrails = [];
  let pinchActive = false;
  let pinchStartDist = 0, pinchStartScale = 1;

  // Selection / drag
  let dragging = false;
  let dragStartWX = 0, dragStartWY = 0;
  let dragOrigStrokes = new Map(); // idx -> deep-cloned original

  let resizingHandle = null;
  let resizeOrigBB = null;
  let resizeOrigStroke = null;

  let endpointDragging = null; // 'p1' | 'p2'
  let endpointOrigStroke = null;

  let rotating = false;
  let rotateOrigAngle = 0;
  let rotateOrigStroke = null;

  let erasing = false;
  let connectorStart = null;

  // Rubber band
  let rubberBand = null; // {sx,sy,x,y,w,h}

  // Alignment guides (recomputed each drag-move)
  let alignGuides = [];

  // ---- helpers ----
  function toWorld(sx, sy) {
    const v = getState().view;
    return { x: sx / v.scale - v.x, y: sy / v.scale - v.y };
  }

  function getStrokes() {
    const st = getState();
    return st.layers[st.activeLayer]?.strokes || [];
  }

  function snapVal(v) {
    return snapToGrid(v, getState().gridSnap);
  }

  /** Expand selection to include all group members */
  function expandGroup(indices, strokes) {
    const set = new Set(indices);
    for (const idx of indices) {
      const s = strokes[idx];
      if (s && s.groupId) {
        for (let i = 0; i < strokes.length; i++) {
          if (strokes[i] && strokes[i].groupId === s.groupId) set.add(i);
        }
      }
    }
    return [...set];
  }

  function autosave() {
    try { localStorage.setItem('blankr_save', JSON.stringify(getState().layers)); } catch {}
  }

  // ================= RENDER =================
  function render() {
    if (!needsRender) { requestAnimationFrame(render); return; }
    needsRender = false;
    const st = getState();
    const view = st.view;
    const dark = st.darkMode;
    const strokes = st.layers[st.activeLayer]?.strokes || [];

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, W, H, view, st.bgPattern, dark);

    // Committed strokes
    for (const s of strokes) {
      if (s) renderStroke(ctx, s, view, dark);
    }

    // In-progress stroke
    if (currentStroke) renderStroke(ctx, currentStroke, view, dark);

    // Selection boxes
    for (const idx of st.selectedIdxs) {
      if (strokes[idx]) drawSelectionBox(ctx, strokes[idx], view);
    }

    // Rubber band
    if (rubberBand) drawRubberBand(ctx, rubberBand, view);

    // Alignment guides
    if (alignGuides.length) drawAlignGuides(ctx, alignGuides, view, W, H);

    // Laser trails
    const now = Date.now();
    laserTrails = laserTrails.filter(t => now - t.time < LASER_FADE_MS);
    for (const t of laserTrails) {
      const alpha = 1 - (now - t.time) / LASER_FADE_MS;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#f44336';
      ctx.lineWidth = 3 * view.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (t.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo((t.points[0].x + view.x) * view.scale, (t.points[0].y + view.y) * view.scale);
        for (let j = 1; j < t.points.length; j++)
          ctx.lineTo((t.points[j].x + view.x) * view.scale, (t.points[j].y + view.y) * view.scale);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Remote cursors
    for (const [uid, rc] of Object.entries(st.remoteCursors)) {
      const sx = (rc.x + view.x) * view.scale;
      const sy = (rc.y + view.y) * view.scale;
      ctx.save();
      ctx.fillStyle = rc.color || '#ff9800';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 4, sy + 14);
      ctx.lineTo(sx + 10, sy + 10);
      ctx.closePath();
      ctx.fill();
      if (rc.name) {
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.fillStyle = rc.color || '#ff9800';
        ctx.fillText(rc.name, sx + 12, sy + 14);
      }
      ctx.restore();
    }

    if (laserTrails.length || Object.keys(st.remoteCursors).length) needsRender = true;

    // Blit
    const mainCtx = canvas.getContext('2d');
    mainCtx.clearRect(0, 0, canvas.width, canvas.height);
    mainCtx.drawImage(offscreen, 0, 0);

    requestAnimationFrame(render);
  }

  // ================= POINTER DOWN =================
  function onDown(e) {
    if (e.preventDefault) e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    const st = getState();
    const strokes = getStrokes();
    const tool = st.tool;

    // ---- right-click context menu ----
    if (e.button === 2) {
      const found = hitTest(strokes, w.x, w.y);
      if (found >= 0 && !st.selectedIdxs.includes(found)) {
        setState({ selectedIdxs: expandGroup([found], strokes) });
      }
      setState({ contextMenu: { x: e.clientX, y: e.clientY } });
      needsRender = true;
      return;
    }

    // Dismiss context menu
    if (st.contextMenu) setState({ contextMenu: null });

    // Record world position for potential drag / resize
    dragStartWX = w.x;
    dragStartWY = w.y;

    // ---- hand / space pan ----
    if (tool === 'hand' || spaceDown) {
      panning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panViewX = st.view.x; panViewY = st.view.y;
      canvas.style.cursor = 'grabbing';
      return;
    }

    // ---- SELECT ----
    if (tool === 'select') {
      // Check handles on single-selected stroke
      if (st.selectedIdxs.length === 1) {
        const idx = st.selectedIdxs[0];
        const h = hitHandle(strokes, idx, sx, sy, st.view);
        if (h === 'rotate') {
          rotating = true;
          rotateOrigStroke = JSON.parse(JSON.stringify(strokes[idx]));
          rotateOrigAngle = strokes[idx].rotation || 0;
          needsRender = true;
          return;
        }
        if (h === 'p1' || h === 'p2') {
          endpointDragging = h;
          endpointOrigStroke = JSON.parse(JSON.stringify(strokes[idx]));
          needsRender = true;
          return;
        }
        if (h) {
          resizingHandle = h;
          resizeOrigBB = getBBox(strokes[idx]);
          resizeOrigStroke = JSON.parse(JSON.stringify(strokes[idx]));
          needsRender = true;
          return;
        }
      }

      // Hit test strokes
      const found = hitTest(strokes, w.x, w.y);
      if (found >= 0) {
        let newSel;
        const expanded = expandGroup([found], strokes);
        if (e.shiftKey) {
          const current = new Set(st.selectedIdxs);
          if (current.has(found)) {
            for (const idx of expanded) current.delete(idx);
          } else {
            for (const idx of expanded) current.add(idx);
          }
          newSel = [...current];
        } else if (st.selectedIdxs.includes(found)) {
          newSel = st.selectedIdxs; // already selected
        } else {
          newSel = expanded;
        }
        setState({ selectedIdxs: newSel });

        // Start multi-drag
        dragging = true;
        dragOrigStrokes.clear();
        for (const idx of newSel) {
          if (strokes[idx]) dragOrigStrokes.set(idx, JSON.parse(JSON.stringify(strokes[idx])));
        }
        needsRender = true;
        return;
      }

      // Empty space: start rubber band or deselect
      if (!e.shiftKey) setState({ selectedIdxs: [] });
      rubberBand = { sx: w.x, sy: w.y, x: w.x, y: w.y, w: 0, h: 0 };
      needsRender = true;
      return;
    }

    // ---- ERASER ----
    if (tool === 'eraser') {
      erasing = true;
      const hit = hitTest(strokes, w.x, w.y);
      if (hit >= 0) {
        const newStrokes = strokes.filter((_, i) => i !== hit);
        const layers = [...st.layers];
        layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
        setState({ layers, selectedIdxs: [] });
        needsRender = true;
      }
      return;
    }

    // ---- LASER ----
    if (tool === 'laser') {
      drawing = true;
      laserTrails.push({ time: Date.now(), points: [{ x: w.x, y: w.y }] });
      needsRender = true;
      return;
    }

    // ---- CONNECTOR ----
    if (tool === 'connector') {
      let bestDist = CONNECTOR_SNAP_DIST, bestAnchor = null;
      for (let i = 0; i < strokes.length; i++) {
        if (!strokes[i] || isLineLike(strokes[i].type)) continue;
        for (const a of getConnectorAnchors(strokes[i])) {
          const d = Math.hypot(w.x - a.x, w.y - a.y);
          if (d < bestDist) { bestDist = d; bestAnchor = { ...a, strokeIdx: i }; }
        }
      }
      if (bestAnchor) {
        connectorStart = bestAnchor;
        currentStroke = {
          type: 'connector', x1: bestAnchor.x, y1: bestAnchor.y,
          x2: bestAnchor.x, y2: bestAnchor.y,
          color: st.color, width: st.lineWidth, opacity: st.opacity,
          fromStroke: bestAnchor.strokeIdx, fromAnchor: bestAnchor.id
        };
        drawing = true;
      }
      needsRender = true;
      return;
    }

    // ---- DRAWING TOOLS ----
    drawing = true;
    const wsx = snapVal(w.x), wsy = snapVal(w.y);
    const base = { color: st.color, width: st.lineWidth, opacity: st.opacity };

    switch (tool) {
      case 'pen':
        currentStroke = { type: 'pen', points: [{ x: wsx, y: wsy }], ...base }; break;
      case 'line':
        currentStroke = { type: 'line', x1: wsx, y1: wsy, x2: wsx, y2: wsy, ...base }; break;
      case 'arrow':
        currentStroke = { type: 'arrow', x1: wsx, y1: wsy, x2: wsx, y2: wsy, ...base }; break;
      case 'rect':
        currentStroke = { type: 'rect', x1: wsx, y1: wsy, x2: wsx, y2: wsy, filled: st.filled, ...base }; break;
      case 'circle':
        currentStroke = { type: 'circle', x1: wsx, y1: wsy, x2: wsx, y2: wsy, filled: st.filled, ...base }; break;
      case 'triangle':
        currentStroke = { type: 'triangle', x1: wsx, y1: wsy, x2: wsx, y2: wsy, filled: st.filled, ...base }; break;
      case 'diamond':
        currentStroke = { type: 'diamond', x1: wsx, y1: wsy, x2: wsx, y2: wsy, filled: st.filled, ...base }; break;
      case 'star':
        currentStroke = { type: 'star', x1: wsx, y1: wsy, x2: wsx, y2: wsy, filled: st.filled, ...base }; break;
      case 'hexagon':
        currentStroke = { type: 'hexagon', x1: wsx, y1: wsy, x2: wsx, y2: wsy, filled: st.filled, ...base }; break;
      case 'frame':
        currentStroke = { type: 'frame', x1: wsx, y1: wsy, x2: wsx, y2: wsy, label: 'Frame', color: st.color, width: 2, opacity: st.opacity }; break;
      case 'text':
        setState({ selectedIdxs: [] });
        drawing = false;
        break;
    }
    needsRender = true;
  }

  // ================= POINTER MOVE =================
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    const st = getState();
    const strokes = getStrokes();

    if (st.collabConnected) sendCursor(w.x, w.y);

    // Pan
    if (panning) {
      const dx = (e.clientX - panStartX) / st.view.scale;
      const dy = (e.clientY - panStartY) / st.view.scale;
      setState({ view: { ...st.view, x: panViewX + dx, y: panViewY + dy } });
      needsRender = true;
      return;
    }

    // Rotate
    if (rotating && st.selectedIdxs.length === 1) {
      const idx = st.selectedIdxs[0];
      const bb = getBBox(rotateOrigStroke);
      if (bb) {
        const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
        const angle = Math.atan2(w.y - cy, w.x - cx) -
          Math.atan2(bb.y - ROTATE_HANDLE_DIST - cy, bb.x + bb.w / 2 - cx);
        const newStroke = { ...rotateOrigStroke, rotation: rotateOrigAngle + angle };
        const newStrokes = [...strokes];
        newStrokes[idx] = newStroke;
        const layers = [...st.layers];
        layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
        setState({ layers });
      }
      needsRender = true;
      return;
    }

    // Endpoint drag
    if (endpointDragging && st.selectedIdxs.length === 1) {
      const idx = st.selectedIdxs[0];
      const snapped = { x: snapVal(w.x), y: snapVal(w.y) };
      const moved = moveEndpoint(endpointOrigStroke, endpointDragging, snapped.x, snapped.y);

      // Snap to connector anchors
      let bestDist = CONNECTOR_SNAP_DIST, bestAnchor = null;
      for (let i = 0; i < strokes.length; i++) {
        if (i === idx || !strokes[i] || isLineLike(strokes[i].type)) continue;
        for (const a of getConnectorAnchors(strokes[i])) {
          const d = Math.hypot(snapped.x - a.x, snapped.y - a.y);
          if (d < bestDist) { bestDist = d; bestAnchor = a; }
        }
      }
      if (bestAnchor) {
        if (endpointDragging === 'p1') { moved.x1 = bestAnchor.x; moved.y1 = bestAnchor.y; }
        else { moved.x2 = bestAnchor.x; moved.y2 = bestAnchor.y; }
      }

      const newStrokes = [...strokes];
      newStrokes[idx] = moved;
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers });
      needsRender = true;
      return;
    }

    // Resize
    if (resizingHandle && st.selectedIdxs.length === 1) {
      const idx = st.selectedIdxs[0];
      const dx = w.x - dragStartWX;
      const dy = w.y - dragStartWY;
      const resized = resizeStroke(resizeOrigStroke, resizingHandle, dx, dy, resizeOrigBB);
      const newStrokes = [...strokes];
      newStrokes[idx] = resized;
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers });
      needsRender = true;
      return;
    }

    // Multi-drag
    if (dragging && st.selectedIdxs.length > 0) {
      let dx = w.x - dragStartWX;
      let dy = w.y - dragStartWY;

      if (st.gridSnap) {
        dx = snapToGrid(dx, true);
        dy = snapToGrid(dy, true);
      }

      // Alignment guides
      if (!st.gridSnap) {
        const movingBBs = [];
        const movingSet = new Set(st.selectedIdxs);
        for (const idx of st.selectedIdxs) {
          const orig = dragOrigStrokes.get(idx);
          if (orig) {
            const moved = moveStroke(orig, dx, dy);
            const bb = getBBox(moved);
            if (bb) movingBBs.push(bb);
          }
        }
        const result = computeAlignGuides(movingBBs, strokes, movingSet, SNAP_THRESHOLD);
        alignGuides = result.guides;
        dx += result.snapDx;
        dy += result.snapDy;
      } else {
        alignGuides = [];
      }

      const newStrokes = [...strokes];
      for (const idx of st.selectedIdxs) {
        const orig = dragOrigStrokes.get(idx);
        if (orig) newStrokes[idx] = moveStroke(orig, dx, dy);
      }
      const layers = [...st.layers];
      layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
      setState({ layers });
      needsRender = true;
      return;
    }

    // Rubber band
    if (rubberBand) {
      rubberBand = {
        ...rubberBand,
        x: Math.min(rubberBand.sx, w.x),
        y: Math.min(rubberBand.sy, w.y),
        w: Math.abs(w.x - rubberBand.sx),
        h: Math.abs(w.y - rubberBand.sy),
      };
      needsRender = true;
      return;
    }

    // Drawing tools
    if (drawing) {
      if (st.tool === 'laser') {
        if (laserTrails.length > 0) laserTrails[laserTrails.length - 1].points.push({ x: w.x, y: w.y });
        needsRender = true;
        return;
      }
      if (st.tool === 'pen' && currentStroke) {
        currentStroke.points.push({ x: w.x, y: w.y });
        needsRender = true;
        return;
      }
      if (currentStroke && currentStroke.x2 !== undefined) {
        currentStroke.x2 = snapVal(w.x);
        currentStroke.y2 = snapVal(w.y);

        // Connector anchor snapping
        if (currentStroke.type === 'connector') {
          let bestDist = CONNECTOR_SNAP_DIST, bestAnchor = null;
          for (let i = 0; i < strokes.length; i++) {
            if (!strokes[i] || isLineLike(strokes[i].type)) continue;
            for (const a of getConnectorAnchors(strokes[i])) {
              const d = Math.hypot(w.x - a.x, w.y - a.y);
              if (d < bestDist) { bestDist = d; bestAnchor = { ...a, strokeIdx: i }; }
            }
          }
          if (bestAnchor) {
            currentStroke.x2 = bestAnchor.x;
            currentStroke.y2 = bestAnchor.y;
            currentStroke.toStroke = bestAnchor.strokeIdx;
            currentStroke.toAnchor = bestAnchor.id;
          } else {
            delete currentStroke.toStroke;
            delete currentStroke.toAnchor;
          }
        }
        needsRender = true;
        return;
      }
    }

    // Erasing
    if (erasing) {
      const hit = hitTest(strokes, w.x, w.y);
      if (hit >= 0) {
        const newStrokes = strokes.filter((_, i) => i !== hit);
        const layers = [...st.layers];
        layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: newStrokes };
        setState({ layers, selectedIdxs: [] });
        needsRender = true;
      }
      return;
    }

    // Hover cursor
    if (st.tool === 'select' && !drawing) {
      if (st.selectedIdxs.length === 1) {
        const h = hitHandle(strokes, st.selectedIdxs[0], sx, sy, st.view);
        if (h) { canvas.style.cursor = handleCursor(h); return; }
      }
      const hit = hitTest(strokes, w.x, w.y);
      canvas.style.cursor = hit >= 0 ? 'move' : 'default';
    } else if (st.tool === 'hand' || spaceDown) {
      canvas.style.cursor = 'grab';
    } else if (st.tool === 'eraser') {
      canvas.style.cursor = 'crosshair';
    } else if (st.tool === 'text') {
      canvas.style.cursor = 'text';
    }
  }

  // ================= POINTER UP =================
  function onUp(e) {
    const st = getState();

    if (panning) {
      panning = false;
      canvas.style.cursor = st.tool === 'hand' ? 'grab' : 'default';
      return;
    }

    if (rotating) {
      rotating = false;
      rotateOrigStroke = null;
      autosave(); needsRender = true;
      return;
    }

    if (endpointDragging) {
      endpointDragging = null;
      endpointOrigStroke = null;
      autosave(); needsRender = true;
      return;
    }

    if (resizingHandle) {
      resizingHandle = null;
      resizeOrigBB = null;
      resizeOrigStroke = null;
      autosave(); needsRender = true;
      return;
    }

    if (dragging) {
      dragging = false;
      dragOrigStrokes.clear();
      alignGuides = [];
      autosave(); needsRender = true;
      return;
    }

    // End rubber band
    if (rubberBand) {
      if (rubberBand.w > 3 || rubberBand.h > 3) {
        const strokes = getStrokes();
        const selected = [];
        for (let i = 0; i < strokes.length; i++) {
          const bb = getBBox(strokes[i]);
          if (!bb) continue;
          if (bb.x + bb.w >= rubberBand.x && bb.x <= rubberBand.x + rubberBand.w &&
              bb.y + bb.h >= rubberBand.y && bb.y <= rubberBand.y + rubberBand.h) {
            selected.push(i);
          }
        }
        setState({ selectedIdxs: expandGroup(selected, strokes) });
      }
      rubberBand = null;
      needsRender = true;
      return;
    }

    if (erasing) {
      erasing = false;
      autosave();
      return;
    }

    // End drawing
    if (drawing) {
      drawing = false;
      if (st.tool === 'laser') { needsRender = true; return; }
      if (currentStroke) {
        if (currentStroke.type === 'pen' && (!currentStroke.points || currentStroke.points.length < 2)) {
          currentStroke = null; return;
        }
        const strokes = getStrokes();
        const layers = [...st.layers];
        layers[st.activeLayer] = { ...layers[st.activeLayer], strokes: [...strokes, currentStroke] };
        setState({ layers });
        if (st.collabConnected) sendStroke(currentStroke);
        currentStroke = null;
        autosave();
        needsRender = true;
      }
    }
  }

  // ================= DOUBLE CLICK =================
  function onDblClick(e) {
    const rect = canvas.getBoundingClientRect();
    const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const st = getState();
    const strokes = getStrokes();

    if (st.tool === 'select') {
      const found = hitTest(strokes, w.x, w.y);
      if (found >= 0) {
        const s = strokes[found];
        setState({ selectedIdxs: [found] });
        if (s.type === 'text' && setTextEdit) {
          // Open WYSIWYG editor for text
          const v = st.view;
          const sx = (s.x + v.x) * v.scale + rect.left;
          const sy = (s.y - (s.fontSize || 16) + v.y) * v.scale + rect.top;
          setTextEdit({ editIdx: found, wx: s.x, wy: s.y, sx, sy,
            fontSize: s.fontSize || 16, color: s.color, bold: s.bold, italic: s.italic,
            initialText: s.text || '' });
          return;
        }
        // For shapes: edit label
        if (['rect','circle','triangle','diamond','star','hexagon','frame'].includes(s.type) && setTextEdit) {
          const bb = getBBox(s);
          if (bb) {
            const v = st.view;
            const cx = (bb.x + bb.w / 2 + v.x) * v.scale + rect.left;
            const cy = (bb.y + bb.h / 2 + v.y) * v.scale + rect.top;
            setTextEdit({ editIdx: found, wx: bb.x + bb.w / 2, wy: bb.y + bb.h / 2,
              sx: cx - 50, sy: cy - 12, fontSize: s.fontSize || 14,
              color: s.color, isLabel: true, initialText: s.label || '' });
          }
        }
      } else if (st.tool === 'select' || st.tool === 'text') {
        // Click empty space with text tool: new text
        if (setTextEdit) {
          const v = st.view;
          const sx = (w.x + v.x) * v.scale + rect.left;
          const sy = (w.y + v.y) * v.scale + rect.top;
          setTextEdit({ wx: w.x, wy: w.y, sx, sy,
            fontSize: st.fontSize || 20, color: st.color, initialText: '' });
        }
      }
    } else if (st.tool === 'text') {
      // Text tool: new text at click position
      if (setTextEdit) {
        const v = st.view;
        const sx = (w.x + v.x) * v.scale + rect.left;
        const sy = (w.y + v.y) * v.scale + rect.top;
        setTextEdit({ wx: w.x, wy: w.y, sx, sy,
          fontSize: st.fontSize || 20, color: st.color, initialText: '' });
      }
    }
  }

  // ================= WHEEL =================
  function onWheel(e) {
    e.preventDefault();
    const st = getState();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(10, Math.max(0.05, st.view.scale * factor));
    const wx = mx / st.view.scale - st.view.x;
    const wy = my / st.view.scale - st.view.y;
    setState({ view: { x: mx / newScale - wx, y: my / newScale - wy, scale: newScale } });
    needsRender = true;
  }

  // ================= KEYBOARD =================
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    const st = getState();
    const strokes = getStrokes();
    const meta = e.metaKey || e.ctrlKey;

    // Space pan
    if (e.code === 'Space' && !spaceDown) {
      spaceDown = true;
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
      autosave(); needsRender = true;
      return;
    }

    // Ctrl+A select all
    if (meta && e.key === 'a') {
      e.preventDefault();
      setState({ selectedIdxs: strokes.map((_, i) => i) });
      needsRender = true;
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
      autosave(); needsRender = true;
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
      autosave(); needsRender = true;
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
      autosave(); needsRender = true;
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
      autosave(); needsRender = true;
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
      autosave(); needsRender = true;
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
      autosave(); needsRender = true;
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      setState({ selectedIdxs: [], contextMenu: null });
      needsRender = true;
      return;
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceDown = false;
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
    autosave(); needsRender = true;
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
        autosave(); needsRender = true;
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
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchActive = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.hypot(dx, dy);
      pinchStartScale = getState().view.scale;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      onDown({ clientX: t.clientX, clientY: t.clientY, button: 0, preventDefault() {}, shiftKey: false });
    }
  }

  function onTouchMove(e) {
    if (pinchActive && e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.min(10, Math.max(0.05, pinchStartScale * (dist / pinchStartDist)));
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const st = getState();
      const rect = canvas.getBoundingClientRect();
      const cx = mx - rect.left, cy = my - rect.top;
      const wx = cx / st.view.scale - st.view.x;
      const wy = cy / st.view.scale - st.view.y;
      setState({ view: { x: cx / newScale - wx, y: cy / newScale - wy, scale: newScale } });
      needsRender = true;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault() {} });
    }
  }

  function onTouchEnd(e) {
    if (pinchActive) { pinchActive = false; return; }
    onUp({ preventDefault() {} });
  }

  function onContextMenu(e) { e.preventDefault(); }

  // ---- resize ----
  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width * dpr;
    H = rect.height * dpr;
    canvas.width = W;
    canvas.height = H;
    offscreen.width = W;
    offscreen.height = H;
    needsRender = true;
  }

  // ================= INIT =================
  resize();
  requestAnimationFrame(render);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onUp);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('paste', onPaste);
  window.addEventListener('resize', resize);

  // Load images from saved state
  const initState = getState();
  for (const layer of initState.layers) {
    for (const s of layer.strokes) {
      if (s && s.type === 'image' && s.src && !s._img) {
        const img = new Image();
        img.onload = () => { needsRender = true; };
        img.src = s.src;
        s._img = img;
      }
    }
  }

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointerleave', onUp);
    canvas.removeEventListener('dblclick', onDblClick);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('paste', onPaste);
    window.removeEventListener('resize', resize);
  };
}

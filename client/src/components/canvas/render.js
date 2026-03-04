/* ═══════════════════════════════════════
   Canvas — Rendering
   All draw calls, no state mutation.
   ═══════════════════════════════════════ */

import { BG_SPACING, HANDLE_SIZE, ROTATE_HANDLE_DIST } from './constants.js';
import { getBBox, getCenter, getConnectorAnchors, isLineLike } from './geometry.js';

/* ── Background patterns ── */
export function drawBackground(ctx, cvs, dpr, state) {
  const { bgPattern, darkMode, view } = state;
  const w = cvs.width / dpr, h = cvs.height / dpr;

  ctx.fillStyle = darkMode ? '#1e1e32' : '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (bgPattern === 'none') return;

  const sp = BG_SPACING * view.scale;
  const oX = view.x % sp, oY = view.y % sp;
  const col = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';

  ctx.save();
  if (bgPattern === 'dots') {
    ctx.fillStyle = col;
    for (let x = oX; x < w; x += sp)
      for (let y = oY; y < h; y += sp) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, view.scale * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
  } else if (bgPattern === 'grid') {
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = oX; x < w; x += sp) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oY; y < h; y += sp) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  } else if (bgPattern === 'lines') {
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
    for (let y = oY; y < h; y += sp) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }
  ctx.restore();
}

/* ── Arrow head (draw.io open-V style) ── */
export function drawArrowHead(c, x1, y1, x2, y2, strokeWidth) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(14, strokeWidth * 5);
  const headAngle = Math.PI / 6; // 30°
  c.beginPath();
  c.moveTo(x2 - headLen * Math.cos(angle - headAngle), y2 - headLen * Math.sin(angle - headAngle));
  c.lineTo(x2, y2);
  c.lineTo(x2 - headLen * Math.cos(angle + headAngle), y2 - headLen * Math.sin(angle + headAngle));
  c.stroke();
}

/**
 * In dark mode, invert near-black colours so strokes stay visible
 * on the dark background. Only affects rendering — stored data is unchanged.
 */
function adaptColor(color, darkMode) {
  if (!darkMode || !color) return color;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return color;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  // Perceived luminance — threshold 60 catches #000000 .. ~#333333
  if (0.299 * r + 0.587 * g + 0.114 * b < 60) {
    return `rgb(${255 - r},${255 - g},${255 - b})`;
  }
  return color;
}

/* ── Single stroke ── */
export function renderStroke(c, s, getImage, darkMode) {
  c.save();

  if (s.rotation) {
    const { cx, cy } = getCenter(s);
    c.translate(cx, cy);
    c.rotate(s.rotation);
    c.translate(-cx, -cy);
  }

  const col = adaptColor(s.color || '#1e1e1e', darkMode);
  c.lineWidth = s.width || 3;
  c.strokeStyle = col;
  c.fillStyle = col;
  c.globalAlpha = s.opacity ?? 1;
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // Legacy eraser strokes (from old saves): render as pen strokes
  // New eraser is object-based and doesn't create strokes.

  switch (s.type) {
    case 'pen': case 'eraser':
      if (!s.points || s.points.length < 2) break;
      c.beginPath(); c.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y);
      c.stroke(); break;

    case 'line':
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke(); break;

    case 'arrow': {
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
      const sw = c.lineWidth;
      c.lineCap = 'butt'; c.lineJoin = 'miter'; c.miterLimit = 10;
      c.lineWidth = Math.max(2, sw);
      drawArrowHead(c, s.x1, s.y1, s.x2, s.y2, sw);
      break;
    }

    case 'connector': {
      c.strokeStyle = s.color || '#6366f1';
      c.lineWidth = s.width || 2;
      c.setLineDash([]);
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
      c.lineCap = 'butt'; c.lineJoin = 'miter'; c.miterLimit = 10;
      drawArrowHead(c, s.x1, s.y1, s.x2, s.y2, 2);
      break;
    }

    case 'rect':
      if (s.filled) c.fillRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1);
      c.strokeRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1); break;

    case 'circle': {
      const rx = (s.x2 - s.x1) / 2, ry = (s.y2 - s.y1) / 2;
      c.beginPath();
      c.ellipse(s.x1 + rx, s.y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      if (s.filled) c.fill(); c.stroke(); break;
    }

    case 'text': {
      const fs = s.fontSize || 16;
      const bold = s.bold ? 'bold ' : '';
      const italic = s.italic ? 'italic ' : '';
      c.font = `${italic}${bold}${fs}px 'Inter',sans-serif`;
      c.globalCompositeOperation = 'source-over';
      (s.text || '').split('\n').forEach((l, i) =>
        c.fillText(l, s.x, s.y + i * fs * 1.3)
      );
      break;
    }

    case 'image': {
      const img = getImage(s.data);
      if (img) c.drawImage(img, s.x, s.y, s.w, s.h);
      break;
    }
  }

  c.globalCompositeOperation = 'source-over';
  c.restore();
}

/* ── Selection overlay for line-like strokes ── */
function drawLineSelectionBox(c, s, view) {
  const lw = 1.5 / view.scale;
  const hs = HANDLE_SIZE / view.scale;

  c.save();
  if (s.rotation) {
    const { cx, cy } = getCenter(s);
    c.translate(cx, cy);
    c.rotate(s.rotation);
    c.translate(-cx, -cy);
  }

  // Dashed line between endpoints
  c.strokeStyle = '#6366f1'; c.lineWidth = lw;
  c.setLineDash([6 / view.scale, 4 / view.scale]);
  c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
  c.setLineDash([]);

  // Endpoint 1 — larger filled circle with ring
  c.fillStyle = '#ffffff'; c.strokeStyle = '#6366f1'; c.lineWidth = lw * 1.5;
  c.beginPath(); c.arc(s.x1, s.y1, hs * 1.1, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#6366f1';
  c.beginPath(); c.arc(s.x1, s.y1, hs * 0.4, 0, Math.PI * 2); c.fill();

  // Endpoint 2 — larger filled circle with ring
  c.fillStyle = '#ffffff'; c.strokeStyle = '#6366f1'; c.lineWidth = lw * 1.5;
  c.beginPath(); c.arc(s.x2, s.y2, hs * 1.1, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#6366f1';
  c.beginPath(); c.arc(s.x2, s.y2, hs * 0.4, 0, Math.PI * 2); c.fill();

  // Rotation handle — perpendicular to midpoint
  const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy) || 1;
  const rotDist = ROTATE_HANDLE_DIST / view.scale;
  const rotX = mx + (-dy / len) * rotDist;
  const rotY = my + (dx / len) * rotDist;

  c.strokeStyle = '#6366f1'; c.lineWidth = lw;
  c.beginPath(); c.moveTo(mx, my); c.lineTo(rotX, rotY); c.stroke();
  c.fillStyle = '#ffffff'; c.beginPath();
  c.arc(rotX, rotY, hs * 0.7, 0, Math.PI * 2); c.fill(); c.stroke();
  // Rotation arrow icon
  c.strokeStyle = '#6366f1'; c.lineWidth = lw * 0.8;
  c.beginPath();
  c.arc(rotX, rotY, hs * 0.4, -Math.PI * 0.8, Math.PI * 0.3);
  c.stroke();

  c.restore();
}

/* ── Selection overlay for shape strokes ── */
function drawShapeSelectionBox(c, s, view) {
  const bb = getBBox(s);
  if (!bb) return;

  c.save();
  if (s.rotation) {
    const { cx, cy } = getCenter(s);
    c.translate(cx, cy);
    c.rotate(s.rotation);
    c.translate(-cx, -cy);
  }

  const lw = 1.5 / view.scale;
  const hs = HANDLE_SIZE / view.scale;

  // Dashed bounding box
  c.strokeStyle = '#6366f1'; c.lineWidth = lw;
  c.setLineDash([6 / view.scale, 4 / view.scale]);
  c.strokeRect(bb.x, bb.y, bb.w, bb.h);
  c.setLineDash([]);

  // Corner handles
  c.fillStyle = '#ffffff'; c.strokeStyle = '#6366f1'; c.lineWidth = lw;
  const corners = [
    [bb.x, bb.y], [bb.x + bb.w, bb.y],
    [bb.x, bb.y + bb.h], [bb.x + bb.w, bb.y + bb.h],
  ];
  for (const [cx, cy] of corners) {
    c.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    c.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
  }

  // Rotation handle (above top-center)
  const rotX = bb.x + bb.w / 2;
  const rotY = bb.y - ROTATE_HANDLE_DIST / view.scale;
  c.strokeStyle = '#6366f1'; c.lineWidth = lw;
  c.beginPath(); c.moveTo(bb.x + bb.w / 2, bb.y); c.lineTo(rotX, rotY); c.stroke();
  c.fillStyle = '#ffffff'; c.beginPath();
  c.arc(rotX, rotY, hs * 0.7, 0, Math.PI * 2); c.fill(); c.stroke();
  c.strokeStyle = '#6366f1'; c.lineWidth = lw * 0.8;
  c.beginPath();
  c.arc(rotX, rotY, hs * 0.4, -Math.PI * 0.8, Math.PI * 0.3);
  c.stroke();

  // Connector anchor dots
  c.fillStyle = 'rgba(99,102,241,0.3)'; c.strokeStyle = '#6366f1'; c.lineWidth = lw;
  const anchors = getConnectorAnchors(s);
  for (const a of anchors) {
    c.beginPath(); c.arc(a.x, a.y, hs * 0.5, 0, Math.PI * 2); c.fill(); c.stroke();
  }

  c.restore();
}

/**
 * Draw the appropriate selection overlay for a stroke.
 */
export function drawSelectionBox(c, s, view) {
  if (isLineLike(s.type)) {
    drawLineSelectionBox(c, s, view);
  } else {
    drawShapeSelectionBox(c, s, view);
  }
}

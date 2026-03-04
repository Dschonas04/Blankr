// Canvas - Rendering

import { BG_SPACING, HANDLE_SIZE, ROTATE_HANDLE_DIST } from './constants.js';
import { getBBox, rotatePoint, isLineLike, isPolygonShape, getShapeVertices } from './geometry.js';

// ---- background ----
export function drawBackground(ctx, W, H, view, pattern, dark) {
  ctx.fillStyle = dark ? '#1e1e1e' : '#f5f5f5';
  ctx.fillRect(0, 0, W, H);
  if (pattern === 'none') return;
  const sp = BG_SPACING * view.scale;
  if (sp < 4) return;
  const ox = ((view.x * view.scale) % sp + sp) % sp;
  const oy = ((view.y * view.scale) % sp + sp) % sp;
  ctx.fillStyle = dark ? '#333' : '#ddd';
  if (pattern === 'dots') {
    for (let x = ox; x < W; x += sp)
      for (let y = oy; y < H; y += sp)
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
  } else if (pattern === 'grid') {
    ctx.strokeStyle = dark ? '#333' : '#ddd';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = ox; x < W; x += sp) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += sp) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }
}

// ---- arrow head ----
export function drawArrowHead(ctx, x1, y1, x2, y2, size) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.translate(x2, y2);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-size, -size * 0.5);
  ctx.lineTo(0, 0);
  ctx.lineTo(-size, size * 0.5);
  ctx.stroke();
  ctx.restore();
}

/** Adapt color for dark mode: invert near-black colors */
export function adaptColor(color, dark) {
  if (!dark) return color;
  if (!color) return '#fff';
  const c = color.toLowerCase().replace(/\s/g, '');
  if (c === '#000' || c === '#000000' || c === '#1e1e1e' || c === 'black' ||
      c === 'rgb(0,0,0)' || c === 'rgb(30,30,30)') return '#ffffff';
  return color;
}

// ---- render a single stroke ----
export function renderStroke(ctx, s, view, dark) {
  ctx.save();
  const color = adaptColor(s.color, dark);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = (s.width || 3) * view.scale;
  ctx.globalAlpha = s.opacity ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const tx = (x) => (x + view.x) * view.scale;
  const ty = (y) => (y + view.y) * view.scale;

  // Apply rotation
  if (s.rotation) {
    const bb = getBBox(s);
    if (bb) {
      const cx = tx(bb.x + bb.w / 2), cy = ty(bb.y + bb.h / 2);
      ctx.translate(cx, cy);
      ctx.rotate(s.rotation);
      ctx.translate(-cx, -cy);
    }
  }

  switch (s.type) {
    case 'pen': case 'eraser': {
      if (!s.points || s.points.length < 2) break;
      if (s.type === 'eraser') {
        ctx.strokeStyle = dark ? '#1e1e1e' : '#f5f5f5';
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.beginPath();
      ctx.moveTo(tx(s.points[0].x), ty(s.points[0].y));
      for (let j = 1; j < s.points.length; j++) ctx.lineTo(tx(s.points[j].x), ty(s.points[j].y));
      ctx.stroke();
      break;
    }
    case 'line':
      ctx.beginPath();
      ctx.moveTo(tx(s.x1), ty(s.y1));
      ctx.lineTo(tx(s.x2), ty(s.y2));
      ctx.stroke();
      break;
    case 'arrow':
      ctx.beginPath();
      ctx.moveTo(tx(s.x1), ty(s.y1));
      ctx.lineTo(tx(s.x2), ty(s.y2));
      ctx.stroke();
      drawArrowHead(ctx, tx(s.x1), ty(s.y1), tx(s.x2), ty(s.y2), Math.max(10, (s.width || 3) * view.scale * 3));
      break;
    case 'connector': {
      ctx.beginPath();
      ctx.moveTo(tx(s.x1), ty(s.y1));
      ctx.lineTo(tx(s.x2), ty(s.y2));
      ctx.stroke();
      drawArrowHead(ctx, tx(s.x1), ty(s.y1), tx(s.x2), ty(s.y2), Math.max(10, (s.width || 3) * view.scale * 3));
      // Draw anchor dots
      ctx.fillStyle = dark ? '#4fc3f7' : '#1976d2';
      for (const p of [{x: s.x1, y: s.y1}, {x: s.x2, y: s.y2}]) {
        ctx.beginPath();
        ctx.arc(tx(p.x), ty(p.y), 4 * view.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'rect': {
      const rx = tx(Math.min(s.x1, s.x2)), ry = ty(Math.min(s.y1, s.y2));
      const rw = Math.abs(s.x2 - s.x1) * view.scale, rh = Math.abs(s.y2 - s.y1) * view.scale;
      if (s.filled) ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      break;
    }
    case 'circle': {
      const cx = tx((s.x1 + s.x2) / 2), cy = ty((s.y1 + s.y2) / 2);
      const rx = Math.abs(s.x2 - s.x1) / 2 * view.scale, ry = Math.abs(s.y2 - s.y1) / 2 * view.scale;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
      if (s.filled) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'triangle': case 'diamond': case 'star': case 'hexagon': {
      const verts = getShapeVertices(s.type, s.x1, s.y1, s.x2, s.y2);
      if (verts.length < 3) break;
      ctx.beginPath();
      ctx.moveTo(tx(verts[0].x), ty(verts[0].y));
      for (let j = 1; j < verts.length; j++) ctx.lineTo(tx(verts[j].x), ty(verts[j].y));
      ctx.closePath();
      if (s.filled) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'frame': {
      const rx = tx(Math.min(s.x1, s.x2)), ry = ty(Math.min(s.y1, s.y2));
      const rw = Math.abs(s.x2 - s.x1) * view.scale, rh = Math.abs(s.y2 - s.y1) * view.scale;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = dark ? '#666' : '#999';
      ctx.lineWidth = 1.5 * view.scale;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      // Label
      const label = s.label || 'Frame';
      ctx.font = `${12 * view.scale}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = dark ? '#888' : '#666';
      ctx.fillText(label, rx + 4 * view.scale, ry - 4 * view.scale);
      break;
    }
    case 'text': {
      const fs = (s.fontSize || 16) * view.scale;
      const weight = s.bold ? 'bold' : 'normal';
      const style = s.italic ? 'italic' : 'normal';
      ctx.font = `${style} ${weight} ${fs}px Inter, system-ui, sans-serif`;
      const lines = (s.text || '').split('\n');
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], tx(s.x), ty(s.y) + li * fs * 1.3);
      }
      break;
    }
    case 'image': {
      if (s._img && s._img.complete) {
        const w = (s.w || s._img.naturalWidth || 100) * view.scale;
        const h = (s.h || s._img.naturalHeight || 100) * view.scale;
        ctx.drawImage(s._img, tx(s.x), ty(s.y), w, h);
      }
      break;
    }
  }

  // Draw shape label (text on shapes)
  if (s.label && s.type !== 'frame' && s.type !== 'text') {
    const bb = getBBox(s);
    if (bb) {
      const cx = tx(bb.x + bb.w / 2), cy = ty(bb.y + bb.h / 2);
      const fs = (s.fontSize || 14) * view.scale;
      ctx.font = `${fs}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = adaptColor(s.color || '#1e1e1e', dark);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelLines = s.label.split('\n');
      for (let li = 0; li < labelLines.length; li++) {
        ctx.fillText(labelLines[li], cx, cy + (li - (labelLines.length - 1) / 2) * fs * 1.3);
      }
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  ctx.restore();
}

// ---- selection box for line-like strokes ----
function drawLineSelectionBox(ctx, s, view) {
  const toScreen = (x, y) => {
    let rx = x, ry = y;
    if (s.rotation) {
      const bb = getBBox(s);
      if (bb) {
        const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
        const rp = rotatePoint(x, y, cx, cy, s.rotation);
        rx = rp.x; ry = rp.y;
      }
    }
    return { x: (rx + view.x) * view.scale, y: (ry + view.y) * view.scale };
  };
  const p1 = toScreen(s.x1, s.y1);
  const p2 = toScreen(s.x2, s.y2);
  const r = 5;
  ctx.strokeStyle = '#2196f3';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);

  // Endpoint circles
  for (const p of [p1, p2]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.stroke();
  }
}

// ---- selection box for shapes ----
export function drawSelectionBox(ctx, s, view) {
  if (!s) return;
  if (isLineLike(s.type)) return drawLineSelectionBox(ctx, s, view);

  const bb = getBBox(s);
  if (!bb) return;

  const hs = HANDLE_SIZE;
  ctx.save();

  // Apply rotation
  const cx = (bb.x + bb.w / 2 + view.x) * view.scale;
  const cy = (bb.y + bb.h / 2 + view.y) * view.scale;
  if (s.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(s.rotation);
    ctx.translate(-cx, -cy);
  }

  const rx = (bb.x + view.x) * view.scale;
  const ry = (bb.y + view.y) * view.scale;
  const rw = bb.w * view.scale;
  const rh = bb.h * view.scale;

  // Dashed outline
  ctx.strokeStyle = '#2196f3';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.setLineDash([]);

  // Corner handles
  for (const [hx, hy] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
    ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2);
  }

  // Rotate handle
  const rtx = rx + rw / 2, rty = ry - ROTATE_HANDLE_DIST * view.scale;
  ctx.beginPath();
  ctx.moveTo(rx + rw / 2, ry);
  ctx.lineTo(rtx, rty);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rtx, rty, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// ---- rubber band selection rect ----
export function drawRubberBand(ctx, rect, view) {
  if (!rect) return;
  const x = (rect.x + view.x) * view.scale;
  const y = (rect.y + view.y) * view.scale;
  const w = rect.w * view.scale;
  const h = rect.h * view.scale;
  ctx.save();
  ctx.strokeStyle = '#2196f3';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(33, 150, 243, 0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

// ---- alignment guides ----
export function drawAlignGuides(ctx, guides, view, W, H) {
  if (!guides || !guides.length) return;
  ctx.save();
  ctx.strokeStyle = '#f44336';
  ctx.lineWidth = 0.7;
  ctx.setLineDash([3, 3]);
  for (const g of guides) {
    ctx.beginPath();
    if (g.axis === 'x') {
      const sx = (g.pos + view.x) * view.scale;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    } else {
      const sy = (g.pos + view.y) * view.scale;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// Canvas - Geometry Helpers (pure functions, no side-effects)

import { SNAP_THRESHOLD, GRID_SIZE } from './constants.js';

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function rotatePoint(px, py, cx, cy, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Vertices for polygon-based shapes */
export function getShapeVertices(type, x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const hw = (x2 - x1) / 2, hh = (y2 - y1) / 2;
  switch (type) {
    case 'triangle': return [
      { x: cx, y: Math.min(y1, y2) },
      { x: Math.max(x1, x2), y: Math.max(y1, y2) },
      { x: Math.min(x1, x2), y: Math.max(y1, y2) },
    ];
    case 'diamond': return [
      { x: cx, y: Math.min(y1, y2) },
      { x: Math.max(x1, x2), y: cy },
      { x: cx, y: Math.max(y1, y2) },
      { x: Math.min(x1, x2), y: cy },
    ];
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 10;
        const r = i % 2 === 0 ? 1 : 0.38;
        pts.push({ x: cx + Math.abs(hw) * r * Math.cos(angle), y: cy + Math.abs(hh) * r * Math.sin(angle) });
      }
      return pts;
    }
    case 'hexagon': {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
        pts.push({ x: cx + Math.abs(hw) * Math.cos(angle), y: cy + Math.abs(hh) * Math.sin(angle) });
      }
      return pts;
    }
    default: return [];
  }
}

/** Ray-casting point-in-polygon test */
export function pointInPolygon(px, py, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

/** Shortest distance from point to polygon edges */
export function distToPolygon(px, py, vertices) {
  let minD = Infinity;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const d = distToSegment(px, py, vertices[j].x, vertices[j].y, vertices[i].x, vertices[i].y);
    if (d < minD) minD = d;
  }
  return minD;
}

export function getBBox(s) {
  switch (s.type) {
    case 'pen': case 'eraser': {
      if (!s.points || !s.points.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of s.points) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      const pad = (s.width || 3) / 2 + 4;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'line': case 'arrow': case 'connector': {
      const pad = (s.width || 3) / 2 + 6;
      return {
        x: Math.min(s.x1, s.x2) - pad, y: Math.min(s.y1, s.y2) - pad,
        w: Math.abs(s.x2 - s.x1) + pad * 2, h: Math.abs(s.y2 - s.y1) + pad * 2,
      };
    }
    case 'rect': case 'circle':
    case 'triangle': case 'diamond': case 'star': case 'hexagon':
    case 'frame': {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      return { x: x - 4, y: y - 4, w: Math.abs(s.x2 - s.x1) + 8, h: Math.abs(s.y2 - s.y1) + 8 };
    }
    case 'text': {
      const w = Math.max(80, (s.text || '').length * (s.fontSize || 16) * 0.6);
      const lines = (s.text || '').split('\n').length;
      const h = lines * (s.fontSize || 16) * 1.3 + 8;
      return { x: s.x - 4, y: s.y - (s.fontSize || 16) - 4, w: w + 8, h: h + 8 };
    }
    case 'image':
      return { x: s.x - 4, y: s.y - 4, w: (s.w || 100) + 8, h: (s.h || 100) + 8 };
    default:
      return null;
  }
}

export function getCenter(s) {
  const bb = getBBox(s);
  if (!bb) return { cx: 0, cy: 0 };
  return { cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2 };
}

export function getConnectorAnchors(s) {
  const bb = getBBox(s);
  if (!bb) return [];
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  return [
    { x: cx, y: bb.y, id: 'top' },
    { x: bb.x + bb.w, y: cy, id: 'right' },
    { x: cx, y: bb.y + bb.h, id: 'bottom' },
    { x: bb.x, y: cy, id: 'left' },
  ];
}

export function moveStroke(s, dx, dy) {
  const m = { ...s };
  switch (s.type) {
    case 'pen': case 'eraser':
      m.points = s.points.map(p => ({ x: p.x + dx, y: p.y + dy })); break;
    case 'line': case 'arrow': case 'rect': case 'circle': case 'connector':
    case 'triangle': case 'diamond': case 'star': case 'hexagon': case 'frame':
      m.x1 = s.x1 + dx; m.y1 = s.y1 + dy;
      m.x2 = s.x2 + dx; m.y2 = s.y2 + dy; break;
    case 'text': case 'image':
      m.x = s.x + dx; m.y = s.y + dy; break;
  }
  return m;
}

export function resizeStroke(s, handle, dx, dy, origBB) {
  const m = { ...s };
  let sx = 1, sy = 1, ox = origBB.x, oy = origBB.y;

  if (handle === 'tl') { sx = (origBB.w - dx) / origBB.w; sy = (origBB.h - dy) / origBB.h; ox = origBB.x + origBB.w; oy = origBB.y + origBB.h; }
  else if (handle === 'tr') { sx = (origBB.w + dx) / origBB.w; sy = (origBB.h - dy) / origBB.h; ox = origBB.x; oy = origBB.y + origBB.h; }
  else if (handle === 'bl') { sx = (origBB.w - dx) / origBB.w; sy = (origBB.h + dy) / origBB.h; ox = origBB.x + origBB.w; oy = origBB.y; }
  else if (handle === 'br') { sx = (origBB.w + dx) / origBB.w; sy = (origBB.h + dy) / origBB.h; ox = origBB.x; oy = origBB.y; }

  if (Math.abs(sx) < 0.05) sx = 0.05;
  if (Math.abs(sy) < 0.05) sy = 0.05;

  function scaleP(px, py) { return { x: ox + (px - ox) * sx, y: oy + (py - oy) * sy }; }

  switch (s.type) {
    case 'pen': case 'eraser':
      m.points = s.points.map(p => scaleP(p.x, p.y)); break;
    case 'rect': case 'circle':
    case 'triangle': case 'diamond': case 'star': case 'hexagon': case 'frame': {
      const p1 = scaleP(s.x1, s.y1), p2 = scaleP(s.x2, s.y2);
      m.x1 = p1.x; m.y1 = p1.y; m.x2 = p2.x; m.y2 = p2.y; break;
    }
    case 'text': {
      const p = scaleP(s.x, s.y);
      m.x = p.x; m.y = p.y;
      m.fontSize = Math.max(8, (s.fontSize || 16) * Math.max(sx, sy));
      break;
    }
    case 'image': {
      const p = scaleP(s.x, s.y);
      m.x = p.x; m.y = p.y;
      m.w = (s.w || 100) * Math.abs(sx);
      m.h = (s.h || 100) * Math.abs(sy);
      break;
    }
  }
  return m;
}

export function moveEndpoint(s, endpoint, wx, wy) {
  const m = { ...s };
  if (endpoint === 'p1') { m.x1 = wx; m.y1 = wy; }
  else if (endpoint === 'p2') { m.x2 = wx; m.y2 = wy; }
  return m;
}

export function isLineLike(type) {
  return type === 'line' || type === 'arrow' || type === 'connector';
}

export function isPolygonShape(type) {
  return type === 'triangle' || type === 'diamond' || type === 'star' || type === 'hexagon';
}

/** Snap a coordinate to grid */
export function snapToGrid(val, gridSnap) {
  if (!gridSnap) return val;
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

/**
 * Compute alignment guide lines when dragging.
 * Returns { guides: [{axis,pos}], snapDx, snapDy }
 */
export function computeAlignGuides(movingBBs, allStrokes, movingSet, threshold) {
  const guides = [];
  let snapDx = 0, snapDy = 0;
  if (!movingBBs.length) return { guides, snapDx, snapDy };

  let mx1 = Infinity, my1 = Infinity, mx2 = -Infinity, my2 = -Infinity;
  for (const bb of movingBBs) {
    if (bb.x < mx1) mx1 = bb.x;
    if (bb.y < my1) my1 = bb.y;
    if (bb.x + bb.w > mx2) mx2 = bb.x + bb.w;
    if (bb.y + bb.h > my2) my2 = bb.y + bb.h;
  }
  const mcx = (mx1 + mx2) / 2, mcy = (my1 + my2) / 2;
  let bestDx = Infinity, bestDy = Infinity;

  for (let i = 0; i < allStrokes.length; i++) {
    if (movingSet.has(i)) continue;
    const bb = getBBox(allStrokes[i]);
    if (!bb) continue;
    const ocx = bb.x + bb.w / 2, ocy = bb.y + bb.h / 2;

    for (const [mv, ov] of [[mx1, bb.x], [mx2, bb.x + bb.w], [mcx, ocx]]) {
      const d = ov - mv;
      if (Math.abs(d) < threshold && Math.abs(d) < Math.abs(bestDx)) bestDx = d;
    }
    for (const [mv, ov] of [[my1, bb.y], [my2, bb.y + bb.h], [mcy, ocy]]) {
      const d = ov - mv;
      if (Math.abs(d) < threshold && Math.abs(d) < Math.abs(bestDy)) bestDy = d;
    }
  }

  if (Math.abs(bestDx) < threshold) {
    snapDx = bestDx;
    const snapVal = mcx + bestDx;
    guides.push({ axis: 'x', pos: snapVal });
  }
  if (Math.abs(bestDy) < threshold) {
    snapDy = bestDy;
    const snapVal = mcy + bestDy;
    guides.push({ axis: 'y', pos: snapVal });
  }
  return { guides, snapDx, snapDy };
}

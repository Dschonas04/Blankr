/* ═══════════════════════════════════════
   Canvas — Geometry Helpers
   Pure functions, no side-effects.
   ═══════════════════════════════════════ */

/**
 * Shortest distance from point (px,py) to segment (x1,y1)→(x2,y2).
 */
export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Rotate (px,py) around (cx,cy) by angle (radians).
 */
export function rotatePoint(px, py, cx, cy, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Axis-aligned bounding box for any stroke type.
 * Returns {x, y, w, h} or null.
 */
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
        x: Math.min(s.x1, s.x2) - pad,
        y: Math.min(s.y1, s.y2) - pad,
        w: Math.abs(s.x2 - s.x1) + pad * 2,
        h: Math.abs(s.y2 - s.y1) + pad * 2,
      };
    }
    case 'rect': case 'circle': {
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

/**
 * Center of a stroke's bounding box.
 */
export function getCenter(s) {
  const bb = getBBox(s);
  if (!bb) return { cx: 0, cy: 0 };
  return { cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2 };
}

/**
 * Four anchor points (top/right/bottom/left) for connector snapping.
 */
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

/**
 * Move a stroke by (dx, dy). Returns a new stroke object.
 */
export function moveStroke(s, dx, dy) {
  const m = { ...s };
  switch (s.type) {
    case 'pen': case 'eraser':
      m.points = s.points.map(p => ({ x: p.x + dx, y: p.y + dy })); break;
    case 'line': case 'arrow': case 'rect': case 'circle': case 'connector':
      m.x1 = s.x1 + dx; m.y1 = s.y1 + dy;
      m.x2 = s.x2 + dx; m.y2 = s.y2 + dy; break;
    case 'text': case 'image':
      m.x = s.x + dx; m.y = s.y + dy; break;
  }
  return m;
}

/**
 * Scale/resize a stroke from a bounding-box corner handle.
 * handle is one of: 'tl','tr','bl','br'.
 */
export function resizeStroke(s, handle, dx, dy, origBB) {
  const m = { ...s };
  let sx = 1, sy = 1, ox = origBB.x, oy = origBB.y;

  if (handle === 'tl') { sx = (origBB.w - dx) / origBB.w; sy = (origBB.h - dy) / origBB.h; ox = origBB.x + origBB.w; oy = origBB.y + origBB.h; }
  else if (handle === 'tr') { sx = (origBB.w + dx) / origBB.w; sy = (origBB.h - dy) / origBB.h; ox = origBB.x; oy = origBB.y + origBB.h; }
  else if (handle === 'bl') { sx = (origBB.w - dx) / origBB.w; sy = (origBB.h + dy) / origBB.h; ox = origBB.x + origBB.w; oy = origBB.y; }
  else if (handle === 'br') { sx = (origBB.w + dx) / origBB.w; sy = (origBB.h + dy) / origBB.h; ox = origBB.x; oy = origBB.y; }

  if (Math.abs(sx) < 0.05) sx = 0.05;
  if (Math.abs(sy) < 0.05) sy = 0.05;

  function scaleP(px, py) {
    return { x: ox + (px - ox) * sx, y: oy + (py - oy) * sy };
  }

  switch (s.type) {
    case 'pen': case 'eraser':
      m.points = s.points.map(p => scaleP(p.x, p.y)); break;
    case 'rect': case 'circle': {
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

/**
 * Move a single endpoint of a line-like stroke.
 * endpoint is 'p1' or 'p2'. Returns a new stroke.
 */
export function moveEndpoint(s, endpoint, wx, wy) {
  const m = { ...s };
  if (endpoint === 'p1') { m.x1 = wx; m.y1 = wy; }
  else if (endpoint === 'p2') { m.x2 = wx; m.y2 = wy; }
  return m;
}

/**
 * Is a stroke type "line-like"? (has x1,y1,x2,y2 and uses endpoint handles)
 */
export function isLineLike(type) {
  return type === 'line' || type === 'arrow' || type === 'connector';
}

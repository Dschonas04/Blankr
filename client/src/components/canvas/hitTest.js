/* ═══════════════════════════════════════
   Canvas — Hit Testing
   Determines what's under the cursor.
   ═══════════════════════════════════════ */

import { HANDLE_SIZE, ROTATE_HANDLE_DIST, ENDPOINT_HIT_RADIUS } from './constants.js';
import { distToSegment, rotatePoint, getBBox, getCenter, isLineLike } from './geometry.js';

/**
 * Test if world-coord (wx,wy) hits stroke s.
 */
export function hitTest(s, wx, wy) {
  let tx = wx, ty = wy;
  if (s.rotation) {
    const { cx, cy } = getCenter(s);
    const p = rotatePoint(wx, wy, cx, cy, -s.rotation);
    tx = p.x; ty = p.y;
  }

  const tolerance = (s.width || 3) / 2 + 6;

  switch (s.type) {
    case 'pen': case 'eraser': {
      if (!s.points || s.points.length < 2) return false;
      for (let i = 1; i < s.points.length; i++) {
        if (distToSegment(tx, ty, s.points[i - 1].x, s.points[i - 1].y, s.points[i].x, s.points[i].y) < tolerance)
          return true;
      }
      return false;
    }
    case 'line': case 'arrow':
      return distToSegment(tx, ty, s.x1, s.y1, s.x2, s.y2) < tolerance;
    case 'connector':
      return distToSegment(tx, ty, s.x1, s.y1, s.x2, s.y2) < tolerance + 4;
    case 'rect': {
      const x1 = Math.min(s.x1, s.x2), y1 = Math.min(s.y1, s.y2);
      const x2 = Math.max(s.x1, s.x2), y2 = Math.max(s.y1, s.y2);
      if (s.filled) return tx >= x1 && tx <= x2 && ty >= y1 && ty <= y2;
      return (
        distToSegment(tx, ty, x1, y1, x2, y1) < tolerance ||
        distToSegment(tx, ty, x2, y1, x2, y2) < tolerance ||
        distToSegment(tx, ty, x2, y2, x1, y2) < tolerance ||
        distToSegment(tx, ty, x1, y2, x1, y1) < tolerance
      );
    }
    case 'circle': {
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
      const rx = Math.abs(s.x2 - s.x1) / 2, ry = Math.abs(s.y2 - s.y1) / 2;
      if (rx === 0 || ry === 0) return false;
      const norm = ((tx - cx) / rx) ** 2 + ((ty - cy) / ry) ** 2;
      return s.filled ? norm <= 1.15 : Math.abs(norm - 1) < 0.3;
    }
    case 'text': case 'image': {
      const bb = getBBox(s);
      return bb && tx >= bb.x && tx <= bb.x + bb.w && ty >= bb.y && ty <= bb.y + bb.h;
    }
    default:
      return false;
  }
}

/**
 * Determine which handle is hit on a selected stroke.
 *
 * For line-like strokes (line, arrow, connector):
 *   returns 'p1' | 'p2' | 'rotate' | null
 *   (endpoint handles + rotation)
 *
 * For shapes (rect, circle, pen, text, image):
 *   returns 'tl' | 'tr' | 'bl' | 'br' | 'rotate' | null
 *   (corner resize handles + rotation)
 */
export function hitHandle(s, wx, wy, viewScale) {
  const bb = getBBox(s);
  if (!bb) return null;

  // Un-rotate the test point
  let tx = wx, ty = wy;
  if (s.rotation) {
    const { cx, cy } = getCenter(s);
    const p = rotatePoint(wx, wy, cx, cy, -s.rotation);
    tx = p.x; ty = p.y;
  }

  /* ── Line-like strokes: endpoint handles ── */
  if (isLineLike(s.type)) {
    const hr = ENDPOINT_HIT_RADIUS / viewScale;
    if (Math.hypot(tx - s.x1, ty - s.y1) < hr) return 'p1';
    if (Math.hypot(tx - s.x2, ty - s.y2) < hr) return 'p2';

    // Rotation handle (above midpoint)
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    const rotDist = ROTATE_HANDLE_DIST / viewScale;
    // perpendicular direction pointing "up"
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const rotX = mx + (-dy / len) * rotDist;
    const rotY = my + (dx / len) * rotDist;
    if (Math.hypot(tx - rotX, ty - rotY) < hr) return 'rotate';

    return null;
  }

  /* ── Shape strokes: corner resize handles ── */
  const hs = (HANDLE_SIZE + 4) / viewScale;
  const corners = {
    tl: [bb.x, bb.y],
    tr: [bb.x + bb.w, bb.y],
    bl: [bb.x, bb.y + bb.h],
    br: [bb.x + bb.w, bb.y + bb.h],
  };
  for (const [id, [cx, cy]] of Object.entries(corners)) {
    if (Math.abs(tx - cx) < hs && Math.abs(ty - cy) < hs) return id;
  }

  // Rotation handle (above top center)
  const rotX = bb.x + bb.w / 2;
  const rotY = bb.y - ROTATE_HANDLE_DIST / viewScale;
  if (Math.abs(tx - rotX) < hs * 1.5 && Math.abs(ty - rotY) < hs * 1.5) return 'rotate';

  return null;
}

/**
 * Get the cursor CSS for a given handle id.
 */
export function handleCursor(handle) {
  if (!handle) return null;
  if (handle === 'rotate') return 'crosshair';
  if (handle === 'p1' || handle === 'p2') return 'pointer';
  if (handle === 'tl' || handle === 'br') return 'nwse-resize';
  if (handle === 'tr' || handle === 'bl') return 'nesw-resize';
  return null;
}

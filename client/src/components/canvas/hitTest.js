// Canvas - Hit Testing

import { HANDLE_SIZE, ROTATE_HANDLE_DIST, ENDPOINT_HIT_RADIUS } from './constants.js';
import { distToSegment, rotatePoint, getBBox, isLineLike, isPolygonShape, getShapeVertices, pointInPolygon, distToPolygon } from './geometry.js';

/**
 * Find the top-most stroke under (wx, wy) in world coords.
 * Returns index or -1.
 */
export function hitTest(strokes, wx, wy) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (!s) continue;
    const tol = (s.width || 3) / 2 + 4;

    // For rotated shapes, transform the test point into unrotated space
    let tx = wx, ty = wy;
    if (s.rotation) {
      const bb = getBBox(s);
      if (bb) {
        const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
        const rp = rotatePoint(wx, wy, cx, cy, -s.rotation);
        tx = rp.x; ty = rp.y;
      }
    }

    switch (s.type) {
      case 'pen': case 'eraser': {
        if (!s.points) continue;
        for (let j = 1; j < s.points.length; j++) {
          if (distToSegment(tx, ty, s.points[j-1].x, s.points[j-1].y, s.points[j].x, s.points[j].y) < tol) return i;
        }
        break;
      }
      case 'line': case 'arrow': case 'connector':
        if (distToSegment(tx, ty, s.x1, s.y1, s.x2, s.y2) < tol) return i;
        break;
      case 'rect': case 'frame': {
        const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
        const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
        if (s.filled) {
          if (tx >= x && tx <= x + w && ty >= y && ty <= y + h) return i;
        } else {
          if (distToSegment(tx, ty, x, y, x + w, y) < tol ||
              distToSegment(tx, ty, x + w, y, x + w, y + h) < tol ||
              distToSegment(tx, ty, x + w, y + h, x, y + h) < tol ||
              distToSegment(tx, ty, x, y + h, x, y) < tol) return i;
        }
        break;
      }
      case 'circle': {
        const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
        const rx = Math.abs(s.x2 - s.x1) / 2, ry = Math.abs(s.y2 - s.y1) / 2;
        if (rx < 1 || ry < 1) continue;
        const norm = ((tx - cx) / rx) ** 2 + ((ty - cy) / ry) ** 2;
        if (s.filled ? norm <= 1.15 : Math.abs(norm - 1) < (tol / Math.min(rx, ry)) + 0.15) return i;
        break;
      }
      case 'triangle': case 'diamond': case 'star': case 'hexagon': {
        const verts = getShapeVertices(s.type, s.x1, s.y1, s.x2, s.y2);
        if (s.filled) {
          if (pointInPolygon(tx, ty, verts)) return i;
        } else {
          if (distToPolygon(tx, ty, verts) < tol) return i;
        }
        break;
      }
      case 'text': {
        const fs = s.fontSize || 16;
        const textW = Math.max(60, (s.text || '').length * fs * 0.6);
        const lines = (s.text || '').split('\n').length;
        const textH = lines * fs * 1.3;
        if (tx >= s.x && tx <= s.x + textW && ty >= s.y - fs && ty <= s.y - fs + textH) return i;
        break;
      }
      case 'image': {
        const w = s.w || 100, h = s.h || 100;
        if (tx >= s.x && tx <= s.x + w && ty >= s.y && ty <= s.y + h) return i;
        break;
      }
    }
  }
  return -1;
}

/**
 * Determine if (sx, sy) in screen coords is on a resize/rotate/endpoint handle
 * for the stroke at the given index. Returns handle name or null.
 */
export function hitHandle(strokes, idx, sx, sy, view) {
  if (idx < 0 || idx >= strokes.length) return null;
  const s = strokes[idx];
  if (!s) return null;
  const bb = getBBox(s);
  if (!bb) return null;

  const toScreen = (x, y) => {
    let rx = x, ry = y;
    if (s.rotation) {
      const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
      const rp = rotatePoint(x, y, cx, cy, s.rotation);
      rx = rp.x; ry = rp.y;
    }
    return { x: (rx + view.x) * view.scale, y: (ry + view.y) * view.scale };
  };

  // Endpoint handles for line-like strokes
  if (isLineLike(s.type)) {
    const p1 = toScreen(s.x1, s.y1);
    const p2 = toScreen(s.x2, s.y2);
    if (Math.hypot(sx - p1.x, sy - p1.y) < ENDPOINT_HIT_RADIUS) return 'p1';
    if (Math.hypot(sx - p2.x, sy - p2.y) < ENDPOINT_HIT_RADIUS) return 'p2';
    return null;
  }

  const hs = HANDLE_SIZE + 2;
  const corners = [
    { name: 'tl', x: bb.x, y: bb.y },
    { name: 'tr', x: bb.x + bb.w, y: bb.y },
    { name: 'bl', x: bb.x, y: bb.y + bb.h },
    { name: 'br', x: bb.x + bb.w, y: bb.y + bb.h },
  ];
  for (const c of corners) {
    const sp = toScreen(c.x, c.y);
    if (Math.abs(sx - sp.x) < hs && Math.abs(sy - sp.y) < hs) return c.name;
  }

  // Rotate handle (above top center)
  const tcx = bb.x + bb.w / 2, tcy = bb.y - ROTATE_HANDLE_DIST;
  const rotSp = toScreen(tcx, tcy);
  if (Math.hypot(sx - rotSp.x, sy - rotSp.y) < hs + 3) return 'rotate';

  return null;
}

/** CSS cursor for a given handle name */
export function handleCursor(h) {
  switch (h) {
    case 'tl': case 'br': return 'nwse-resize';
    case 'tr': case 'bl': return 'nesw-resize';
    case 'rotate': return 'grab';
    case 'p1': case 'p2': return 'crosshair';
    default: return 'default';
  }
}

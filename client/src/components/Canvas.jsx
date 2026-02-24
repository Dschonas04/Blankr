import { useRef, useEffect, useState } from 'react';
import { getState, setState, subscribe, pushUndo, scheduleAutosave, showToast } from '../store';
import * as collab from '../collab';

const BG_SPACING = 24;
const LASER_FADE_MS = 800;

export default function Canvas() {
  const canvasRef = useRef(null);
  const [textEdit, setTextEdit] = useState(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    const ctx = cvs.getContext('2d');
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d');
    const imgCache = new Map();

    let drawing = false, currentStroke = null;
    let panning = false, panSX = 0, panSY = 0, panVX = 0, panVY = 0;
    let spaceDown = false;
    let laserTrails = [];
    let needsRender = true;
    let pinchActive = false, pinchD0 = 0, pinchS0 = 1;

    /* ── Resize ── */
    function resize() {
      cvs.width = window.innerWidth;
      cvs.height = window.innerHeight;
      off.width = cvs.width;
      off.height = cvs.height;
      needsRender = true;
    }

    /* ── Coords ── */
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

    function setCursor() {
      const t = getState().tool;
      const map = {
        pen: 'crosshair', line: 'crosshair', arrow: 'crosshair',
        rect: 'crosshair', circle: 'crosshair', text: 'text',
        eraser: 'cell', laser: 'none', hand: 'grab',
      };
      cvs.style.cursor = spaceDown ? 'grab' : (map[t] || 'crosshair');
    }

    /* ── Background ── */
    function drawBackground() {
      const { bgPattern, darkMode, view } = getState();
      ctx.fillStyle = darkMode ? '#18181f' : '#ffffff';
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      if (bgPattern === 'none') return;

      const sp = BG_SPACING * view.scale;
      const oX = view.x % sp, oY = view.y % sp;
      const col = darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.07)';

      ctx.save();
      if (bgPattern === 'dots') {
        ctx.fillStyle = col;
        for (let x = oX; x < cvs.width; x += sp)
          for (let y = oY; y < cvs.height; y += sp) {
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.8, view.scale * 0.8), 0, Math.PI * 2);
            ctx.fill();
          }
      } else if (bgPattern === 'grid') {
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = oX; x < cvs.width; x += sp) { ctx.moveTo(x, 0); ctx.lineTo(x, cvs.height); }
        for (let y = oY; y < cvs.height; y += sp) { ctx.moveTo(0, y); ctx.lineTo(cvs.width, y); }
        ctx.stroke();
      } else if (bgPattern === 'lines') {
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
        for (let y = oY; y < cvs.height; y += sp) { ctx.moveTo(0, y); ctx.lineTo(cvs.width, y); }
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ── Stroke rendering ── */
    function renderStroke(c, s) {
      c.save();
      c.lineWidth = s.width || 3;
      c.strokeStyle = s.color || '#1e1e1e';
      c.fillStyle = s.color || '#1e1e1e';
      c.globalAlpha = s.opacity ?? 1;
      c.lineCap = 'round';
      c.lineJoin = 'round';

      if (s.type === 'eraser') {
        c.globalCompositeOperation = 'destination-out';
        c.strokeStyle = 'rgba(0,0,0,1)';
      }

      switch (s.type) {
        case 'pen':
        case 'eraser':
          if (!s.points || s.points.length < 2) break;
          c.beginPath(); c.moveTo(s.points[0].x, s.points[0].y);
          for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y);
          c.stroke(); break;
        case 'line':
          c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke(); break;
        case 'arrow': {
          c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
          const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
          const h = Math.max(10, s.width * 4);
          c.beginPath(); c.moveTo(s.x2, s.y2);
          c.lineTo(s.x2 - h * Math.cos(a - Math.PI / 7), s.y2 - h * Math.sin(a - Math.PI / 7));
          c.lineTo(s.x2 - h * Math.cos(a + Math.PI / 7), s.y2 - h * Math.sin(a + Math.PI / 7));
          c.closePath(); c.fill(); break;
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
        case 'text':
          c.font = `${s.fontSize || 16}px 'Inter',sans-serif`;
          c.globalCompositeOperation = 'source-over';
          (s.text || '').split('\n').forEach((l, i) =>
            c.fillText(l, s.x, s.y + i * (s.fontSize || 16) * 1.3)
          );
          break;
        case 'image': {
          const img = getImage(s.data);
          if (img) c.drawImage(img, s.x, s.y, s.w, s.h);
          break;
        }
      }
      c.globalCompositeOperation = 'source-over';
      c.restore();
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

    /* ── Main render ── */
    function render() {
      const { view, layers } = getState();
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      drawBackground();

      for (const layer of layers) {
        if (!layer.visible) continue;
        offCtx.clearRect(0, 0, off.width, off.height);
        offCtx.save();
        offCtx.translate(view.x, view.y);
        offCtx.scale(view.scale, view.scale);
        for (const s of layer.strokes) renderStroke(offCtx, s);
        offCtx.restore();
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(off, 0, 0);
        ctx.globalAlpha = 1;
      }

      if (currentStroke) {
        ctx.save();
        ctx.translate(view.x, view.y);
        ctx.scale(view.scale, view.scale);
        renderStroke(ctx, currentStroke);
        ctx.restore();
      }

      /* Laser */
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
    }

    /* ── Event handlers ── */
    function onDown(e) {
      if (e.target !== cvs) return;
      const { sx, sy } = ptrPos(e);
      const { x, y } = screenToWorld(sx, sy);
      const st = getState();

      if (e.button === 1 || spaceDown || st.tool === 'hand') {
        panning = true; panSX = sx; panSY = sy;
        panVX = st.view.x; panVY = st.view.y;
        cvs.style.cursor = 'grabbing';
        e.preventDefault(); return;
      }

      if (st.tool === 'text') { setTextEdit({ sx, sy, wx: x, wy: y }); return; }

      if (st.tool === 'laser') {
        drawing = true;
        laserTrails.push({ x, y, time: Date.now() });
        e.preventDefault(); return;
      }

      e.preventDefault();
      drawing = true;
      pushUndo();
      const base = { color: st.color, width: st.lineWidth, opacity: st.opacity, filled: st.filled };

      switch (st.tool) {
        case 'pen': case 'eraser':
          currentStroke = { type: st.tool, points: [{ x, y }], ...base }; break;
        case 'line': currentStroke = { type: 'line', x1: x, y1: y, x2: x, y2: y, ...base }; break;
        case 'arrow': currentStroke = { type: 'arrow', x1: x, y1: y, x2: x, y2: y, ...base }; break;
        case 'rect': currentStroke = { type: 'rect', x1: x, y1: y, x2: x, y2: y, ...base }; break;
        case 'circle': currentStroke = { type: 'circle', x1: x, y1: y, x2: x, y2: y, ...base }; break;
      }
      needsRender = true;
    }

    function onMove(e) {
      const { sx, sy } = ptrPos(e);
      const { x, y } = screenToWorld(sx, sy);

      if (collab.isConnected()) collab.send({ type: 'cursor', x: sx, y: sy });

      if (panning) {
        setState({
          view: { ...getState().view, x: panVX + (sx - panSX), y: panVY + (sy - panSY) },
        });
        needsRender = true; return;
      }

      if (!drawing) return;
      e.preventDefault();

      if (getState().tool === 'laser') {
        laserTrails.push({ x, y, time: Date.now() });
        needsRender = true; return;
      }

      if (!currentStroke) return;
      switch (currentStroke.type) {
        case 'pen': case 'eraser': currentStroke.points.push({ x, y }); break;
        default: currentStroke.x2 = x; currentStroke.y2 = y;
      }
      needsRender = true;
    }

    function onUp() {
      if (panning) { panning = false; setCursor(); return; }
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

    /* Wheel zoom */
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

    /* Touch */
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
        const newScale = Math.min(5, Math.max(0.1, pinchS0 * (d / pinchD0)));
        setState(s => ({ view: { ...s.view, scale: newScale } }));
        needsRender = true;
        return;
      }
      onMove(e);
    }

    function onTouchEnd() { pinchActive = false; onUp(); }

    /* Drag & Drop images */
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
              ? { ...l, strokes: [...l.strokes, { type: 'image', x, y, w: img.width * scale, h: img.height * scale, data: ev.target.result, opacity: 1 }] }
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

    /* Space bar for pan */
    function onKeyDown(e) {
      if (e.code === 'Space' && !spaceDown && !['TEXTAREA', 'INPUT'].includes(e.target.tagName) && !e.target.isContentEditable) {
        spaceDown = true; setCursor(); e.preventDefault();
      }
    }
    function onKeyUp(e) {
      if (e.code === 'Space') { spaceDown = false; setCursor(); }
    }

    /* ── Subscribe + setup ── */
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

    return () => {
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
      cvs.removeEventListener('dragover', onDragOver);
      cvs.removeEventListener('drop', onDrop);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  /* ── Text tool ── */
  function commitText(text) {
    if (textEdit && text.trim()) {
      pushUndo();
      const st = getState();
      const layers = st.layers.map((l, i) =>
        i === st.activeLayer
          ? { ...l, strokes: [...l.strokes, { type: 'text', x: textEdit.wx, y: textEdit.wy, text: text.trim(), color: st.color, fontSize: 16, opacity: st.opacity }] }
          : l
      );
      setState({ layers });
      scheduleAutosave();
    }
    setTextEdit(null);
  }

  return (
    <>
      <canvas id="whiteboard" ref={canvasRef} />
      {textEdit && (
        <textarea
          className="text-input"
          style={{ left: textEdit.sx, top: textEdit.sy }}
          autoFocus
          placeholder="Text eingeben…"
          onBlur={e => commitText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setTextEdit(null);
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(e.target.value); }
          }}
        />
      )}
    </>
  );
}

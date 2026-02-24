(() => {
  "use strict";

  /* ── DOM refs ── */
  const canvas = document.getElementById("whiteboard");
  const ctx = canvas.getContext("2d");

  const btnPen = document.getElementById("btn-pen");
  const btnEraser = document.getElementById("btn-eraser");
  const colorPicker = document.getElementById("color-picker");
  const sizeSlider = document.getElementById("size-slider");
  const sizeValue = document.getElementById("size-value");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnClear = document.getElementById("btn-clear");
  const btnDownload = document.getElementById("btn-download");

  /* ── State ── */
  let drawing = false;
  let tool = "pen"; // "pen" | "eraser"
  let color = colorPicker.value;
  let lineWidth = parseInt(sizeSlider.value, 10);

  let undoStack = [];
  let redoStack = [];

  /* ── Canvas sizing ── */
  function resizeCanvas() {
    // Save current image
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 52; // toolbar height

    // Restore image
    ctx.putImageData(img, 0, 0);

    // Reset context properties (they get cleared on resize)
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  /* ── History helpers ── */
  function saveState() {
    undoStack.push(canvas.toDataURL());
    // New action clears the redo stack
    redoStack = [];
  }

  function restoreState(dataURL) {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataURL;
  }

  /* ── Drawing ── */
  function getPos(e) {
    if (e.touches) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return { x: e.offsetX, y: e.offsetY };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    saveState();
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e) {
    if (!drawing) return;
    e.preventDefault();

    const pos = getPos(e);

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";

    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stopDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    ctx.closePath();
    ctx.globalCompositeOperation = "source-over";
  }

  // Mouse events
  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDraw);
  canvas.addEventListener("mouseleave", stopDraw);

  // Touch events
  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDraw);

  /* ── Tool selection ── */
  btnPen.addEventListener("click", () => {
    tool = "pen";
    btnPen.classList.add("active");
    btnEraser.classList.remove("active");
    canvas.style.cursor = "crosshair";
  });

  btnEraser.addEventListener("click", () => {
    tool = "eraser";
    btnEraser.classList.add("active");
    btnPen.classList.remove("active");
    canvas.style.cursor = "cell";
  });

  /* ── Color & size ── */
  colorPicker.addEventListener("input", (e) => {
    color = e.target.value;
    // Switch back to pen when picking a color
    tool = "pen";
    btnPen.classList.add("active");
    btnEraser.classList.remove("active");
  });

  sizeSlider.addEventListener("input", (e) => {
    lineWidth = parseInt(e.target.value, 10);
    sizeValue.textContent = lineWidth;
  });

  /* ── Undo / Redo ── */
  btnUndo.addEventListener("click", () => {
    if (undoStack.length === 0) return;
    redoStack.push(canvas.toDataURL());
    const prev = undoStack.pop();
    restoreState(prev);
  });

  btnRedo.addEventListener("click", () => {
    if (redoStack.length === 0) return;
    undoStack.push(canvas.toDataURL());
    const next = redoStack.pop();
    restoreState(next);
  });

  /* ── Clear ── */
  btnClear.addEventListener("click", () => {
    saveState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  /* ── Download ── */
  btnDownload.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "blankr-whiteboard.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  /* ── Keyboard shortcuts ── */
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        btnRedo.click();
      } else {
        btnUndo.click();
      }
    }
  });
})();

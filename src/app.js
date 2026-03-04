(() => {
  "use strict";

  /* ── Users & Roles ── */
  const USERS = [
    { username: "admin",  password: "admin123",  role: "admin"  },
    { username: "editor", password: "editor123", role: "editor" },
    { username: "viewer", password: "viewer123", role: "viewer" },
  ];

  const ROLE_PERMISSIONS = {
    admin:  { draw: true, tools: true, exportImport: true },
    editor: { draw: true, tools: true, exportImport: true },
    viewer: { draw: false, tools: false, exportImport: false },
  };

  /* ── Auth helpers ── */
  function sanitize(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  function authenticate(username, password) {
    const clean = sanitize(username.trim());
    return USERS.find(
      (u) => u.username === clean && u.password === password
    ) || null;
  }

  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem("blankr_session"));
    } catch (_) {
      return null;
    }
  }

  function setSession(user) {
    sessionStorage.setItem(
      "blankr_session",
      JSON.stringify({ username: user.username, role: user.role })
    );
  }

  function clearSession() {
    sessionStorage.removeItem("blankr_session");
  }

  /* ── Login Screen ── */
  const loginScreen = document.getElementById("login-screen");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const appEl = document.getElementById("app");

  function showApp(session) {
    loginScreen.hidden = true;
    appEl.hidden = false;
    initApp(session);
  }

  // Auto-login if session exists
  const existingSession = getSession();
  if (existingSession) {
    showApp(existingSession);
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = document.getElementById("login-user").value;
    const password = document.getElementById("login-pass").value;
    const user = authenticate(username, password);
    if (user) {
      loginError.hidden = true;
      setSession(user);
      showApp({ username: user.username, role: user.role });
    } else {
      loginError.hidden = false;
    }
  });

  /* ── Main App ── */
  function initApp(session) {
    const perms = ROLE_PERMISSIONS[session.role] || ROLE_PERMISSIONS.viewer;

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
    const btnExport = document.getElementById("btn-export");
    const btnImport = document.getElementById("btn-import");
    const importFile = document.getElementById("import-file");
    const btnLogout = document.getElementById("btn-logout");
    const roleBadge = document.getElementById("role-badge");

    /* ── Role badge ── */
    roleBadge.textContent = session.role.charAt(0).toUpperCase() + session.role.slice(1);
    roleBadge.classList.add(session.role);

    /* ── Apply role permissions ── */
    if (!perms.draw) {
      canvas.style.cursor = "default";
    }

    if (!perms.tools) {
      [btnPen, btnEraser, colorPicker, sizeSlider, btnUndo, btnRedo, btnClear, btnDownload].forEach((el) => {
        el.disabled = true;
      });
    }

    if (!perms.exportImport) {
      btnExport.disabled = true;
      btnImport.disabled = true;
    }

    /* ── State ── */
    let drawing = false;
    let tool = "pen"; // "pen" | "eraser"
    let color = colorPicker.value;
    let lineWidth = parseInt(sizeSlider.value, 10);

    let undoStack = [];
    let redoStack = [];

    /* ── Canvas sizing ── */
    function resizeCanvas() {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight - 52;

      ctx.putImageData(img, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    /* ── History helpers ── */
    function saveState() {
      undoStack.push(canvas.toDataURL());
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
      if (!perms.draw) return;
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

    /* ── Download (PNG) ── */
    btnDownload.addEventListener("click", () => {
      const link = document.createElement("a");
      link.download = "blankr-whiteboard.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    });

    /* ── Export (JSON) ── */
    btnExport.addEventListener("click", () => {
      const data = {
        version: 1,
        width: canvas.width,
        height: canvas.height,
        image: canvas.toDataURL("image/png"),
        exportedAt: new Date().toISOString(),
        exportedBy: session.username,
      };
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const link = document.createElement("a");
      link.download = "blankr-export.json";
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    });

    /* ── Import (JSON) ── */
    btnImport.addEventListener("click", () => {
      importFile.click();
    });

    importFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!data.image || typeof data.image !== "string" || !data.image.startsWith("data:image/")) {
            throw new Error("Invalid format");
          }
          saveState();
          restoreState(data.image);
        } catch (_) {
          alert("Ungültige Datei. Bitte eine gültige Blankr-JSON-Datei auswählen.");
        }
      };
      reader.readAsText(file);
      importFile.value = "";
    });

    /* ── Logout ── */
    btnLogout.addEventListener("click", () => {
      clearSession();
      location.reload();
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
  }
})();

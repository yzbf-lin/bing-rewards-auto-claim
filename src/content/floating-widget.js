// Shared by the extension and copied into the standalone userscript.
function createRewardsFloatingWidget({ hostId, loadPosition = () => null, savePosition = () => {} }) {
  const SIZE = 56;
  const MARGIN = 12;
  const host = document.createElement("div");
  host.id = hostId;
  Object.assign(host.style, {
    all: "initial", position: "fixed", zIndex: "2147483647", display: "block",
    font: '13px/1.45 "Segoe UI", "PingFang SC", sans-serif', colorScheme: "light",
  });
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { color-scheme: light; font: 13px/1.45 "Segoe UI", "PingFang SC", sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    button { font: inherit; -webkit-tap-highlight-color: transparent; }
    .rw-launcher {
      position: absolute; top: 0; left: 0; width: 56px; height: 56px; display: flex;
      align-items: center; padding: 0; border: 1px solid rgba(255,255,255,.78);
      border-radius: 999px; color: #333367; cursor: grab; touch-action: none; user-select: none;
      background: linear-gradient(135deg,rgba(255,255,255,.8),rgba(232,239,255,.32));
      backdrop-filter: blur(18px) saturate(180%); -webkit-backdrop-filter: blur(18px) saturate(180%);
      box-shadow: inset 0 1px 2px #fff, inset 0 -6px 14px rgba(116,98,230,.12),
        0 7px 24px rgba(87,75,164,.2), 0 0 24px rgba(139,124,255,.16);
      overflow: hidden; isolation: isolate;
      transition: width .42s cubic-bezier(.22,1,.36,1), box-shadow .3s, opacity .16s, transform .25s;
    }
    :host([data-side="right"]) .rw-launcher { left: auto; right: 0; }
    .rw-launcher::before {
      content: ""; position: absolute; z-index: -2; inset: -40%; opacity: .72; filter: blur(9px);
      background: conic-gradient(from 0deg,transparent 0deg,#ab9cff 70deg,#cdfcff 130deg,
        transparent 180deg,#f2bcff 245deg,#88e2ff 300deg,transparent 360deg);
      animation: rw-flow 7s linear infinite;
    }
    .rw-launcher::after {
      content: ""; position: absolute; z-index: -1; inset: 1px; border-radius: inherit;
      background: radial-gradient(ellipse at 28% 15%,rgba(255,255,255,.97),rgba(255,255,255,.05) 53%),
        linear-gradient(150deg,rgba(255,255,255,.22),rgba(204,226,255,.18) 65%,rgba(255,255,255,.58));
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.35);
    }
    .rw-spark { flex: 0 0 24px; width: 24px; height: 24px; margin: 0 12px 0 15px;
      filter: drop-shadow(0 0 6px rgba(130,97,255,.38)); animation: rw-shimmer 4s ease-in-out infinite; }
    .rw-label { opacity: 0; white-space: nowrap; text-align: left; transform: translateX(-5px);
      transition: opacity .2s, transform .35s; pointer-events: none; }
    .rw-label strong { display: block; font-size: 12px; font-weight: 650; letter-spacing: .04em; }
    .rw-label small { display: block; margin-top: 1px; font-size: 10px; color: #6c6c96; }
    @media (hover: hover) {
      :host(:not([data-dragging="true"])) .rw-launcher:hover { width: var(--rw-hover-width,156px);
        box-shadow: inset 0 1px 2px #fff,0 10px 30px rgba(92,76,185,.23),0 0 30px rgba(131,196,255,.22); }
      :host(:not([data-dragging="true"])) .rw-launcher:hover .rw-label { opacity: 1; transform: none; }
    }
    .rw-launcher:focus-visible { width: var(--rw-hover-width,156px); outline: 2px solid #8976ed; outline-offset: 4px; }
    .rw-launcher:focus-visible .rw-label { opacity: 1; transform: none; }
    :host([data-running="true"]) .rw-launcher::before { animation-duration: 3s; opacity: .95; }
    :host([data-dragging="true"]) .rw-launcher, :host([data-dragging="true"]) .rw-grip { cursor: grabbing; }
    :host([data-dragging="true"]) .rw-launcher { transition: none; }
    .rw-panel {
      position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
      border: 1px solid rgba(255,255,255,.88); border-radius: 22px;
      background: rgba(248,250,255,.86); backdrop-filter: blur(24px) saturate(140%);
      -webkit-backdrop-filter: blur(24px) saturate(140%);
      box-shadow: 0 22px 70px rgba(31,34,76,.19),0 2px 9px rgba(62,56,108,.1),inset 0 1px 0 #fff;
      opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-5px) scale(.94);
      transform-origin: top left; transition: opacity .2s, transform .3s cubic-bezier(.22,1,.36,1),visibility .2s;
    }
    :host([data-side="right"]) .rw-panel { transform-origin: top right; }
    :host([data-open="true"]) .rw-panel { opacity: 1; visibility: visible; pointer-events: auto; transform: none; }
    :host([data-open="true"]) .rw-launcher { opacity: 0; visibility: hidden; pointer-events: none; transform: scale(.8); }
    .rw-bar { display: flex; align-items: center; flex: 0 0 48px; gap: 8px; padding: 0 10px 0 16px;
      border-bottom: 1px solid rgba(126,122,169,.12); background: linear-gradient(100deg,rgba(237,231,255,.6),rgba(224,247,255,.5)); }
    .rw-grip { display: flex; align-items: center; align-self: stretch; flex: 1; min-width: 0; gap: 9px;
      color: #57527e; cursor: grab; touch-action: none; user-select: none; }
    .rw-grip svg { flex: 0 0 14px; opacity: .55; }
    .rw-grip strong { font-size: 11px; font-weight: 650; letter-spacing: .12em; }
    .rw-grip span { margin-left: auto; color: #89869f; font-size: 10px; }
    .rw-close { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px;
      border: 1px solid rgba(133,123,171,.12); border-radius: 50%; background: rgba(255,255,255,.6);
      color: #78718e; cursor: pointer; transition: background .2s,color .2s; }
    .rw-close:hover { background: #fff; color: #514680; }
    .rw-close:focus-visible { outline: 2px solid #8976ed; outline-offset: 2px; }
    .rw-content { flex: 1; min-height: 0; overflow: auto; }
    .rw-content > iframe { display: block; width: 100%; height: 100%; border: 0; background: #f5f7fa; }
    @keyframes rw-flow { to { transform: rotate(360deg); } }
    @keyframes rw-shimmer { 50% { opacity: .78; filter: drop-shadow(0 0 9px rgba(130,97,255,.6)); } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  </style>
  <button class="rw-launcher" type="button" aria-label="展开积分面板，可拖动调整位置" aria-expanded="false" aria-controls="rw-panel" title="拖动移动位置 · 点击展开">
    <svg class="rw-spark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M11 2.5c.9 5.6 2.9 7.6 8.5 8.5-5.6.9-7.6 2.9-8.5 8.5C10.1 13.9 8.1 11.9 2.5 11 8.1 10.1 10.1 8.1 11 2.5Z" fill="#8474ce"/>
      <path d="M19 2.5c.3 2.2 1.3 3.2 3.5 3.5-2.2.3-3.2 1.3-3.5 3.5-.3-2.2-1.3-3.2-3.5-3.5 2.2-.3 3.2-1.3 3.5-3.5Z" fill="#8bcfdd"/>
      <circle cx="19.5" cy="18.5" r="1.5" fill="#baa2e8"/>
    </svg>
    <span class="rw-label"><strong class="rw-orb-title">积分助手</strong><small>点击展开 · 拖动移动</small></span>
  </button>
  <section class="rw-panel" id="rw-panel" aria-label="Bing Rewards 积分面板" aria-hidden="true">
    <div class="rw-bar"><div class="rw-grip" title="拖动调整面板位置">
      <svg viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="4" cy="9" r="1.2"/><circle cx="10" cy="9" r="1.2"/><circle cx="4" cy="14" r="1.2"/><circle cx="10" cy="14" r="1.2"/></svg>
      <strong>REWARDS</strong><span>拖动调整位置</span></div>
      <button class="rw-close" type="button" aria-label="收起积分面板" title="收起 (Esc)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    </div><div class="rw-content"></div>
  </section>`;

  const launcher = root.querySelector(".rw-launcher");
  const panel = root.querySelector(".rw-panel");
  const grip = root.querySelector(".rw-grip");
  const closeButton = root.querySelector(".rw-close");
  const content = root.querySelector(".rw-content");
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const bounds = () => expanded
    ? { width: Math.min(400, viewport().width - MARGIN * 2), height: Math.min(720, viewport().height - MARGIN * 2) }
    : { width: SIZE, height: SIZE };
  let expanded = false;
  let interacted = false;
  let destroyed = false;
  let running = false;
  let suppressClick = false;
  let drag = null;
  let side = "right";
  let orb = { x: viewport().width - SIZE - 24, y: 96 };
  let position = { ...orb };

  function layout() {
    const view = viewport();
    const size = bounds();
    orb.x = clamp(orb.x, MARGIN, view.width - SIZE - MARGIN);
    orb.y = clamp(orb.y, MARGIN, view.height - SIZE - MARGIN);
    position.x = clamp(expanded ? position.x : orb.x, MARGIN, view.width - size.width - MARGIN);
    position.y = clamp(expanded ? position.y : orb.y, MARGIN, view.height - size.height - MARGIN);
    if (!expanded) side = orb.x + SIZE / 2 >= view.width / 2 ? "right" : "left";
    host.dataset.side = side;
    host.dataset.open = String(expanded);
    Object.assign(host.style, { left: `${position.x}px`, top: `${position.y}px`, width: `${size.width}px`, height: `${size.height}px` });
    const hoverWidth = Math.min(156, side === "right" ? orb.x + SIZE - MARGIN : view.width - orb.x - MARGIN);
    host.style.setProperty?.("--rw-hover-width", `${Math.max(SIZE, hoverWidth)}px`);
    panel.inert = !expanded;
    launcher.inert = expanded;
    panel.setAttribute("aria-hidden", String(!expanded));
    launcher.setAttribute("aria-expanded", String(expanded));
  }

  function persist() {
    const view = viewport();
    try {
      Promise.resolve(savePosition({
        xRatio: clamp((orb.x - MARGIN) / Math.max(1, view.width - SIZE - MARGIN * 2), 0, 1),
        yRatio: clamp((orb.y - MARGIN) / Math.max(1, view.height - SIZE - MARGIN * 2), 0, 1),
      })).catch(() => {});
    } catch { /* A disabled extension/storage must not prevent dragging. */ }
  }

  function open() {
    if (expanded) return;
    interacted = true;
    expanded = true;
    position = { x: orb.x - (side === "right" ? bounds().width - SIZE : 0), y: orb.y };
    layout();
    closeButton.focus({ preventScroll: true });
  }

  function close() {
    if (!expanded) return;
    expanded = false;
    layout();
    launcher.focus({ preventScroll: true });
  }

  launcher.addEventListener("click", (event) => {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    suppressClick = false;
    open();
  });
  closeButton.addEventListener("click", close);

  for (const handle of [launcher, grip]) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      interacted = true;
      suppressClick = false;
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y, moved: false };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      host.dataset.dragging = "true";
      event.preventDefault();
      position = { x: drag.x + dx, y: drag.y + dy };
      if (!expanded) orb = { ...position };
      layout();
      if (expanded) orb = { x: position.x + (side === "right" ? bounds().width - SIZE : 0), y: position.y };
    });
    const endDrag = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const moved = drag.moved;
      drag = null;
      host.dataset.dragging = "false";
      suppressClick = moved;
      try { handle.releasePointerCapture(event.pointerId); } catch { /* Already released on cancel. */ }
      if (moved) persist();
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("lostpointercapture", endDrag);
  }

  const onKey = (event) => {
    if (event.key === "Escape" && expanded) { event.preventDefault(); close(); }
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", layout);
  function ensureVisible() {
    if (destroyed) return;
    if (!host.isConnected) document.documentElement.append(host);
    layout();
  }
  function setStatus({ running: active = false } = {}) {
    running = Boolean(active);
    host.dataset.running = String(running);
    root.querySelector(".rw-orb-title").textContent = running ? "正在领取" : "积分助手";
    launcher.setAttribute("aria-label", `${running ? "领取中，" : ""}展开积分面板，可拖动调整位置`);
  }
  const widget = {
    host, root, content, open, close, ensureVisible, setStatus,
    destroy() {
      destroyed = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", layout);
      host.remove();
    },
  };
  host.__rewardsFloatingWidget = widget;
  ensureVisible();
  setStatus();
  try {
    Promise.resolve(loadPosition()).then((stored) => {
      if (destroyed || interacted || !Number.isFinite(stored?.xRatio) || !Number.isFinite(stored?.yRatio)) return;
      orb = {
        x: MARGIN + clamp(stored.xRatio, 0, 1) * Math.max(0, viewport().width - SIZE - MARGIN * 2),
        y: MARGIN + clamp(stored.yRatio, 0, 1) * Math.max(0, viewport().height - SIZE - MARGIN * 2),
      };
      layout();
    }).catch(() => {});
  } catch { /* Fall back to the default corner if saved coordinates are unavailable. */ }
  return widget;
}

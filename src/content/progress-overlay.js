(() => {
  const INSTANCE_KEY = "__bingRewardsProgressOverlay";
  if (globalThis[INSTANCE_KEY]) return;
  globalThis[INSTANCE_KEY] = true;

  const host = document.createElement("div");
  host.id = "bing-rewards-progress-overlay";
  host.setAttribute("aria-live", "polite");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 2147483647;
        width: min(340px, calc(100vw - 36px));
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .panel {
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 16px;
        background: rgba(15, 23, 42, 0.96);
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.36);
        backdrop-filter: blur(12px);
      }
      .header, .body, .summary { padding: 14px 16px; }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }
      .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
      .state { display: flex; align-items: center; gap: 7px; color: #93c5fd; font-size: 12px; }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #3b82f6;
        box-shadow: 0 0 0 5px rgba(59, 130, 246, 0.14);
        animation: pulse 1.4s ease-in-out infinite;
      }
      .panel[data-finished="true"] .dot { background: #22c55e; animation: none; }
      .panel[data-failed="true"] .dot { background: #ef4444; animation: none; }
      .progress { margin: 0 0 7px; color: #94a3b8; font-size: 12px; }
      .title { margin: 0; color: #f8fafc; font-size: 15px; font-weight: 650; line-height: 1.45; }
      .summary {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding-top: 0;
      }
      .metric {
        padding: 8px;
        border-radius: 10px;
        background: rgba(30, 41, 59, 0.9);
        color: #cbd5e1;
        font-size: 11px;
        text-align: center;
      }
      .metric strong { display: block; margin-bottom: 2px; color: #fff; font-size: 15px; }
      .recent { margin: 0; padding: 0 16px 14px; list-style: none; }
      .recent li {
        display: flex;
        gap: 8px;
        padding-top: 7px;
        color: #cbd5e1;
        font-size: 11px;
        line-height: 1.35;
      }
      .recent span:first-child { flex: 0 0 auto; }
      @keyframes pulse { 50% { opacity: 0.45; transform: scale(0.85); } }
      @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    </style>
    <section class="panel" role="status">
      <header class="header">
        <span class="brand">Bing Rewards 自动领取</span>
        <span class="state"><i class="dot"></i><span id="state-text"></span></span>
      </header>
      <div class="body">
        <p id="progress" class="progress"></p>
        <p id="title" class="title"></p>
      </div>
      <div class="summary">
        <span class="metric"><strong id="completed">0</strong>完成</span>
        <span class="metric"><strong id="skipped">0</strong>跳过</span>
        <span class="metric"><strong id="failed">0</strong>失败</span>
      </div>
      <ul id="recent" class="recent"></ul>
    </section>
  `;

  const panel = shadow.querySelector(".panel");
  const stateText = shadow.querySelector("#state-text");
  const progressText = shadow.querySelector("#progress");
  const titleText = shadow.querySelector("#title");
  const completedText = shadow.querySelector("#completed");
  const skippedText = shadow.querySelector("#skipped");
  const failedText = shadow.querySelector("#failed");
  const recentList = shadow.querySelector("#recent");
  let removalTimer = null;

  const outcomeIcon = {
    COMPLETED: "✓",
    SKIPPED: "−",
    FAILED: "!",
  };

  function render(run, finished = false) {
    if (!run) {
      host.remove();
      return;
    }

    clearTimeout(removalTimer);
    if (!host.isConnected) document.documentElement.append(host);

    const step = run.currentStep ?? {};
    const summary = run.summary ?? {};
    const total = step.total ?? run.progress?.total ?? 0;
    const current = step.index ?? run.progress?.current ?? 0;
    const failed = run.status === "aborted" || step.status === "failed";

    panel.dataset.finished = String(finished && !failed);
    panel.dataset.failed = String(failed);
    stateText.textContent = failed
      ? "执行中断"
      : finished
        ? "执行完成"
        : run.phase === "collecting"
          ? "正在识别"
          : "正在执行";
    progressText.textContent = total > 0
      ? `步骤 ${current}/${total} · ${step.section || "积分任务"}`
      : step.section || "正在准备";
    titleText.textContent = step.title || "正在准备执行任务";
    completedText.textContent = String(summary.completed ?? 0);
    skippedText.textContent = String(summary.skipped ?? 0);
    failedText.textContent = String(summary.failed ?? 0);

    recentList.replaceChildren();
    for (const result of (run.results ?? []).slice(-3).reverse()) {
      const item = document.createElement("li");
      const icon = document.createElement("span");
      const label = document.createElement("span");
      icon.textContent = outcomeIcon[result.outcome] ?? "•";
      label.textContent = result.title || result.section || "未命名步骤";
      item.append(icon, label);
      recentList.append(item);
    }

    if (finished) {
      removalTimer = setTimeout(() => host.remove(), 6_000);
    }
  }

  chrome.storage.local.get("currentRun").then(({ currentRun }) => {
    if (currentRun) render(currentRun);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const currentRun = changes.currentRun?.newValue;
    if (currentRun) {
      render(currentRun);
      return;
    }
    if (changes.currentRun && changes.lastRun?.newValue) {
      render(changes.lastRun.newValue, true);
    }
  });
})();

(() => {
  const INSTANCE_KEY = "__bingRewardsProgressOverlay";
  const HOST_ID = "bing-rewards-progress-overlay";
  const existing = globalThis[INSTANCE_KEY];
  if (typeof existing?.refresh === "function") {
    existing.refresh();
    return;
  }
  document.getElementById(HOST_ID)?.remove();
  const extensionVersion = chrome.runtime.getManifest().version;

  const host = document.createElement("div");
  host.id = HOST_ID;
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
      .version { margin-left: 5px; color: #94a3b8; font-size: 10px; font-weight: 600; }
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
      .diagnostic {
        margin: 0;
        padding: 0 16px 5px;
        color: #fbbf24;
        font-size: 11px;
        line-height: 1.45;
      }
      .diagnostic:empty { display: none; }
      @keyframes pulse { 50% { opacity: 0.45; transform: scale(0.85); } }
      @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    </style>
    <section class="panel" role="status">
      <header class="header">
        <span class="brand">Bing Rewards 自动领取<span class="version">v${extensionVersion}</span></span>
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
      <p id="diagnostic" class="diagnostic"></p>
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
  const diagnosticText = shadow.querySelector("#diagnostic");
  const recentList = shadow.querySelector("#recent");
  const outcomeIcon = {
    COMPLETED: "✓",
    SKIPPED: "−",
    FAILED: "!",
  };
  const reasonLabels = {
    ALREADY_TRIGGERED_TODAY: "今天已经触发过",
    COMPLEX_TASK: "需要继续交互",
    COMPLETED: "页面显示已完成",
    DISABLED: "当前不可用",
    NO_REWARD_SIGNAL: "没有积分标记",
    UNSUPPORTED_ENTRY_TYPE: "入口类型不支持",
    SECTION_NOT_FOUND: "未找到任务区域",
  };

  function render(run, finished = false) {
    if (!run) {
      host.remove();
      return;
    }

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

    const skippedReasons = new Map();
    for (const result of (run.results ?? []).filter((item) => item.outcome === "SKIPPED")) {
      const label = reasonLabels[result.reason] ?? result.reason ?? "其他";
      skippedReasons.set(label, (skippedReasons.get(label) ?? 0) + 1);
    }
    diagnosticText.textContent = skippedReasons.size > 0
      ? `跳过原因：${[...skippedReasons].map(([label, count]) => `${label} ${count}`).join(" · ")}`
      : "";

    recentList.replaceChildren();
    for (const result of (run.results ?? []).slice(-3).reverse()) {
      const item = document.createElement("li");
      const icon = document.createElement("span");
      const label = document.createElement("span");
      icon.textContent = outcomeIcon[result.outcome] ?? "•";
      const title = result.title || result.section || "未命名步骤";
      const reason = reasonLabels[result.reason];
      label.textContent = reason ? `${title} · ${reason}` : title;
      item.append(icon, label);
      recentList.append(item);
    }

  }

  async function refresh() {
    const { currentRun, lastRun } = await chrome.storage.local.get(["currentRun", "lastRun"]);
    if (currentRun) {
      render(currentRun);
    } else if (lastRun) {
      render(lastRun, true);
    }
  }

  globalThis[INSTANCE_KEY] = { refresh };
  refresh();

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

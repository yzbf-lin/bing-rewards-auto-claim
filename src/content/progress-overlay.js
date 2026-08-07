(() => {
  const INSTANCE_KEY = "__bingRewardsProgressPanel";
  const HOST_ID = "bing-rewards-progress-panel";
  const existing = globalThis[INSTANCE_KEY];
  if (typeof existing?.ensureVisible === "function") {
    existing.ensureVisible();
    return;
  }

  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    top: "12px",
    right: "12px",
    zIndex: "2147483647",
    width: "min(400px, calc(100vw - 24px))",
    height: "min(760px, calc(100vh - 24px))",
    border: "1px solid rgba(148, 163, 184, 0.4)",
    borderRadius: "16px",
    overflow: "hidden",
    background: "#f5f7fa",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.28)",
  });

  const frame = document.createElement("iframe");
  frame.title = "Bing Rewards 自动领取";
  frame.src = chrome.runtime.getURL("src/popup/popup.html?embedded=1");
  Object.assign(frame.style, {
    display: "block",
    width: "100%",
    height: "100%",
    border: "0",
    background: "#f5f7fa",
  });
  host.append(frame);

  function ensureVisible() {
    if (!host.isConnected) document.documentElement.append(host);
  }

  globalThis[INSTANCE_KEY] = { ensureVisible };
  ensureVisible();
})();

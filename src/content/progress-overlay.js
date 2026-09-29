(() => {
  const INSTANCE_KEY = "__bingRewardsProgressPanel";
  const HOST_ID = "bing-rewards-progress-panel";
  const POSITION_KEY = "bingRewardsFloatingPosition";
  const existing = globalThis[INSTANCE_KEY];
  if (typeof existing?.ensureVisible === "function") {
    existing.ensureVisible();
    return;
  }

  document.getElementById(HOST_ID)?.remove();
  const widget = createRewardsFloatingWidget({
    hostId: HOST_ID,
    loadPosition: async () => (await chrome.storage.local.get(POSITION_KEY))[POSITION_KEY],
    savePosition: (position) => chrome.storage.local.set({ [POSITION_KEY]: position }),
  });

  const frame = document.createElement("iframe");
  frame.title = "Bing Rewards 自动领取";
  frame.src = chrome.runtime.getURL("src/popup/popup.html?embedded=1");
  widget.content.append(frame);

  let statusChanged = false;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.currentRun) {
      statusChanged = true;
      widget.setStatus({ running: changes.currentRun.newValue?.status === "running" });
    }
  });
  chrome.storage.local.get("currentRun").then(({ currentRun }) => {
    if (!statusChanged) widget.setStatus({ running: currentRun?.status === "running" });
  }).catch(() => {});

  // Keyboard events inside an iframe do not bubble into the page's widget shell.
  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow &&
        event.origin === chrome.runtime.getURL("").replace(/\/$/, "") &&
        event.data?.type === "BING_REWARDS_PANEL_CLOSE") widget.close();
  });
  const ensureVisible = widget.ensureVisible;
  globalThis[INSTANCE_KEY] = { ensureVisible };
})();

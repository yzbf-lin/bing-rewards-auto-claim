import { buildPopupModel } from "./model.js";

const runButton = document.querySelector("#run-button");
const statusBadge = document.querySelector("#status-badge");
const summaryText = document.querySelector("#summary-text");
const memoryText = document.querySelector("#memory-text");
const finishedAt = document.querySelector("#finished-at");
const feedback = document.querySelector("#feedback");
const resultGroups = document.querySelector("#result-groups");
const updateCard = document.querySelector("#update-card");
const updateVersion = document.querySelector("#update-version");
const updateFeedback = document.querySelector("#update-feedback");
const downloadUpdate = document.querySelector("#download-update");
const extensionVersion = document.querySelector("#extension-version");
const liveProgress = document.querySelector("#live-progress");
const liveProgressMeta = document.querySelector("#live-progress-meta");
const liveProgressTitle = document.querySelector("#live-progress-title");
let availableUpdate = null;

document.body.classList.toggle(
  "embedded",
  new URLSearchParams(location.search).get("embedded") === "1",
);
extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;

function resultItem(result) {
  const item = document.createElement("div");
  item.className = "result-item";
  item.dataset.outcome = result.outcome;

  const text = document.createElement("div");
  const title = document.createElement("p");
  title.className = "result-title";
  title.textContent = result.title || "未命名入口";
  const reason = document.createElement("p");
  reason.className = "result-reason";
  reason.textContent = result.reasonLabel;
  text.append(title, reason);

  const outcome = document.createElement("span");
  outcome.className = "outcome";
  outcome.textContent = result.outcomeLabel;
  item.append(text, outcome);
  return item;
}

function render(model) {
  statusBadge.textContent = model.statusLabel;
  runButton.disabled = model.actionDisabled;
  runButton.textContent = model.actionDisabled ? "正在领取…" : "立即领取";
  summaryText.textContent = model.summaryText;
  memoryText.textContent = model.memoryText;
  finishedAt.textContent = model.finishedAt
    ? new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(model.finishedAt))
    : "";
  liveProgress.hidden = !model.currentStepTitle;
  liveProgressMeta.textContent = model.currentStepMeta || "";
  liveProgressTitle.textContent = model.currentStepTitle || "";
  resultGroups.replaceChildren();

  for (const group of model.groups) {
    const section = document.createElement("section");
    section.className = "result-group";
    const heading = document.createElement("h2");
    heading.textContent = group.section;
    const list = document.createElement("div");
    list.className = "result-list";
    list.append(...group.items.map(resultItem));
    section.append(heading, list);
    resultGroups.append(section);
  }
}

function renderUpdate(updateStatus) {
  availableUpdate = updateStatus?.status === "available" &&
    updateStatus.currentVersion === chrome.runtime.getManifest().version
    ? updateStatus
    : null;
  updateCard.hidden = !availableUpdate;
  if (!availableUpdate) return;

  updateVersion.textContent = `v${availableUpdate.currentVersion} → v${availableUpdate.latestVersion}`;
  updateFeedback.textContent = "下载后解压覆盖旧目录，并在扩展管理页重新加载。";
  downloadUpdate.disabled = false;
}

async function refresh() {
  const state = await chrome.storage.local.get([
    "currentRun",
    "lastRun",
    "taskMemory",
    "updateStatus",
  ]);
  render(buildPopupModel(state));
  renderUpdate(state.updateStatus);
}

runButton.addEventListener("click", async () => {
  feedback.textContent = "正在启动领取任务…";
  runButton.disabled = true;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      type: "RUN_CLAIM_NOW",
      targetTabId: activeTab?.id,
    });
    if (!response?.ok) throw new Error(response?.error || "启动失败");
    feedback.textContent = "任务已启动，请在页面右上角查看实时进度。";
  } catch (error) {
    feedback.textContent = `运行失败：${error.message}`;
  }
  await refresh();
});

downloadUpdate.addEventListener("click", async () => {
  const url = availableUpdate?.downloadUrl || availableUpdate?.releaseUrl;
  if (!url) return;

  downloadUpdate.disabled = true;
  updateFeedback.textContent = "正在开始下载…";
  try {
    if (availableUpdate.downloadUrl) {
      await chrome.downloads.download({
        url,
        filename: availableUpdate.fileName || `bing-rewards-auto-claim-v${availableUpdate.latestVersion}.zip`,
        saveAs: false,
      });
      updateFeedback.textContent = "下载已开始；完成后解压覆盖并重新加载扩展。";
    } else {
      await chrome.tabs.create({ url: availableUpdate.releaseUrl });
      updateFeedback.textContent = "已打开 Release 页面。";
    }
  } catch (error) {
    updateFeedback.textContent = `下载失败：${error.message}`;
    downloadUpdate.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.currentRun || changes.lastRun || changes.taskMemory || changes.updateStatus)
  ) refresh();
});

refresh();
chrome.runtime.sendMessage({ type: "CHECK_FOR_UPDATE" }).then((response) => {
  if (response?.ok) renderUpdate(response.updateStatus);
}).catch(() => {});

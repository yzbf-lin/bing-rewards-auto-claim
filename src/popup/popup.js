import { buildPopupModel } from "./model.js";

const runButton = document.querySelector("#run-button");
const statusBadge = document.querySelector("#status-badge");
const summaryText = document.querySelector("#summary-text");
const memoryText = document.querySelector("#memory-text");
const finishedAt = document.querySelector("#finished-at");
const feedback = document.querySelector("#feedback");
const resultGroups = document.querySelector("#result-groups");

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

async function refresh() {
  const state = await chrome.storage.local.get(["currentRun", "lastRun", "taskMemory"]);
  render(buildPopupModel(state));
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
    feedback.textContent = "领取任务已完成。";
  } catch (error) {
    feedback.textContent = `运行失败：${error.message}`;
  }
  await refresh();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.currentRun || changes.lastRun || changes.taskMemory)) refresh();
});

refresh();

import { createChromeDriver } from "./chrome-driver.js";
import { createClaimRunner } from "./runner.js";
import { nextBeijingRunAt, shouldCatchUp } from "./scheduler.js";

const ALARM_NAME = "bing-rewards-simple-auto-claim";
const storage = chrome.storage.local;
const driver = createChromeDriver({ chromeApi: chrome });
const runner = createClaimRunner({ driver, storage, logger: console });

async function ensureNextAlarm() {
  await chrome.alarms.create(ALARM_NAME, { when: nextBeijingRunAt().getTime() });
}

async function consumePendingAutomaticRun() {
  if (runner.isRunning()) return;
  const { pendingAutomaticRun } = await storage.get("pendingAutomaticRun");
  if (!pendingAutomaticRun) return;
  await storage.set({ pendingAutomaticRun: false });
  await runAutomatic("scheduled");
}

async function runAutomatic(trigger) {
  if (runner.isRunning()) {
    await storage.set({ pendingAutomaticRun: true });
    return null;
  }

  const result = await runner.run(trigger);
  await ensureNextAlarm();
  await consumePendingAutomaticRun();
  return result;
}

async function initializeSchedule() {
  await ensureNextAlarm();
  const { lastAutomaticDate } = await storage.get("lastAutomaticDate");
  if (shouldCatchUp({ lastAutomaticDate })) {
    await runAutomatic("startup_catch_up");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeSchedule().catch((error) => console.error("[Rewards Auto Claim] INIT_FAILED", error));
});

chrome.runtime.onStartup.addListener(() => {
  initializeSchedule().catch((error) => console.error("[Rewards Auto Claim] STARTUP_FAILED", error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  runAutomatic("scheduled").catch((error) => console.error("[Rewards Auto Claim] ALARM_FAILED", error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_CLAIM_NOW") return false;

  runner.run("manual", { targetTabId: message.targetTabId })
    .then(async (run) => {
      await consumePendingAutomaticRun();
      sendResponse({ ok: true, run });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

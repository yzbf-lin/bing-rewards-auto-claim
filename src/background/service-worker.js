import { createChromeDriver } from "./chrome-driver.js";
import { createClaimRunner } from "./runner.js";
import { beginManualRun } from "./manual-run.js";
import { nextBeijingRunAt, shouldCatchUp } from "./scheduler.js";
import { fetchLatestRelease } from "./update-checker.js";

const ALARM_NAME = "bing-rewards-simple-auto-claim";
const UPDATE_ALARM_NAME = "bing-rewards-release-check";
const UPDATE_CHECK_INTERVAL_MINUTES = 360;
const storage = chrome.storage.local;
const driver = createChromeDriver({ chromeApi: chrome });
const runner = createClaimRunner({ driver, storage, logger: console });
let updateCheckPromise = null;

async function ensureNextAlarm() {
  await chrome.alarms.create(ALARM_NAME, { when: nextBeijingRunAt().getTime() });
}

async function updateBadge(updateStatus) {
  const available = updateStatus?.status === "available";
  await chrome.action.setBadgeText({ text: available ? "↑" : "" });
  if (available) await chrome.action.setBadgeBackgroundColor({ color: "#d92d20" });
}

async function checkForUpdate({ force = false } = {}) {
  if (updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = (async () => {
    const { updateStatus: cached } = await storage.get("updateStatus");
    const currentVersion = chrome.runtime.getManifest().version;
    const fresh = cached?.checkedAt &&
      cached.currentVersion === currentVersion &&
      Date.now() - new Date(cached.checkedAt).getTime() < UPDATE_CHECK_INTERVAL_MINUTES * 60_000;
    if (!force && fresh) {
      await updateBadge(cached);
      return cached;
    }

    try {
      const updateStatus = await fetchLatestRelease({
        currentVersion,
      });
      await storage.set({ updateStatus });
      await updateBadge(updateStatus);
      return updateStatus;
    } catch (error) {
      console.warn("[Rewards Auto Claim] UPDATE_CHECK_FAILED", error);
      const fallback = cached?.currentVersion === currentVersion ? cached : null;
      await updateBadge(fallback);
      return fallback;
    }
  })().finally(() => {
    updateCheckPromise = null;
  });

  return updateCheckPromise;
}

async function initializeUpdateCheck() {
  await chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
  });
  await checkForUpdate();
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
  initializeUpdateCheck().catch((error) => console.error("[Rewards Auto Claim] UPDATE_INIT_FAILED", error));
});

chrome.runtime.onStartup.addListener(() => {
  initializeSchedule().catch((error) => console.error("[Rewards Auto Claim] STARTUP_FAILED", error));
  initializeUpdateCheck().catch((error) => console.error("[Rewards Auto Claim] UPDATE_STARTUP_FAILED", error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runAutomatic("scheduled").catch((error) => console.error("[Rewards Auto Claim] ALARM_FAILED", error));
  } else if (alarm.name === UPDATE_ALARM_NAME) {
    checkForUpdate({ force: true }).catch(
      (error) => console.error("[Rewards Auto Claim] UPDATE_ALARM_FAILED", error),
    );
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK_FOR_UPDATE") {
    checkForUpdate()
      .then((updateStatus) => sendResponse({ ok: true, updateStatus }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type !== "RUN_CLAIM_NOW") return false;

  const { response } = beginManualRun({
    runner,
    targetTabId: message.targetTabId,
    consumePendingAutomaticRun,
    logger: console,
  });
  sendResponse(response);
  return false;
});

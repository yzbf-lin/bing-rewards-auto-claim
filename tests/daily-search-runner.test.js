import test from "node:test";
import assert from "node:assert/strict";
import { createClaimRunner } from "../src/background/runner.js";

const dateKey = "2026-10-19";
const now = () => new Date("2026-10-19T02:00:00Z");
const silent = { info() {}, warn() {} };

function setup({ initial = {}, daily, now: currentTime = now } = {}) {
  const state = structuredClone(initial), writes = [], actions = [], received = [];
  const storage = {
    async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(state[key])])); },
    async set(value) { writes.push(structuredClone(value)); Object.assign(state, structuredClone(value)); },
  };
  const driver = {
    async loadCatalog() {
      return { missingSections: [], entries: [{ id: "normal", title: "今日主题", text: "今日主题 +5", kind: "link" }] };
    },
    async executeLink() { actions.push("task"); return {}; },
    async refreshDashboard() {
      actions.push("claims-refresh");
      return { entries: [{ id: "claim", title: "领取待领取积分", text: "可领取 10 领取", kind: "button", action: "claim-points", rewardPoints: 10 }] };
    },
    async executeButton() { actions.push("claim"); return { reason: "POINTS_CLAIMED", claimedPoints: 10 }; },
    async runDailySearches(context) {
      actions.push("daily-search"); received.push(context);
      if (daily) return daily(context);
      for (let completed = context.progress.completed + 1; completed <= 20; completed += 1) {
        await context.onProgress({ dateKey: context.dateKey, completed, queries: Array.from({ length: completed }, (_, index) => `主题 ${index + 1}`) });
      }
      return { reason: "DAILY_SEARCH_COMPLETED", completedSearches: 20, expectedPoints: 60, pointsVerified: false, rewardPoints: null };
    },
    async restore() { actions.push("restore"); },
    async cleanup() { actions.push("cleanup"); },
  };
  return { state, writes, actions, received, runner: createClaimRunner({ storage, driver, now: currentTime, logger: silent }) };
}

test("runs daily searches after task and claim actions, persists each confirmation, then restores the tab", async () => {
  const fake = setup();
  const run = await fake.runner.run("manual", { targetTabId: 99 });
  assert.deepEqual(fake.actions, ["task", "claims-refresh", "claim", "daily-search", "restore", "cleanup"]);
  assert.equal(fake.received[0].targetTabId, 99);
  assert.equal(fake.received[0].dateKey, dateKey);
  assert.deepEqual(fake.received[0].progress, { dateKey, completed: 0, queries: [] });
  const confirmations = fake.writes.filter(write => write.dailySearchProgress && write.currentRun?.phase === "daily-search" && write.currentRun.currentStep.status === "running");
  assert.equal(confirmations.length, 20);
  assert.deepEqual(confirmations.map(write => write.dailySearchProgress.completed), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(confirmations.at(-1).currentRun.currentStep.title, "每日搜索 20/20");
  assert.equal(fake.state.dailySearchProgress.completed, 20);
  assert.deepEqual(run.results.at(-1), {
    scope: "entry", section: "每日搜索", title: "每日搜索 20/20", outcome: "COMPLETED",
    reason: "DAILY_SEARCH_COMPLETED", completedSearches: 20, expectedPoints: 60,
    pointsVerified: false, rewardPoints: null, durationMs: 0,
  });
  assert.deepEqual(run.summary, { total: 3, completed: 3, skipped: 0, failed: 0 });
});

test("manual reruns skip the daily search batch already completed on the same Beijing date", async () => {
  const fake = setup();
  await fake.runner.run("manual");
  const second = await fake.runner.run("manual");
  assert.equal(fake.actions.filter(action => action === "daily-search").length, 1);
  assert.equal(second.results.at(-1).reason, "DAILY_SEARCH_ALREADY_COMPLETED");
  assert.equal(second.results.at(-1).outcome, "SKIPPED");
  assert.equal(second.results.at(-1).title, "每日搜索 20/20");
  assert.equal(fake.state.dailySearchProgress.completed, 20);
});

test("both manual and automatic runs resume partial progress from the same day", async () => {
  for (const trigger of ["manual", "scheduled"]) {
    const progress = { dateKey, completed: 17, queries: Array.from({ length: 17 }, (_, index) => `主题 ${index + 1}`) };
    const fake = setup({ initial: { dailySearchProgress: progress } });
    await fake.runner.run(trigger);
    assert.deepEqual(fake.received[0].progress, progress);
    assert.deepEqual(fake.writes.filter(write => write.dailySearchProgress && write.currentRun?.currentStep.status === "running").map(write => write.dailySearchProgress.completed), [18, 19, 20]);
  }
});

test("a new Beijing date clears the previous day's batch before searching", async () => {
  const fake = setup({ initial: { dailySearchProgress: { dateKey: "2026-10-18", completed: 20, queries: ["昨天的主题"] } } });
  await fake.runner.run();
  assert.deepEqual(fake.received[0].progress, { dateKey, completed: 0, queries: [] });
  assert.equal(fake.state.dailySearchProgress.completed, 20);
});

test("a partial batch failure is recorded while confirmed progress remains resumable and restore still runs", async () => {
  const fake = setup({ daily: async context => {
    await context.onProgress({ dateKey, completed: 2, queries: ["主题一", "主题二"] });
    throw new Error("SEARCH_FORM_UNAVAILABLE");
  } });
  const run = await fake.runner.run("manual", { targetTabId: 99 });
  assert.equal(run.status, "completed");
  assert.equal(run.results.at(-1).outcome, "FAILED");
  assert.equal(run.results.at(-1).reason, "SEARCH_FORM_UNAVAILABLE");
  assert.equal(run.results.at(-1).completedSearches, 2);
  assert.equal(run.results.at(-1).title, "每日搜索 2/20");
  assert.equal(fake.state.dailySearchProgress.completed, 2);
  assert.deepEqual(fake.actions.slice(-2), ["restore", "cleanup"]);
});

test("a completed return without twenty persisted confirmations is not reported as complete", async () => {
  const fake = setup({ daily: async () => ({ reason: "DAILY_SEARCH_COMPLETED", completedSearches: 20, expectedPoints: 60 }) });
  const run = await fake.runner.run();
  assert.equal(run.results.at(-1).outcome, "FAILED");
  assert.equal(run.results.at(-1).reason, "DAILY_SEARCH_NOT_CONFIRMED");
  assert.equal(fake.state.dailySearchProgress.completed, 0);
});

test("crossing the Beijing date during earlier tasks stops the daily stage before it submits", async () => {
  let reads = 0;
  const fake = setup({ now: () => ++reads >= 8 ? new Date("2026-10-19T16:00:00Z") : now() });
  const run = await fake.runner.run();
  assert.equal(fake.received.length, 0);
  assert.equal(run.results.at(-1).reason, "DAILY_SEARCH_DATE_CHANGED");
  assert.equal(fake.state.dailySearchProgress.completed, 0);
});

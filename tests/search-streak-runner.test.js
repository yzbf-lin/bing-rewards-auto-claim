import test from "node:test";
import assert from "node:assert/strict";
import { createClaimRunner } from "../src/background/runner.js";

const streak = { id: "search-streak", section: "连续打卡任务", title: "必应搜索连续打卡", text: "必应搜索连续打卡 +3 搜索: 0/1", kind: "link", url: "https://www.bing.com/", source: "earn", sourceUrl: "https://rewards.bing.com/earn" };
const normal = { id: "normal", title: "今日主题", text: "今日主题 +5", kind: "link", url: "https://www.bing.com/search?q=topic" };

function setup(query, { fail = false, entries = [streak, normal] } = {}) {
  const state = { searchQuery: query };
  const calls = [];
  const logs = [];
  const storage = {
    async get(keys) { return Object.fromEntries([keys].flat().map((key) => [key, state[key]])); },
    async set(value) { Object.assign(state, structuredClone(value)); },
  };
  const driver = {
    async loadCatalog() { return { entries, missingSections: [] }; },
    async executeLink(entry, context) {
      calls.push({ id: entry.id, context });
      if (entry.id === streak.id && fail) throw new Error("SEARCH_STREAK_NOT_CONFIRMED");
      return { reason: entry.id === streak.id ? "SEARCH_STREAK_COMPLETED" : "ACTION_TRIGGERED" };
    },
    async cleanup() {},
  };
  return { state, calls, logs, runner: createClaimRunner({ driver, storage, logger: { info(...args) { logs.push(args); }, warn(...args) { logs.push(args); } } }) };
}

test("missing search query skips only the search streak and gives an actionable reason", async () => {
  const runtime = setup("  ");
  const run = await runtime.runner.run();
  assert.equal(run.results[0].reason, "SEARCH_QUERY_REQUIRED");
  assert.equal(run.results[0].outcome, "SKIPPED");
  assert.deepEqual(runtime.calls.map((call) => call.id), ["normal"]);
});

test("runner passes the saved trimmed query only to the streak executor without logging it", async () => {
  const runtime = setup("  aurora forecasting  ");
  const run = await runtime.runner.run("scheduled", { targetTabId: 7 });
  assert.deepEqual(runtime.calls, [
    { id: "search-streak", context: { targetTabId: 7, searchQuery: "aurora forecasting" } },
    { id: "normal", context: { targetTabId: 7 } },
  ]);
  assert.equal(run.results[0].reason, "SEARCH_STREAK_COMPLETED");
  assert.doesNotMatch(JSON.stringify([run, runtime.logs]), /aurora forecasting/);
});

test("invalid saved query is skipped and never submitted", async () => {
  for (const value of [123, {}, "x".repeat(201), "one\ntwo"]) {
    const runtime = setup(value);
    const run = await runtime.runner.run();
    assert.equal(run.results[0].reason, "SEARCH_QUERY_INVALID");
    assert.equal(runtime.calls.length, 1);
  }
});

test("unconfirmed search progress never becomes a successful task memory entry", async () => {
  const runtime = setup("aurora forecasting", { fail: true });
  const run = await runtime.runner.run();
  assert.equal(run.results[0].outcome, "FAILED");
  assert.equal(run.results[0].reason, "SEARCH_STREAK_NOT_CONFIRMED");
  assert.equal(Object.values(runtime.state.taskMemory).find((item) => item.title === streak.title).lastCompletedDate, null);
  assert.equal(run.results[1].outcome, "COMPLETED");
});

test("the same daily search in multiple catalog sources is attempted only once even after failure", async () => {
  for (const trigger of ["manual", "scheduled"]) {
    const rt = setup("aurora forecasting", { fail: true, entries: [streak, { ...streak, source: "dashboard" }, normal] });
    const run = await rt.runner.run(trigger);
    assert.deepEqual(rt.calls.map(call => call.id), ["search-streak", "normal"]);
    assert.equal(run.results[1].outcome, "SKIPPED");
    assert.equal(run.results[1].reason, "SEARCH_STREAK_ALREADY_ATTEMPTED");
  }
});

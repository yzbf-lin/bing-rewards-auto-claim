import test from "node:test";
import assert from "node:assert/strict";
import { createClaimRunner } from "../src/background/runner.js";

const streak = { id: "search-streak", section: "连续打卡任务", title: "必应搜索连续打卡", text: "必应搜索连续打卡 +3 搜索: 0/1", kind: "link", url: "https://www.bing.com/", source: "earn", sourceUrl: "https://rewards.bing.com/earn" };
const normal = { id: "normal", title: "今日主题", text: "今日主题 +5", kind: "link", url: "https://www.bing.com/search?q=topic" };

function setup(query, { fail = false, entries = [streak, normal] } = {}) {
  const state = { searchQuery: query };
  const calls = [], logs = [], reads = [];
  const storage = {
    async get(keys) { reads.push(...[keys].flat()); return Object.fromEntries([keys].flat().map(key => [key, state[key]])); },
    async set(value) { Object.assign(state, structuredClone(value)); },
  };
  const execute = async (entry, context) => {
    calls.push({ id: entry.id, context });
    if (entry.id === streak.id && fail) throw new Error("SEARCH_STREAK_NOT_CONFIRMED");
    return { reason: entry.id === streak.id ? "SEARCH_STREAK_COMPLETED" : "ACTION_TRIGGERED" };
  };
  const driver = { async loadCatalog() { return { entries, missingSections: [] }; }, executeLink: execute, executeButton: execute, async cleanup() {} };
  return { state, calls, logs, reads, runner: createClaimRunner({ driver, storage, logger: { info(...args) { logs.push(args); }, warn(...args) { logs.push(args); } } }) };
}

test("search streak runs without settings in manual and scheduled modes", async () => {
  for (const trigger of ["manual", "scheduled"]) {
    const rt = setup(undefined);
    const run = await rt.runner.run(trigger, { targetTabId: 7 });
    assert.equal(run.results[0].reason, "SEARCH_STREAK_COMPLETED");
    assert.match(rt.calls[0].context.searchQuery, /^[0-9a-f]{16}$/);
    assert.equal(rt.calls[0].context.targetTabId, 7);
    assert.deepEqual(rt.calls[1], { id: "normal", context: { targetTabId: 7 } });
    assert.equal(rt.reads.includes("searchQuery"), false);
    assert.equal(JSON.stringify([run, rt.logs]).includes(rt.calls[0].context.searchQuery), false);
  }
});

test("legacy empty, invalid and custom saved queries no longer affect execution", async () => {
  for (const query of ["", "  ", "old-custom-query", 123, {}, "x".repeat(201), "one\ntwo"]) {
    const rt = setup(query);
    const run = await rt.runner.run("manual");
    assert.equal(run.results[0].reason, "SEARCH_STREAK_COMPLETED");
    assert.match(rt.calls[0].context.searchQuery, /^[0-9a-f]{16}$/);
    assert.deepEqual(rt.state.searchQuery, query);
  }
});

test("button-based search streak receives the generated query", async () => {
  const rt = setup(undefined, { entries: [{ ...streak, kind: "button", url: null }] });
  const run = await rt.runner.run("manual");
  assert.equal(run.results[0].reason, "SEARCH_STREAK_COMPLETED");
  assert.match(rt.calls[0].context.searchQuery, /^[0-9a-f]{16}$/);
});

test("each explicit new run generates a fresh query", async t => {
  let nonce = 0;
  t.mock.method(globalThis.crypto, "getRandomValues", bytes => bytes.fill(++nonce));
  const rt = setup(undefined);
  await rt.runner.run("manual");
  await rt.runner.run("manual");
  assert.deepEqual(rt.calls.filter(call => call.id === streak.id).map(call => call.context.searchQuery), ["0101010101010101", "0202020202020202"]);
  assert.equal(nonce, 2);
});

test("unconfirmed progress is not completed and duplicate catalog copies do not generate or submit again", async t => {
  let generated = 0;
  t.mock.method(globalThis.crypto, "getRandomValues", bytes => bytes.fill(++generated));
  const rt = setup(undefined, { fail: true, entries: [streak, { ...streak, source: "dashboard" }, normal] });
  const run = await rt.runner.run("manual");
  assert.equal(run.results[0].reason, "SEARCH_STREAK_NOT_CONFIRMED");
  assert.equal(run.results[1].reason, "SEARCH_STREAK_ALREADY_ATTEMPTED");
  assert.equal(Object.values(rt.state.taskMemory).find(item => item.title === streak.title).lastCompletedDate, null);
  assert.deepEqual(rt.calls.map(call => call.id), ["search-streak", "normal"]);
  assert.equal(generated, 1);
});

test("completed tasks do not consume a random query", async t => {
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("must not generate"); });
  const rt = setup(undefined, { entries: [{ ...streak, text: "搜索: 1/1" }, normal] });
  const run = await rt.runner.run("manual");
  assert.equal(run.results[0].reason, "COMPLETED");
  assert.deepEqual(rt.calls.map(call => call.id), ["normal"]);
});

test("random generation failure does not prevent other rewards tasks", async t => {
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("unavailable"); });
  const rt = setup(undefined);
  const run = await rt.runner.run("manual");
  assert.equal(run.results[0].reason, "SEARCH_QUERY_GENERATION_FAILED");
  assert.equal(run.results[0].outcome, "FAILED");
  assert.equal(run.results[1].outcome, "COMPLETED");
  assert.deepEqual(rt.calls.map(call => call.id), ["normal"]);
});

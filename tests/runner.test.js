import test from "node:test";
import assert from "node:assert/strict";

import { createClaimRunner } from "../src/background/runner.js";

function makeStorage(initialState = {}) {
  const writes = [];
  const state = structuredClone(initialState);
  return {
    writes,
    state,
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.map((name) => [name, state[name]]));
    },
    async set(value) {
      writes.push(structuredClone(value));
      Object.assign(state, structuredClone(value));
    },
  };
}

test("executes eligible entries sequentially and records skipped entries", async () => {
  const actions = [];
  const storage = makeStorage();
  const driver = {
    async loadCatalog() {
      return {
        missingSections: [],
        entries: [
          { id: "a", section: "日常任务", title: "浏览推荐", text: "浏览推荐 +5", kind: "link", url: "https://example.com/a", disabled: false },
          { id: "b", section: "日常任务", title: "每日搜索", text: "每日搜索 +5", kind: "link", url: "https://bing.com/search?q=x", disabled: false },
          { id: "c", section: "日常任务", title: "领取奖励", text: "领取奖励 +10", kind: "button", url: null, disabled: false },
        ],
      };
    },
    async executeLink(entry) {
      actions.push(`link:${entry.id}`);
      return { finalUrl: entry.url };
    },
    async executeButton(entry) {
      actions.push(`button:${entry.id}`);
      return { finalUrl: "https://rewards.bing.com/earn" };
    },
    async cleanup() {
      actions.push("cleanup");
    },
  };
  const runner = createClaimRunner({
    driver,
    storage,
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date("2026-08-05T02:00:00.000Z"),
  });

  const run = await runner.run("manual");

  assert.deepEqual(actions, ["link:a", "button:c", "cleanup"]);
  assert.deepEqual(run.summary, { total: 3, completed: 2, skipped: 1, failed: 0 });
  assert.equal(run.status, "completed");
  assert.equal(
    storage.writes.some((write) => write.currentRun?.progress?.current === 3),
    true,
  );
  assert.equal(
    storage.writes.some((write) =>
      write.currentRun?.currentStep?.title === "浏览推荐" &&
      write.currentRun.currentStep.status === "running"),
    true,
  );
  assert.equal(
    storage.writes.some((write) =>
      write.currentRun?.currentStep?.title === "领取奖励" &&
      write.currentRun.currentStep.status === "completed"),
    true,
  );
  assert.equal(storage.writes.at(-1).lastRun.status, "completed");
  assert.equal(Object.keys(storage.state.taskMemory).length, 3);
});

test("continues after one entry fails and always cleans up", async () => {
  const actions = [];
  const driver = {
    async loadCatalog() {
      return {
        missingSections: [],
        entries: [
          { id: "a", section: "日常任务", title: "奖励 A", text: "奖励 A +5", kind: "link", url: "https://example.com/a", disabled: false },
          { id: "b", section: "日常任务", title: "奖励 B", text: "奖励 B +5", kind: "button", url: null, disabled: false },
        ],
      };
    },
    async executeLink() {
      actions.push("link");
      throw new Error("navigation failed");
    },
    async executeButton() {
      actions.push("button");
      return {};
    },
    async cleanup() {
      actions.push("cleanup");
    },
  };
  const runner = createClaimRunner({
    driver,
    storage: makeStorage(),
    logger: { info() {}, warn() {}, error() {} },
  });

  const run = await runner.run("manual");

  assert.deepEqual(actions, ["link", "button", "cleanup"]);
  assert.deepEqual(run.summary, { total: 2, completed: 1, skipped: 0, failed: 1 });
});

test("returns the active run instead of starting a concurrent run", async () => {
  let releaseCatalog;
  let loads = 0;
  const driver = {
    loadCatalog() {
      loads += 1;
      return new Promise((resolve) => {
        releaseCatalog = () => resolve({ entries: [], missingSections: [] });
      });
    },
    async cleanup() {},
  };
  const runner = createClaimRunner({
    driver,
    storage: makeStorage(),
    logger: { info() {}, warn() {}, error() {} },
  });

  const first = runner.run("manual");
  const second = runner.run("scheduled");
  assert.equal(first, second);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(loads, 1);

  releaseCatalog();
  await first;
});

test("does not trigger the same remembered task twice on one Beijing date", async () => {
  let executions = 0;
  const storage = makeStorage();
  const catalogEntry = {
    id: "daily-topic",
    section: "积分首页",
    title: "解码历史",
    text: "解码历史 +10",
    kind: "link",
    url: "https://www.bing.com/search?q=egypt&rnoreward=1",
    disabled: false,
  };
  const driver = {
    async loadCatalog() {
      return { missingSections: [], entries: [catalogEntry] };
    },
    async executeLink(entry) {
      executions += 1;
      return { finalUrl: entry.url };
    },
    async cleanup() {},
  };
  const runner = createClaimRunner({
    driver,
    storage,
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date("2026-08-06T02:00:00.000Z"),
  });

  const first = await runner.run("manual");
  const second = await runner.run("manual");

  assert.equal(first.results[0].outcome, "COMPLETED");
  assert.equal(second.results[0].reason, "ALREADY_TRIGGERED_TODAY");
  assert.equal(executions, 1);
});

test("passes the manual current-tab context to catalog and action operations", async () => {
  const calls = [];
  const context = { targetTabId: 42 };
  const driver = {
    async loadCatalog(receivedContext) {
      calls.push(["catalog", receivedContext]);
      return {
        missingSections: [],
        entries: [{
          id: "quick",
          section: "积分首页",
          title: "浏览赚取页面",
          text: "浏览赚取页面 +10",
          kind: "link",
          url: "https://rewards.bing.com/earn",
          disabled: false,
        }],
      };
    },
    async executeLink(_entry, receivedContext) {
      calls.push(["link", receivedContext]);
      return { finalUrl: "https://rewards.bing.com/earn" };
    },
    async cleanup() {},
  };
  const runner = createClaimRunner({
    driver,
    storage: makeStorage(),
    logger: { info() {}, warn() {}, error() {} },
  });

  await runner.run("manual", context);

  assert.deepEqual(calls, [["catalog", context], ["link", context]]);
});

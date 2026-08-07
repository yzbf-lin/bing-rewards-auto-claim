import test from "node:test";
import assert from "node:assert/strict";

import { createChromeDriver } from "../src/background/chrome-driver.js";

function chromeFake(
  catalog,
  dashboardCatalog = { missingSections: [], entries: [] },
  questCatalog = { missingSections: [], entries: [] },
) {
  let nextId = 1;
  const tabs = new Map();
  const removed = [];
  const updates = [];
  const injections = [];
  const emptyEvent = { addListener() {}, removeListener() {} };

  return {
    removed,
    updates,
    injections,
    seedTab(tab) {
      tabs.set(tab.id, { status: "complete", ...tab });
    },
    api: {
      tabs: {
        onUpdated: emptyEvent,
        onRemoved: emptyEvent,
        onCreated: emptyEvent,
        async create(options) {
          const tab = { id: nextId++, status: "complete", url: options.url };
          tabs.set(tab.id, tab);
          return tab;
        },
        async get(tabId) {
          if (!tabs.has(tabId)) throw new Error("missing tab");
          return tabs.get(tabId);
        },
        async update(tabId, options) {
          if (!tabs.has(tabId)) throw new Error("missing tab");
          const tab = { ...tabs.get(tabId), ...options, status: "complete" };
          tabs.set(tabId, tab);
          updates.push({ tabId, options });
          return tab;
        },
        async remove(tabId) {
          removed.push(tabId);
          tabs.delete(tabId);
        },
      },
      scripting: {
        async executeScript(options) {
          if (options.files) {
            injections.push({ tabId: options.target.tabId, files: options.files });
            return [{}];
          }
          if (options.func.name === "collectRewardsEntries") {
            return [{ result: structuredClone(catalog) }];
          }
          if (options.func.name === "collectDashboardEntries") {
            return [{ result: structuredClone(dashboardCatalog) }];
          }
          if (options.func.name === "collectQuestEntries") {
            return [{ result: structuredClone(questCatalog) }];
          }
          if (options.func.name === "activateRewardsButton") {
            return [{ result: true }];
          }
          throw new Error(`unexpected function ${options.func.name}`);
        },
      },
    },
  };
}

test("loads a stable catalog and closes the source tab", async () => {
  const catalog = {
    missingSections: [],
    entries: [{ id: "reward-entry-3-0", section: "日常任务", title: "奖励", text: "奖励 +5", kind: "link", url: "https://example.com", disabled: false }],
  };
  const fake = chromeFake(catalog);
  const driver = createChromeDriver({
    chromeApi: fake.api,
    delay: async () => {},
    catalogAttempts: 3,
  });

  assert.deepEqual(await driver.loadCatalog(), {
    missingSections: [],
    entries: [
      {
        ...catalog.entries[0],
        source: "earn",
        sourceUrl: "https://rewards.bing.com/earn",
      },
    ],
  });
  assert.deepEqual(fake.removed, [1, 2]);
});

test("merges quick dashboard links into the catalog", async () => {
  const dashboardEntry = {
    id: "dashboard-entry-0",
    section: "积分首页",
    title: "解码历史",
    text: "解码历史 +10",
    kind: "link",
    url: "https://www.bing.com/search?q=egypt&rnoreward=1",
    disabled: false,
  };
  const fake = chromeFake(
    { missingSections: [], entries: [] },
    { missingSections: [], entries: [dashboardEntry] },
  );
  const driver = createChromeDriver({
    chromeApi: fake.api,
    delay: async () => {},
    catalogAttempts: 3,
  });

  assert.deepEqual((await driver.loadCatalog()).entries, [
    {
      ...dashboardEntry,
      source: "dashboard",
      sourceUrl: "https://rewards.bing.com/dashboard?section=dailyset",
    },
  ]);
  assert.deepEqual(fake.removed, [1, 2]);
});

test("expands earn quest parents into one-click child tasks", async () => {
  const questParent = {
    id: "reward-entry-2-0",
    section: "任务",
    title: "八月活动",
    text: "八月活动 +50 1/4 个任务",
    kind: "link",
    url: "https://rewards.bing.com/earn/quest/monthly",
    disabled: false,
  };
  const questStep = {
    id: "quest-entry-0",
    section: "任务：八月活动",
    parentTitle: "八月活动",
    title: "探索八月优惠",
    text: "探索八月优惠，点击即可完成",
    kind: "link",
    url: "https://www.bing.com/search?q=offers&rnoreward=1",
    disabled: false,
    action: "quest-step",
  };
  const fake = chromeFake(
    { missingSections: [], entries: [questParent] },
    { missingSections: [], entries: [] },
    { missingSections: [], entries: [questStep] },
  );
  const driver = createChromeDriver({
    chromeApi: fake.api,
    delay: async () => {},
    catalogAttempts: 3,
  });

  const catalog = await driver.loadCatalog();

  assert.equal(catalog.entries.length, 2);
  assert.deepEqual(catalog.entries[1], {
    ...questStep,
    source: "quest",
    sourceUrl: questParent.url,
  });
  assert.deepEqual(fake.updates, [
    { tabId: 1, options: { url: questParent.url, active: false } },
  ]);
});

test("opens a link in the background and closes it after load", async () => {
  const fake = chromeFake({ missingSections: [], entries: [] });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  const result = await driver.executeLink({ url: "https://example.com/reward" });

  assert.equal(result.finalUrl, "https://example.com/reward");
  assert.deepEqual(fake.removed, [1]);
});

test("loads catalogs and opens actions in the supplied current tab without creating tabs", async () => {
  const dashboardEntry = {
    id: "dashboard-entry-0",
    section: "积分首页",
    title: "解码历史",
    text: "解码历史 +10",
    kind: "link",
    url: "https://www.bing.com/search?q=egypt&rnoreward=1",
    disabled: false,
  };
  const fake = chromeFake(
    { missingSections: [], entries: [] },
    { missingSections: [], entries: [dashboardEntry] },
  );
  fake.seedTab({ id: 99, url: "https://example.com/start" });
  const driver = createChromeDriver({
    chromeApi: fake.api,
    delay: async () => {},
    catalogAttempts: 3,
  });

  const catalog = await driver.loadCatalog({ targetTabId: 99 });
  const result = await driver.executeLink(catalog.entries[0], { targetTabId: 99 });

  assert.deepEqual(fake.updates, [
    { tabId: 99, options: { url: "https://rewards.bing.com/earn", active: true } },
    { tabId: 99, options: { url: "https://rewards.bing.com/dashboard?section=dailyset", active: true } },
    { tabId: 99, options: { url: dashboardEntry.url, active: true } },
  ]);
  assert.equal(result.finalUrl, dashboardEntry.url);
  assert.deepEqual(fake.removed, []);
  assert.deepEqual(fake.injections, [
    { tabId: 99, files: ["src/content/progress-overlay.js"] },
    { tabId: 99, files: ["src/content/progress-overlay.js"] },
    { tabId: 99, files: ["src/content/progress-overlay.js"] },
  ]);
});

test("injects the progress panel before a manual run navigates", async () => {
  const fake = chromeFake({ missingSections: [], entries: [] });
  fake.seedTab({ id: 99, url: "https://rewards.bing.com/earn" });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  assert.equal(await driver.showProgress({ targetTabId: 99 }), true);
  assert.deepEqual(fake.injections, [
    { tabId: 99, files: ["src/content/progress-overlay.js"] },
  ]);
});

test("re-collects and activates a unique button", async () => {
  const entry = { id: "reward-entry-3-0", section: "日常任务", title: "奖励", text: "奖励 +5", kind: "button", url: null, disabled: false };
  const fake = chromeFake({ missingSections: [], entries: [entry] });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  const result = await driver.executeButton(entry);

  assert.equal(result.finalUrl, "https://rewards.bing.com/earn");
  assert.deepEqual(fake.removed, [1]);
});

test("re-collects and activates a button in the supplied current tab", async () => {
  const entry = { id: "reward-entry-3-0", section: "日常任务", title: "奖励", text: "奖励 +5", kind: "button", url: null, disabled: false };
  const fake = chromeFake({ missingSections: [], entries: [entry] });
  fake.seedTab({ id: 99, url: "https://example.com/start" });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  const result = await driver.executeButton(entry, { targetTabId: 99 });

  assert.equal(result.finalUrl, "https://rewards.bing.com/earn");
  assert.deepEqual(fake.updates, [
    { tabId: 99, options: { url: "https://rewards.bing.com/earn", active: true } },
  ]);
  assert.deepEqual(fake.removed, []);
});

test("does not wait for a navigation when the current tab already has the button source", async () => {
  const entry = { id: "reward-entry-3-0", section: "日常任务", title: "奖励", text: "奖励 +5", kind: "button", url: null, disabled: false };
  const fake = chromeFake({ missingSections: [], entries: [entry] });
  fake.seedTab({ id: 99, url: "https://rewards.bing.com/earn" });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  const result = await driver.executeButton(entry, { targetTabId: 99 });

  assert.equal(result.finalUrl, "https://rewards.bing.com/earn");
  assert.deepEqual(fake.updates, []);
  assert.deepEqual(fake.removed, []);
});

test("restores the supplied current tab to the Rewards earn page", async () => {
  const fake = chromeFake({ missingSections: [], entries: [] });
  fake.seedTab({ id: 99, url: "https://www.bing.com/search?q=reward" });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  await driver.restore({ targetTabId: 99 });

  assert.deepEqual(fake.updates, [
    { tabId: 99, options: { url: "https://rewards.bing.com/earn", active: true } },
  ]);
  assert.deepEqual(fake.injections, [
    { tabId: 99, files: ["src/content/progress-overlay.js"] },
  ]);
});

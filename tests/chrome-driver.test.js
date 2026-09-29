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
  const linkActivations = [];
  const emptyEvent = { addListener() {}, removeListener() {} };

  return {
    removed,
    updates,
    injections,
    linkActivations,
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
          if (options.func.name === "activateRewardsLink") {
            const candidates = [
              ...(catalog.entries ?? []),
              ...(dashboardCatalog.entries ?? []),
              ...(questCatalog.entries ?? []),
            ];
            const entry = candidates.find((candidate) => candidate.id === options.args[0]);
            if (!entry) return [{ result: null }];
            const tab = tabs.get(options.target.tabId);
            tabs.set(options.target.tabId, { ...tab, status: "complete", url: entry.url });
            linkActivations.push({ tabId: options.target.tabId, entryId: entry.id });
            return [{ result: { activated: true, url: entry.url } }];
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
      sourceUrl: "https://rewards.bing.com/dashboard",
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
    questProgress: null,
  });
  assert.deepEqual(fake.updates, [
    { tabId: 1, options: { url: questParent.url, active: false } },
  ]);
});

test("rescans a quest source for newly unlocked steps", async () => {
  const questStep = {
    id: "quest-entry-0",
    section: "任务：免费 Spotify 播放列表",
    parentTitle: "免费 Spotify 播放列表",
    title: "在 Bing 上搜索",
    text: "喜欢现场演出？及时获取门票",
    kind: "link",
    url: "https://www.bing.com/?form=ML2X8X",
    disabled: false,
    action: "quest-step",
  };
  const sourceEntry = {
    ...questStep,
    title: "激活优惠",
    source: "quest",
    sourceUrl: "https://rewards.bing.com/earn/quest/spotify",
  };
  const fake = chromeFake(
    { missingSections: [], entries: [] },
    { missingSections: [], entries: [] },
    { missingSections: [], entries: [questStep] },
  );
  fake.seedTab({ id: 99, url: "https://www.bing.com/?form=ML2X8X" });
  const driver = createChromeDriver({
    chromeApi: fake.api,
    delay: async () => {},
    catalogAttempts: 3,
  });

  const refreshed = await driver.refreshQuest(sourceEntry, { targetTabId: 99 });

  assert.deepEqual(refreshed.entries, [{
    ...questStep,
    source: "quest",
    sourceUrl: sourceEntry.sourceUrl,
    questProgress: null,
  }]);
  assert.deepEqual(fake.updates, [
    { tabId: 99, options: { url: sourceEntry.sourceUrl, active: true } },
  ]);
});

test("opens a link in the background and closes it after load", async () => {
  const entry = {
    id: "reward-entry-3-0",
    section: "日常任务",
    title: "古代设计与建造",
    text: "古代设计与建造 +10",
    kind: "link",
    url: "https://www.bing.com/search?q=ancient+design",
    disabled: false,
    source: "earn",
    sourceUrl: "https://rewards.bing.com/earn",
  };
  const fake = chromeFake({ missingSections: [], entries: [entry] });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  const result = await driver.executeLink(entry);

  assert.equal(result.finalUrl, entry.url);
  assert.deepEqual(fake.linkActivations, [{ tabId: 1, entryId: entry.id }]);
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
    { tabId: 99, options: { url: "https://rewards.bing.com/dashboard", active: true } },
  ]);
  assert.equal(result.finalUrl, dashboardEntry.url);
  assert.deepEqual(fake.linkActivations, [
    { tabId: 99, entryId: dashboardEntry.id },
  ]);
  assert.deepEqual(fake.removed, []);
  assert.deepEqual(fake.injections, [
    { tabId: 99, files: ["src/content/floating-widget.js", "src/content/progress-overlay.js"] },
    { tabId: 99, files: ["src/content/floating-widget.js", "src/content/progress-overlay.js"] },
    { tabId: 99, files: ["src/content/floating-widget.js", "src/content/progress-overlay.js"] },
  ]);
});

test("injects the progress panel before a manual run navigates", async () => {
  const fake = chromeFake({ missingSections: [], entries: [] });
  fake.seedTab({ id: 99, url: "https://rewards.bing.com/earn" });
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });

  assert.equal(await driver.showProgress({ targetTabId: 99 }), true);
  assert.deepEqual(fake.injections, [
    { tabId: 99, files: ["src/content/floating-widget.js", "src/content/progress-overlay.js"] },
  ]);
});

test("does not attempt progress injection on stores, internal pages, or unrelated hosts", async () => {
  for (const url of [
    "https://chromewebstore.google.com/detail/example/abc",
    "https://chrome.google.com/webstore/detail/example/abc",
    "https://microsoftedge.microsoft.com/addons/detail/example/abc",
    "edge://extensions/", "chrome://extensions/", "about:blank",
    "https://example.com/", "https://bing.com.example.com/", "http://www.bing.com/",
  ]) {
    const fake = chromeFake({ entries: [], missingSections: [] });
    fake.seedTab({ id: 99, url });
    let attempts = 0;
    fake.api.scripting.executeScript = async () => {
      attempts++;
      throw new Error("The extensions gallery cannot be scripted.");
    };
    const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });
    assert.equal(await driver.showProgress({ targetTabId: 99 }), false);
    assert.equal(attempts, 0, url);
  }
});

test("waits for the committed Rewards page when navigating away from an extension store", async () => {
  for (const withPendingUrl of [true, false]) {
    const fake = chromeFake({ entries: [], missingSections: [] });
    fake.seedTab({ id: 99, url: "https://microsoftedge.microsoft.com/addons/" });
    const listeners = new Set();
    fake.api.tabs.onUpdated = {
      addListener: listener => listeners.add(listener),
      removeListener: listener => listeners.delete(listener),
    };
    const update = fake.api.tabs.update;
    fake.api.tabs.update = async (tabId, options) => {
      const oldTab = await fake.api.tabs.get(tabId);
      // tabs.update may finish before the old completed document is replaced.
      fake.seedTab({ ...oldTab, ...(withPendingUrl ? { pendingUrl: options.url } : {}) });
      setImmediate(async () => {
        await update(tabId, options);
        fake.seedTab({ id: tabId, url: options.url });
        const loaded = await fake.api.tabs.get(tabId);
        for (const listener of [...listeners]) listener(tabId, { status: "complete" }, loaded);
      });
      return oldTab;
    };
    const execute = fake.api.scripting.executeScript;
    const injectedUrls = [];
    fake.api.scripting.executeScript = async options => {
      const tab = await fake.api.tabs.get(options.target.tabId);
      injectedUrls.push(tab.url);
      if (!tab.url.startsWith("https://rewards.bing.com/")) {
        throw new Error("The extensions gallery cannot be scripted.");
      }
      return execute(options);
    };
    const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {}, timeoutMs: 500, catalogAttempts: 2 });
    const catalog = await driver.loadCatalog({ targetTabId: 99 });
    assert.deepEqual(catalog.entries, []);
    assert.ok(injectedUrls.length > 0);
    assert.ok(injectedUrls.every(url => url.startsWith("https://rewards.bing.com/")));
    assert.deepEqual(fake.removed, []);
    assert.equal(listeners.size, 0);
  }
});

test("does not collect page data after a redirect to the Microsoft sign-in page", async () => {
  const fake = chromeFake({ entries: [], missingSections: [] });
  fake.seedTab({ id: 99, url: "https://www.bing.com/" });
  fake.api.tabs.update = async tabId => {
    const tab = { id: tabId, status: "complete", url: "https://login.live.com/login.srf" };
    fake.seedTab(tab);
    return tab;
  };
  let attempts = 0;
  fake.api.scripting.executeScript = async () => { attempts++; throw new Error("Cannot access contents of url"); };
  const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {} });
  await assert.rejects(driver.loadCatalog({ targetTabId: 99 }), /SCRIPTING_PAGE_UNSUPPORTED/);
  assert.equal(attempts, 0);
});

test("observes a fast navigation that redirects back to the previous localized URL", async () => {
  const fake = chromeFake({ entries: [], missingSections: [] });
  const localizedUrl = "https://rewards.bing.com/earn/?cc=cn";
  fake.seedTab({ id: 99, url: localizedUrl });
  const listeners = new Set();
  fake.api.tabs.onUpdated = {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
  };
  fake.api.tabs.update = async tabId => {
    const loaded = { id: tabId, status: "complete", url: localizedUrl };
    fake.seedTab(loaded);
    for (const listener of [...listeners]) listener(tabId, { status: "complete" }, loaded);
    return loaded;
  };
  const driver = createChromeDriver({ chromeApi: fake.api, timeoutMs: 80 });
  assert.equal((await driver.restore({ targetTabId: 99 })).url, localizedUrl);
  assert.equal(listeners.size, 0);
});

test("removes navigation listeners when the browser rejects a tab update", async () => {
  const fake = chromeFake({ entries: [], missingSections: [] });
  fake.seedTab({ id: 99, url: "https://chromewebstore.google.com/" });
  const listeners = new Set();
  fake.api.tabs.onUpdated = fake.api.tabs.onRemoved = {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
  };
  fake.api.tabs.update = async () => { throw new Error("TAB_UPDATE_FAILED"); };
  const driver = createChromeDriver({ chromeApi: fake.api, timeoutMs: 80 });
  await assert.rejects(driver.restore({ targetTabId: 99 }), /TAB_UPDATE_FAILED/);
  assert.equal(listeners.size, 0);
  assert.deepEqual(fake.injections, []);
});

test("solves a puzzle after the source card click and preserves its verified result", async () => {
  const entry = { id: "puzzle", section: "每日活动", title: "拼图", text: "拼图 +5", kind: "link", url: "https://www.bing.com/spotlight/imagepuzzle", source: "dashboard", sourceUrl: "https://rewards.bing.com/dashboard" };
  const fake = chromeFake({ entries: [], missingSections: [] }, { entries: [entry], missingSections: [] });
  const execute = fake.api.scripting.executeScript;
  const solvers = [];
  fake.api.scripting.executeScript = async (options) => {
    if (options.func?.name === "solveImagePuzzle") { solvers.push(options.target.tabId); return [{ result: { solved: true, moves: 15 } }]; }
    return execute(options);
  };
  const result = await createChromeDriver({ chromeApi: fake.api, delay: async () => {} }).executeLink(entry);
  assert.equal(solvers.length, 1);
  assert.equal(result.reason, "PUZZLE_COMPLETED");
  assert.equal(result.puzzleMoves, 15);
});

test("claims are successful only after the pending balance decreases", async () => {
  const entry = { id: "claim", section: "待领取积分", title: "领取待领取积分", text: "可领取 30 领取", kind: "button", action: "claim-points", rewardPoints: 30, source: "dashboard", sourceUrl: "https://rewards.bing.com/dashboard" };
  for (const remaining of [0, 30, null]) {
    const fake = chromeFake({ entries: [], missingSections: [] }, { entries: [entry], missingSections: [] });
    const execute = fake.api.scripting.executeScript;
    let clicked = false;
    fake.api.scripting.executeScript = async (options) => {
      if (options.func?.name === "activateRewardsButton") clicked = true;
      if (clicked && options.func?.name === "collectDashboardEntries") return [{ result: { entries: [], missingSections: [], claimablePoints: remaining } }];
      return execute(options);
    };
    const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {}, catalogAttempts: 2 });
    if (remaining === 0) {
      const result = await driver.executeButton(entry);
      assert.equal(result.reason, "POINTS_CLAIMED");
      assert.equal(result.claimedPoints, 30);
    } else {
      await assert.rejects(driver.executeButton(entry), /CLAIM_NOT_CONFIRMED/);
    }
    assert.deepEqual(fake.removed, [1]);
  }
});

test("final dashboard scan waits for a known balance instead of accepting a loading shell", async () => {
  for (const eventualBalance of [25, 0, null]) {
    const fake = chromeFake({ entries: [], missingSections: [] });
    let reads = 0;
    fake.api.scripting.executeScript = async () => [{ result: {
      entries: [], missingSections: [], claimablePoints: ++reads > 3 ? eventualBalance : null,
    } }];
    const driver = createChromeDriver({ chromeApi: fake.api, delay: async () => {}, catalogAttempts: 6 });
    if (eventualBalance === null) await assert.rejects(driver.refreshDashboard(), /CLAIM_BALANCE_UNAVAILABLE/);
    else assert.equal((await driver.refreshDashboard()).claimablePoints, eventualBalance);
    assert.ok(reads >= 4);
    assert.deepEqual(fake.removed, [1]);
  }
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
    { tabId: 99, files: ["src/content/floating-widget.js", "src/content/progress-overlay.js"] },
  ]);
});

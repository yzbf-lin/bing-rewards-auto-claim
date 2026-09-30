import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { collectDashboardEntries, activateRewardsButton } from "../src/content/page-actions.js";
import { solveImagePuzzle } from "../src/content/image-puzzle.js";

const source = await readFile(
  new URL("../userscript/bing-rewards-auto-claim.user.js", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

function loadRuntime(overrides = {}) {
  const context = vm.createContext({
    __BING_REWARDS_USERSCRIPT_TEST__: true,
    URL,
    ...overrides,
  });
  vm.runInContext(source, context);
  return { api: context.__BING_REWARDS_USERSCRIPT_API__, context };
}

function loadApi() {
  return loadRuntime().api;
}

test("userscript metadata supports installation and automatic updates", () => {
  const version = source.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
  assert.equal(version, packageJson.version);
  assert.match(source, /^\/\/ @match\s+https:\/\/rewards\.bing\.com\/\*$/m);
  assert.match(source, /^\/\/ @match\s+https:\/\/bing\.com\/\*$/m);
  assert.match(source, /^\/\/ @match\s+https:\/\/www\.bing\.com\/\*$/m);
  assert.match(source, /^\/\/ @match\s+https:\/\/\*\.bing\.com\/\*$/m);
  assert.match(source, /^\/\/ @grant\s+GM_registerMenuCommand$/m);
  assert.match(source, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\//m);
  assert.match(source, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\//m);
});

test("userscript uses live progress instead of partial completion wording", () => {
  const api = loadApi();
  const result = api.classifyEntry({
    section: "连续打卡任务",
    title: "每日连续打卡活动",
    text: "已完成连续打卡 1 天，共 7 天。活动: 0/3",
    kind: "button",
    url: null,
    disabled: false,
  });

  assert.equal(result.decision, "SKIPPED");
  assert.equal(result.reason, "COMPLEX_TASK");
});

test("userscript recognizes fully completed visible progress", () => {
  const api = loadApi();
  assert.equal(api.inferCompleted("每日活动 活动: 3/3"), true);
  assert.equal(api.inferCompleted("每日活动 活动: 2/3"), false);
});

test("userscript clicks a daily-activity card even when its URL opens a quiz", () => {
  const api = loadApi();
  const result = api.classifyEntry({
    section: "每日活动",
    title: "艺术叛逆者？",
    text: "测试你对弗里达·卡罗的了解 +10",
    kind: "link",
    url: "https://www.bing.com/search?q=Frida&form=dsetqu&filters=BingQA_QuizLanding_Layout",
    disabled: false,
  });

  assert.equal(result.decision, "ELIGIBLE");
  assert.equal(result.reason, "KNOWN_ONE_STEP_REWARD");
});

test("userscript accepts a daily task with a plain numeric points badge", () => {
  const api = loadApi();
  const result = api.classifyEntry({
    section: "日常任务",
    title: "設定目標",
    text: "設定第一個目標就可以賺取 100 點！ 5",
    rewardPoints: 5,
    kind: "link",
    url: "https://rewards.bing.com/redeem/all?FORM=ML16O4",
    disabled: false,
    signals: {
      opensNewTab: true,
      hasRewardBadge: true,
      completed: false,
    },
  });

  assert.equal(result.decision, "ELIGIBLE");
  assert.equal(result.reason, "FEATURE_MATCHED_ONE_STEP");
  assert.equal(result.rewardPoints, 5);
});

test("userscript keeps a non-daily interactive quiz as a manual task", () => {
  const api = loadApi();
  const result = api.classifyEntry({
    section: "任务",
    title: "艺术知识测验",
    text: "回答三道题 +10",
    kind: "link",
    url: "https://www.bing.com/search?q=art&form=dsetqu",
    disabled: false,
  });

  assert.equal(result.reason, "INTERACTIVE_QUIZ");
});

test("userscript recognizes Spotlight puzzles for actual solving", () => {
  const result = loadApi().classifyEntry({ section: "每日活动", title: "拼图", text: "拼图 +5", kind: "link", url: "https://www.bing.com/spotlight/imagepuzzle" });
  assert.equal(result.decision, "ELIGIBLE");
  assert.equal(result.reason, "IMAGE_PUZZLE");
});

test("userscript keeps a traditional-Chinese install card as a manual task", () => {
  const api = loadApi();
  const result = api.classifyEntry({
    section: "日常任务",
    title: "瀏覽器裡的 Rewards",
    text: "安裝最新的瀏覽器擴充功能，並賺取 10 點積分。",
    kind: "link",
    url: "https://www.bing.com/set/browserextension/rewards",
    disabled: false,
  });

  assert.equal(result.decision, "SKIPPED");
  assert.equal(result.reason, "COMPLEX_TASK");
});

test("userscript accepts Rewards redirects that add locale parameters", () => {
  const api = loadApi();
  assert.equal(
    api.urlsMatchPage(
      "https://rewards.bing.com/earn/?cc=cn",
      "https://rewards.bing.com/earn",
    ),
    true,
  );
  assert.equal(
    api.urlsMatchPage(
      "https://rewards.bing.com/dashboard?cc=cn&section=dailyset",
      "https://rewards.bing.com/dashboard?section=dailyset",
    ),
    true,
  );
});

test("userscript clicks the original card link instead of navigating directly", () => {
  const attributes = new Map([
    ["data-rewards-auto-id", "daily-ancient-design"],
    ["target", "_blank"],
  ]);
  const element = {
    tagName: "A",
    href: "https://www.bing.com/search?q=ancient+design",
    clicked: false,
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    click() {
      this.clicked = true;
    },
  };
  const { api } = loadRuntime({
    document: {
      querySelector: () => element,
    },
  });

  assert.deepEqual(
    { ...api.activateRewardsLink("daily-ancient-design") },
    { activated: true, url: element.href },
  );
  assert.equal(element.clicked, true);
  assert.equal(attributes.get("target"), "_self");
});

test("userscript adds a newly unlocked quest step after rescanning", () => {
  const api = loadApi();
  const sourceEntry = {
    source: "quest",
    sourceUrl: "https://rewards.bing.com/earn/quest/spotify",
  };
  const first = {
    section: "任务：免费 Spotify 播放列表",
    title: "激活优惠",
    kind: "link",
    url: "https://www.bing.com/?form=ML2X8X",
    source: "quest",
    sourceUrl: sourceEntry.sourceUrl,
  };
  const second = {
    ...first,
    title: "在 Bing 上搜索",
  };

  const discovered = api.findNewQuestEntries([first], [first, second], sourceEntry);

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].title, "在 Bing 上搜索");
  assert.equal(discovered[0].source, "quest");
});

test("userscript detects a clicked quest step whose progress did not advance", () => {
  const api = loadApi();
  assert.equal(api.questProgressAdvanced(1, 1), false);
  assert.equal(api.questProgressAdvanced(1, 2), true);
  assert.equal(api.questProgressAdvanced(undefined, 1), true);
});

test("userscript panel includes structured run logs", () => {
  assert.match(source, /data-role="logs"/);
  assert.match(source, /QUEST_RESCANNED/);
  assert.match(source, /CARD_CLICK/);
});

test("standalone userscript keeps injected page actions identical to the extension", () => {
  const api = loadApi();
  const normalized = (fn) => fn.toString().replace(/\s+/g, " ").trim();
  for (const fn of [collectDashboardEntries, activateRewardsButton, solveImagePuzzle]) {
    assert.equal(normalized(api[fn.name]), normalized(fn));
  }
});

test("standalone userscript keeps the floating widget identical to the extension", async () => {
  const widgetSource = await readFile(new URL("../src/content/floating-widget.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(widgetSource, context);
  const normalized = (fn) => fn.toString().replace(/\s+/g, " ").trim();
  assert.equal(normalized(loadApi().createRewardsFloatingWidget), normalized(context.createRewardsFloatingWidget));
});

function claimRuntime({ points = 30, unknownReads = 0, confirmText = "领取积分", claimedBalance = 0, store = new Map(), tabData = {}, location = { href: "https://rewards.bing.com/dashboard" } } = {}) {
  let balance = points;
  let clicks = 0;
  let confirmClicks = 0;
  let reads = 0;
  const attributes = new Map();
  const card = {
    tagName: "BUTTON", parentElement: null,
    get innerText() { return `可领取 ${balance} 领取`; },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    hasAttribute: (name) => attributes.has(name),
    querySelector: () => null,
    querySelectorAll: () => [],
    click() { clicks++; },
  };
  const confirm = {
    tagName: "BUTTON", innerText: confirmText,
    closest: (selector) => selector.includes("dialog") ? {} : null,
    getAttribute: () => null, hasAttribute: () => false,
    click() { confirmClicks++; balance = claimedBalance; },
  };
  const document = {
    getElementById: () => null,
    querySelector: (selector) => selector.includes('data-rewards-auto-id') ? card : null,
    querySelectorAll: (selector) => selector === "a[href], button" ? (++reads > unknownReads ? [card] : []) : selector === "button" && clicks ? [confirm] : [],
  };
  location.assign = (url) => { location.href = url; };
  const overrides = {
    document, location, window: { location, open() {} },
    GM_getValue: (key, fallback) => store.has(key) ? structuredClone(store.get(key)) : fallback,
    GM_setValue: (key, value) => store.set(key, structuredClone(value)),
    GM_getTab: (callback) => callback(structuredClone(tabData)),
    GM_saveTab: (value) => Object.assign(tabData, structuredClone(value)),
    setTimeout: (callback) => { callback(); return 1; },
    console: { info() {}, warn() {} },
  };
  const runtime = loadRuntime(overrides);
  const ready = runtime.api.initializeTabIdentity();
  return { ...runtime, ready, store, tabData, location, get clicks() { return clicks; }, get confirmClicks() { return confirmClicks; } };
}

test("userscript final claim confirms a card containing the amount and pending badge", async () => {
  const runtime = claimRuntime({ points: 3, confirmText: "3\n\n待领取\n\n领取积分" });
  await runtime.ready;
  const state = runtime.api.createRun("manual");
  state.phase = "rescan-dashboard";
  await runtime.api.resumePhase(state);
  assert.equal(runtime.clicks, 1);
  assert.equal(runtime.confirmClicks, 1);
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].reason, "POINTS_CLAIMED");
  assert.equal(state.results[0].outcome, "COMPLETED");
});

test("userscript card confirmation still fails when the claim balance does not decrease", async () => {
  const runtime = claimRuntime({ points: 3, confirmText: "3\n待领取\n领取积分", claimedBalance: 3 });
  await runtime.ready;
  const state = runtime.api.createRun("manual");
  state.phase = "rescan-dashboard";
  await runtime.api.resumePhase(state);
  assert.equal(runtime.confirmClicks, 1);
  assert.equal(state.results[0].reason, "CLAIM_NOT_CONFIRMED");
  assert.equal(state.results[0].outcome, "FAILED");
});

test("userscript resumes its final dashboard scan after navigation and claims only once", async () => {
  const location = { href: "https://www.bing.com/search?q=last-task" };
  const first = claimRuntime({ location });
  await first.ready;
  const state = first.api.createRun("automatic");
  state.phase = "execute";
  // A prior successful claim today must not suppress a new positive balance.
  first.store.set("bingRewardsAutoClaimMemory", {
    "dashboard|button|领取待领取积分|": { lastCompletedDate: first.api.beijingDateKey(new Date(state.startedAt)) },
  });
  await first.api.executeCatalog(state);
  assert.equal(state.phase, "rescan-dashboard");
  assert.equal(location.href, "https://rewards.bing.com/dashboard");
  assert.equal(first.clicks, 0);

  const next = claimRuntime({ location, store: first.store, tabData: first.tabData });
  await next.ready;
  const restored = next.store.get("bingRewardsAutoClaimState");
  await next.api.resumePhase(restored);
  assert.equal(restored.results.length, 1);
  assert.equal(restored.results[0].reason, "POINTS_CLAIMED");
  assert.equal(next.clicks, 1);
  assert.equal(restored.claimsRefreshed, true);
  assert.equal(restored.phase, "returning");
  assert.equal(location.href, "https://rewards.bing.com/earn");
  await next.api.resumePhase(restored);
  assert.equal(restored.status, "completed");
  assert.equal(next.clicks, 1);
});

test("userscript does not turn a restored unconfirmed claim into success", async () => {
  const runtime = claimRuntime();
  await runtime.ready;
  const state = runtime.api.createRun("manual");
  const entry = { ...runtime.api.collectDashboardEntries().entries[0], source: "dashboard", sourceUrl: runtime.location.href };
  state.catalog = [entry];
  state.pending = { entry, recognition: runtime.api.classifyEntry(entry), startedAt: Date.now(), claimBefore: 30 };
  state.phase = "verify-claim";
  state.claimsRefreshed = true;
  await runtime.api.resumePhase(state);
  assert.equal(state.results[0].outcome, "FAILED");
  assert.equal(state.results[0].reason, "CLAIM_NOT_CONFIRMED");
  assert.equal(runtime.clicks, 0);
});

test("userscript final scan waits for the claim balance to hydrate", async () => {
  const runtime = claimRuntime({ unknownReads: 3 });
  await runtime.ready;
  const state = runtime.api.createRun("manual");
  state.phase = "rescan-dashboard";
  await runtime.api.resumePhase(state);
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].reason, "POINTS_CLAIMED");
  assert.equal(runtime.clicks, 1);
});

test("userscript reports an unavailable balance instead of assuming there is nothing to claim", async () => {
  const runtime = claimRuntime({ unknownReads: Infinity });
  await runtime.ready;
  const state = runtime.api.createRun("manual");
  state.phase = "rescan-dashboard";
  await assert.rejects(runtime.api.resumePhase(state), /CLAIM_BALANCE_UNAVAILABLE/);
  assert.equal(runtime.clicks, 0);
});

test("userscript preserves verified puzzle completion after Bing redirects away", async () => {
  const runtime = claimRuntime({ location: { href: "https://www.bing.com/spotlight?q=finished" } });
  await runtime.ready;
  const state = runtime.api.createRun("manual");
  const entry = { title: "拼图", text: "拼图 +5", kind: "link", url: "https://www.bing.com/spotlight/imagepuzzle", section: "每日活动" };
  state.catalog = [entry];
  state.pending = { entry, recognition: runtime.api.classifyEntry(entry), startedAt: Date.now() };
  state.phase = "puzzle-completed";
  await runtime.api.resumePhase(state);
  assert.equal(state.results[0].outcome, "COMPLETED");
  assert.equal(state.results[0].reason, "PUZZLE_COMPLETED");
  assert.equal(state.phase, "rescan-dashboard");
  assert.equal(runtime.location.href, "https://rewards.bing.com/dashboard");
});

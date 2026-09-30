import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getSearchStreakProgress } from "../src/shared/search-streak.js";
import { activateSearchStreakLink, submitBingSearch } from "../src/content/search-actions.js";

const source = readFileSync(new URL("../userscript/bing-rewards-auto-claim.user.js", import.meta.url), "utf8");
const sourceUrl = "https://rewards.bing.com/earn";
const queryKey = "bingRewardsAutoClaimSearchQuery";
const stateKey = "bingRewardsAutoClaimState";
const candidate = { section: "连续打卡任务", title: "必应搜索连续打卡", text: "必应搜索连续打卡 +3 搜索: 0/1", kind: "link", url: "https://www.bing.com/", source: "earn", sourceUrl };

function runtime({ store = new Map(), tabData = {}, tabApi = true, openTabs, href = sourceUrl, progress = 0, missing = false, wrongCard = false, delayedReads = 0, preventSubmit = false, unloadOnCardNavigation = false, unloadOnSearchNavigation = false, buttonCard = false } = {}) {
  const location = { href, assign(value) { this.href = value; } };
  let unloaded = false;
  const counters = { submissions: 0, clicks: 0, reads: 0, writes: [] };
  const names = ["连续打卡任务", "升级活动", "任务", "日常任务"];
  const attrs = new Map();
  const title = wrongCard ? "每日连续打卡活动" : candidate.title;
  const card = {
    tagName: buttonCard ? "BUTTON" : "A", href: buttonCard ? null : candidate.url,
    get innerText() { return `${title} +3 搜索: ${++counters.reads > delayedReads ? progress : 0}/1`; },
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    hasAttribute(name) { return attrs.has(name); },
    querySelector(selector) { return selector === "img[alt]" ? { getAttribute: () => title } : null; },
    querySelectorAll() { return []; },
    click() { counters.clicks++; if (!buttonCard) location.assign(candidate.url); unloaded = unloadOnCardNavigation; },
  };
  const groups = names.map((name, index) => ({ getAttribute: (key) => key === "aria-label" ? name : null, querySelectorAll: () => !index && !missing ? [card] : [] }));
  card.parentElement = groups[0];
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  class Input {
    constructor() { this.name = "q"; }
    set value(value) { this.content = value; }
    get value() { return this.content; }
    matches() { return false; }
    hasAttribute() { return false; }
    getAttribute() { return null; }
    closest() { return null; }
    getClientRects() { return [{}]; }
    dispatchEvent() { return true; }
  }
  class Form {
    constructor() { this.action = "https://www.bing.com/search"; this.method = "get"; }
    checkValidity() { return true; }
    setAttribute() {}
    requestSubmit() {
      counters.submissions++;
      const saved = store.get(stateKey);
      assert.equal(saved.phase, "search-streak-wait", "state must be saved before navigation");
      assert.equal(saved.pending.searchSubmitted, true);
      if (!preventSubmit) {
        location.assign(`https://www.bing.com/search?q=${encodeURIComponent(field.value)}`);
        unloaded = unloadOnSearchNavigation;
      }
    }
  }
  const field = new Input();
  field.form = new Form();
  const document = {
    readyState: "complete",
    defaultView: { HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLFormElement: Form, Event: FakeEvent, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) },
    getElementById() { return null; },
    querySelector(selector) { return selector.includes("data-rewards-auto-id") ? card : null; },
    querySelectorAll(selector) {
      if (selector.includes("sb_form_q")) return [field];
      if (selector === "h2") return names.map((textContent) => ({ textContent }));
      if (selector === '[role="group"]') return groups;
      return [];
    },
  };
  const context = vm.createContext({
    __BING_REWARDS_USERSCRIPT_TEST__: true, URL, document, location, window: { location, open() {} },
    GM_getValue(key, fallback) { return store.has(key) ? structuredClone(store.get(key)) : fallback; },
    GM_setValue(key, value) { store.set(key, structuredClone(value)); counters.writes.push({ key, value: structuredClone(value) }); },
    ...(tabApi ? {
      GM_getTab(callback) { callback(structuredClone(tabData)); },
      GM_saveTab(value) { Object.assign(tabData, structuredClone(value)); },
      GM_getTabs(callback) { callback(structuredClone(openTabs ?? { current: tabData })); },
    } : {}),
    setTimeout(callback) { if (unloaded) throw new Error("DOCUMENT_UNLOADED"); callback(); return 1; }, console: { info() {}, warn() {} },
  });
  vm.runInContext(source, context);
  const api = context.__BING_REWARDS_USERSCRIPT_API__;
  const ready = api.initializeTabIdentity?.() ?? Promise.resolve();
  ready.catch(() => {});
  return { api, store, tabData, ready, location, counters, field, document };
}

function pendingRun(rt, phase = "search-streak-submit") {
  const state = rt.api.createRun("manual");
  state.catalog = [candidate];
  state.claimsRefreshed = true;
  state.pending = { entry: candidate, recognition: { reason: "SEARCH_STREAK", decision: "ELIGIBLE", rewardPoints: 3 }, startedAt: Date.now(), searchQuery: "aurora forecast" };
  state.phase = phase;
  rt.store.set(stateKey, structuredClone(state));
  return state;
}

test("userscript embeds the same search recognition and native submission helpers", () => {
  const { api } = runtime();
  for (const helper of [getSearchStreakProgress, submitBingSearch, activateSearchStreakLink]) {
    assert.equal(api[helper.name]?.toString().replace(/\s+/g, " "), helper.toString().replace(/\s+/g, " "));
  }
  assert.equal(api.classifyEntry(candidate).reason, "SEARCH_STREAK");
  assert.equal(api.classifyEntry({ ...candidate, text: "搜索: 1/1 连续 3/7 天", signals: { completed: false } }).reason, "COMPLETED");
});

test("empty and malformed saved queries skip search without interrupting the run", async () => {
  for (const [query, reason] of [["  ", "SEARCH_QUERY_REQUIRED"], ["x".repeat(201), "SEARCH_QUERY_INVALID"], ["one\ntwo", "SEARCH_QUERY_INVALID"]]) {
    const rt = runtime({ store: new Map([[queryKey, query]]) });
    const state = rt.api.createRun("manual");
    state.catalog = [candidate];
    state.claimsRefreshed = true;
    await rt.api.executeCatalog(state);
    assert.equal(state.results[0]?.reason, reason);
    assert.equal(state.results[0]?.outcome, "SKIPPED");
    assert.equal(rt.counters.clicks, 0);
    assert.equal(rt.counters.submissions, 0);
  }
});

test("a button-based streak waits for its dialog instead of submitting a search on Rewards", async () => {
  const rt = runtime({ buttonCard: true, store: new Map([[queryKey, "aurora forecast"]]) });
  const state = rt.api.createRun("manual");
  state.catalog = [{ ...candidate, kind: "button", url: null }];
  state.claimsRefreshed = true;
  await rt.api.executeCatalog(state);
  assert.equal(rt.counters.clicks, 1);
  assert.equal(rt.counters.submissions, 0);
  assert.equal(state.results[0]?.reason, "SEARCH_STREAK_LINK_UNAVAILABLE");
});

test("saved query survives the card navigation and only verified progress completes the task", async () => {
  const first = runtime({ store: new Map([[queryKey, "  aurora forecast  "]]), unloadOnCardNavigation: true });
  const state = first.api.createRun("automatic");
  state.catalog = [candidate]; state.claimsRefreshed = true;
  await assert.rejects(first.api.executeCatalog(state), /DOCUMENT_UNLOADED/);
  assert.equal(first.counters.clicks, 1);
  const persisted = first.store.get(stateKey);
  assert.equal(persisted.phase, "execute-link-wait");
  assert.equal(persisted.pending.searchQuery, "aurora forecast");

  const search = runtime({ store: first.store, tabData: first.tabData, href: candidate.url, unloadOnSearchNavigation: true });
  await assert.rejects(search.api.resumePhase(persisted), /DOCUMENT_UNLOADED/);
  assert.equal(search.counters.submissions, 1);
  assert.equal(persisted.phase, "search-streak-wait");
  assert.equal(persisted.results.length, 0);

  const results = runtime({ store: first.store, tabData: first.tabData, href: search.location.href });
  await results.api.resumePhase(results.store.get(stateKey));
  assert.equal(results.location.href, sourceUrl);
  assert.equal(results.counters.submissions, 0);

  const verify = runtime({ store: first.store, tabData: first.tabData, progress: 1, delayedReads: 3 });
  const restored = verify.store.get(stateKey);
  await verify.api.resumePhase(restored);
  assert.equal(restored.results[0].reason, "SEARCH_STREAK_COMPLETED");
  assert.equal(restored.results[0].outcome, "COMPLETED");
  assert.equal(verify.counters.submissions, 0);
  assert.doesNotMatch(JSON.stringify(restored.logs), /aurora forecast/);
});

test("reloading after submission never submits again on results or the source page", async () => {
  for (const href of ["https://www.bing.com/search?q=aurora%20forecast", sourceUrl]) {
    const rt = runtime({ href, progress: 1 });
    const state = pendingRun(rt, "search-streak-wait"); state.pending.searchSubmitted = true;
    await rt.api.resumePhase(state);
    if (state.pending) await rt.api.resumePhase(state);
    assert.equal(state.results[0]?.reason, "SEARCH_STREAK_COMPLETED");
    assert.equal(rt.counters.submissions, 0);
  }
});

test("unchanged, absent or unrelated completed cards never verify this search streak", async () => {
  for (const options of [{ progress: 0 }, { missing: true }, { progress: 1, wrongCard: true }]) {
    const rt = runtime(options);
    const state = pendingRun(rt, "search-streak-verify"); state.pending.searchSubmitted = true;
    await rt.api.resumePhase(state);
    assert.equal(state.results[0]?.reason, "SEARCH_STREAK_NOT_CONFIRMED");
    assert.equal(state.results[0]?.outcome, "FAILED");
    assert.equal(rt.counters.submissions, 0);
  }
});

test("rechecking a now-completed source card avoids a search", async () => {
  const rt = runtime({ progress: 1 });
  const state = pendingRun(rt, "execute-link");
  await rt.api.resumePhase(state);
  assert.equal(state.results[0]?.reason, "SEARCH_STREAK_COMPLETED");
  assert.equal(rt.counters.clicks, 0);
  assert.equal(rt.counters.submissions, 0);
});

test("a prevented search submission is reported without retry or a false success", async () => {
  const rt = runtime({ href: candidate.url, preventSubmit: true });
  const state = pendingRun(rt);
  await rt.api.resumePhase(state);
  assert.equal(rt.counters.submissions, 1);
  assert.equal(state.results[0]?.outcome, "FAILED");
  assert.equal(state.results[0]?.reason, "SEARCH_SUBMIT_NOT_CONFIRMED");
});

test("a run from a previous Beijing date cannot submit a search for the new date", async () => {
  const rt = runtime({ href: candidate.url });
  const state = pendingRun(rt);
  state.startedAt = "2026-01-01T00:00:00Z";
  await rt.api.resumePhase(state);
  assert.equal(state.results[0]?.reason, "SEARCH_STREAK_DATE_CHANGED");
  assert.equal(rt.counters.submissions, 0);
});

test("tab identity persists across documents and requires the Tampermonkey tab APIs", async () => {
  assert.ok(/^\/\/ @grant\s+GM_getTab$/m.test(source));
  assert.ok(/^\/\/ @grant\s+GM_saveTab$/m.test(source));
  const first = runtime();
  await first.ready;
  const owner = first.api.createRun("manual").ownerTabId;
  assert.equal(typeof owner, "string");
  assert.ok(owner);
  const next = runtime({ tabData: first.tabData });
  await next.ready;
  assert.equal(next.api.createRun("manual").ownerTabId, owner);
  const other = runtime();
  await other.ready;
  assert.notEqual(other.api.createRun("manual").ownerTabId, owner);
  const unavailable = runtime({ tabApi: false });
  await assert.rejects(unavailable.ready, /TAB_IDENTITY_UNAVAILABLE/);
  assert.throws(() => unavailable.api.createRun("manual"), /TAB_IDENTITY_UNAVAILABLE/);
});

test("another Bing tab cannot resume the run or overwrite the owner's submitted state", async () => {
  const first = runtime({ href: candidate.url, unloadOnSearchNavigation: true });
  const state = pendingRun(first, "execute-link-wait");
  const stale = structuredClone(state);
  const other = runtime({ store: first.store, href: candidate.url, unloadOnSearchNavigation: true });
  await Promise.allSettled([first.api.resumePhase(state), other.api.resumePhase(stale)]);
  assert.equal(first.counters.submissions, 1);
  assert.equal(other.counters.submissions, 0);
  assert.equal(other.counters.writes.length, 0);
  assert.equal(first.store.get(stateKey).pending.searchSubmitted, true);
});

test("a stale same-tab snapshot adopts the persisted submission and cannot submit twice", async () => {
  const first = runtime({ href: candidate.url, unloadOnSearchNavigation: true });
  const state = pendingRun(first, "execute-link-wait");
  const stale = structuredClone(state);
  await assert.rejects(first.api.resumePhase(state), /DOCUMENT_UNLOADED/);
  const next = runtime({ store: first.store, tabData: first.tabData, href: first.location.href });
  await next.api.resumePhase(stale);
  assert.equal(next.counters.submissions, 0);
  assert.equal(next.store.get(stateKey).phase, "search-streak-verify");
});

test("a canceled submission on an already matching results page is not a new navigation", async () => {
  const rt = runtime({ href: "https://www.bing.com/search?q=aurora%20forecast", preventSubmit: true, progress: 1 });
  const state = pendingRun(rt);
  await rt.api.resumePhase(state);
  if (state.pending) await rt.api.resumePhase(state);
  assert.equal(rt.counters.submissions, 1);
  assert.equal(state.results[0]?.outcome, "FAILED");
  assert.equal(state.results[0]?.reason, "SEARCH_SUBMIT_NOT_CONFIRMED");
});

test("an ownerless legacy run cannot automatically resume in a newly opened tab", async () => {
  const rt = runtime({ href: candidate.url });
  const state = pendingRun(rt, "execute-link-wait");
  delete state.ownerTabId;
  rt.store.set(stateKey, structuredClone(state));
  await rt.api.resumePhase(state);
  assert.equal(rt.counters.submissions, 0);
  assert.equal(rt.counters.writes.length, 0);
});

test("overlapping same-tab snapshots preserve the persisted waiting phase after one submission", async () => {
  const rt = runtime({ href: candidate.url, unloadOnSearchNavigation: true });
  const state = pendingRun(rt, "execute-link-wait");
  await Promise.allSettled([rt.api.resumePhase(state), rt.api.resumePhase(structuredClone(state))]);
  assert.equal(rt.counters.submissions, 1);
  assert.equal(rt.store.get(stateKey).phase, "search-streak-wait");
});

test("manual restart is available only after the original owner tab has closed", async () => {
  assert.ok(/^\/\/ @grant\s+GM_getTabs$/m.test(source));
  const first = runtime();
  const state = pendingRun(first);
  const tabs = { original: first.tabData };
  const next = runtime({ store: first.store, openTabs: tabs });
  assert.equal(await next.api.canRestartRun?.(state), false);
  delete tabs.original;
  assert.equal(await next.api.canRestartRun?.(state), true);
  assert.equal(await next.api.canRestartRun?.({ ...state, ownerTabId: null }), true);
  assert.equal(next.counters.submissions, 0);
  assert.equal(next.counters.writes.length, 0);
});

test("userscript does not search again for another source copy after unconfirmed progress", async () => {
  const rt = runtime({ store: new Map([[queryKey, "aurora forecast"]]) });
  const state = pendingRun(rt, "search-streak-verify");
  state.pending.searchSubmitted = true;
  state.searchStreakAttempted = true;
  state.catalog.push({ ...candidate, source: "dashboard" });
  await rt.api.resumePhase(state);
  assert.equal(state.results[0].reason, "SEARCH_STREAK_NOT_CONFIRMED");
  assert.equal(state.results[1].reason, "SEARCH_STREAK_ALREADY_ATTEMPTED");
  assert.equal(state.results[1].outcome, "SKIPPED");
  assert.equal(rt.counters.submissions, 0);
});

test("userscript settings restore, save trimmed text and clear the stored query", () => {
  const rt = runtime({ store: new Map([[queryKey, "原搜索词"]]) });
  let submit;
  const input = { value: "" };
  const feedback = { textContent: "" };
  const form = { addEventListener(_type, listener) { submit = listener; } };
  const controls = { '[data-role="search-query"]': input, '[data-role="search-settings-form"]': form, '[data-role="search-settings-feedback"]': feedback };
  rt.api.bindSearchSettings({ querySelector: selector => controls[selector] });
  assert.equal(input.value, "原搜索词");
  input.value = "  <b>星空</b>  ";
  submit({ preventDefault() {} });
  assert.equal(rt.store.get(queryKey), "<b>星空</b>");
  assert.match(feedback.textContent, /已保存/);
  input.value = " ";
  submit({ preventDefault() {} });
  assert.equal(rt.store.get(queryKey), "");
  assert.match(feedback.textContent, /跳过/);
  input.value = "x".repeat(201);
  submit({ preventDefault() {} });
  assert.equal(rt.store.get(queryKey), "");
  assert.match(feedback.textContent, /200/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  normalizeDailySearchProgress, createDailySearchDelay, selectDailySearchQuery, collectDailySearchTerms,
} from "../src/shared/daily-search.js";

const source = readFileSync(new URL("../userscript/bing-rewards-auto-claim.user.js", import.meta.url), "utf8");
const stateKey = "bingRewardsAutoClaimState";
const progressKey = "bingRewardsAutoClaimDailySearchProgress";
const homepage = "https://www.bing.com/";
const earn = "https://rewards.bing.com/earn";
let identity = 0;

function runtime({ store = new Map(), tabData = {}, clock = { now: Date.UTC(2026, 9, 19, 3) },
  href = homepage, terms = Array.from({ length: 40 }, (_, index) => `Science headline ${index}`),
  termsReadyAt = 0, resultsReady = true, preventSubmit = false, unloadOnSubmit = true, timeline = [] } = {}) {
  let unloaded = false;
  const location = { href, assign(value) { this.href = value; } };
  const counters = { submissions: 0, delays: [] };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
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
    requestSubmit() { throw new Error("Daily searches must bypass page submit handlers"); }
    submit() {
      counters.submissions++;
      const saved = store.get(stateKey);
      assert.equal(saved.phase, "daily-search-wait", "persist the waiting phase before navigation");
      assert.equal(saved.dailySearch.pendingQuery, field.value);
      assert.ok(saved.dailySearch.pendingId);
      assert.ok(saved.dailySearch.searchDocumentId);
      assert.ok(store.get(progressKey).queries.includes(field.value), "reserve the page query before navigation");
      timeline.push({ at: clock.now, query: field.value });
      if (!preventSubmit) {
        location.assign(`https://www.bing.com/search?q=${encodeURIComponent(field.value)}`);
        unloaded = unloadOnSubmit;
      }
    }
  }
  const field = new Input();
  field.form = new Form();
  const elements = terms.map((textContent) => ({
    textContent, getClientRects: () => [{}], closest: () => null,
    getAttribute: () => null,
  }));
  const document = {
    readyState: "complete",
    defaultView: {
      HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLFormElement: Form,
      Event: FakeEvent, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    },
    getElementById: () => null,
    querySelector: (selector) => selector === "#b_results" && resultsReady ? {} : null,
    querySelectorAll(selector) {
      if (selector.includes("sb_form_q")) return [field];
      if (selector === "h1, h2" || selector === "#b_results h2 a, #b_results h2") return clock.now >= termsReadyAt ? elements : [];
      return [];
    },
  };
  const context = vm.createContext({
    __BING_REWARDS_USERSCRIPT_TEST__: true, URL, document, location,
    window: { location, open() {} }, Date: ClockDate,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    crypto: { randomUUID: () => `daily-search-test-${++identity}` },
    GM_getValue: (key, fallback) => store.has(key) ? structuredClone(store.get(key)) : fallback,
    GM_setValue(key, value) {
      store.set(key, structuredClone(value));
    },
    GM_getTab: (callback) => callback(structuredClone(tabData)),
    GM_saveTab: (value) => Object.assign(tabData, structuredClone(value)),
    setTimeout(callback, milliseconds) {
      if (unloaded) throw new Error("DOCUMENT_UNLOADED");
      counters.delays.push(milliseconds);
      clock.now += milliseconds;
      callback();
      return 1;
    },
    console: { info() {}, warn() {} },
  });
  vm.runInContext(source, context);
  const api = context.__BING_REWARDS_USERSCRIPT_API__;
  const ready = api.initializeTabIdentity();
  return { api, ready, store, tabData, clock, location, counters, timeline };
}

async function start(rt, trigger = "manual") {
  await rt.ready;
  const state = rt.api.createRun(trigger);
  state.phase = "execute";
  state.claimsRefreshed = true;
  rt.store.set(stateKey, structuredClone(state));
  return state;
}

async function expectSubmission(rt, state = rt.store.get(stateKey)) {
  await assert.rejects(rt.api.resumePhase(state), /DOCUMENT_UNLOADED/);
  assert.equal(rt.counters.submissions, 1);
  assert.equal(rt.store.get(stateKey).phase, "daily-search-wait");
}

test("standalone userscript embeds identical self-contained daily search helpers", () => {
  const rt = runtime();
  for (const helper of [normalizeDailySearchProgress, createDailySearchDelay, selectDailySearchQuery, collectDailySearchTerms]) {
    assert.equal(rt.api[helper.name].toString().replace(/\s+/g, " "), helper.toString().replace(/\s+/g, " "));
  }
});

test("daily searches run last, confirm 20 navigations, and preserve random pauses across documents", async () => {
  const first = runtime({ href: "https://rewards.bing.com/dashboard" });
  const state = await start(first);
  await first.api.executeCatalog(state);
  assert.equal(state.phase, "daily-search-open");
  assert.equal(first.location.href, homepage);
  assert.equal(first.counters.submissions, 0);
  let rt = first;
  for (let index = 0; index < 20; index += 1) {
    rt = runtime({ store: rt.store, tabData: rt.tabData, clock: rt.clock, href: rt.location.href, timeline: rt.timeline });
    await expectSubmission(rt);
    assert.equal(rt.store.get(progressKey).completed, index);
    assert.equal(rt.store.get(stateKey).dailySearch.completedSearches, index);
  }
  const last = runtime({ store: rt.store, tabData: rt.tabData, clock: rt.clock, href: rt.location.href, timeline: rt.timeline });
  const restored = last.store.get(stateKey);
  await last.api.resumePhase(restored);
  assert.equal(last.counters.submissions, 0);
  assert.equal(last.location.href, earn);
  assert.equal(restored.phase, "returning");
  assert.equal(restored.results[0].reason, "DAILY_SEARCH_COMPLETED");
  assert.equal(restored.results[0].completedSearches, 20);
  assert.equal(restored.results[0].expectedPoints, 60);
  assert.equal(restored.results[0].pointsVerified, false);
  assert.equal(restored.results[0].rewardPoints, null);
  assert.equal(last.store.get(progressKey).completed, 20);
  assert.ok(last.counters.delays.includes(1800), "let the last result page finish its requests");
  assert.equal(new Set(last.timeline.map(({ query }) => query)).size, 20);
  for (let index = 1; index < last.timeline.length; index += 1) {
    const pause = last.timeline[index].at - last.timeline[index - 1].at;
    assert.ok(pause >= 8000 && pause <= 15000, `unexpected pause ${pause}`);
  }
  await last.api.resumePhase(restored);
  assert.equal(restored.status, "completed");
});

test("manual and automatic runs share the Beijing daily limit", async () => {
  const rt = runtime({ href: earn });
  const state = await start(rt, "automatic");
  const dateKey = rt.api.beijingDateKey();
  rt.store.set(progressKey, { dateKey, completed: 20, queries: ["Previous headline"] });
  await rt.api.executeCatalog(state);
  assert.equal(state.status, "completed");
  assert.equal(state.results[0].reason, "DAILY_SEARCH_ALREADY_COMPLETED");
  assert.equal(state.results[0].completedSearches, 20);
  assert.equal(rt.counters.submissions, 0);
  const manual = rt.api.createRun("manual");
  manual.phase = "execute"; manual.claimsRefreshed = true;
  rt.store.set(stateKey, structuredClone(manual));
  await rt.api.executeCatalog(manual);
  assert.equal(manual.results[0].reason, "DAILY_SEARCH_ALREADY_COMPLETED");
  assert.equal(rt.counters.submissions, 0);
});

test("saved partial progress resumes with its remaining delay and no repeated queries", async () => {
  const rt = runtime();
  const state = await start(rt);
  const dateKey = rt.api.beijingDateKey();
  rt.store.set(progressKey, { dateKey, completed: 7, queries: ["Science headline 20"], nextSearchAt: rt.clock.now + 9000 });
  await assert.rejects(rt.api.executeCatalog(state), /DOCUMENT_UNLOADED/);
  assert.equal(state.dailySearch.completedSearches, 7);
  assert.equal(state.currentStep.index, 7);
  assert.equal(state.currentStep.total, 20);
  assert.ok(rt.counters.delays.includes(9000));
  assert.notEqual(rt.timeline[0].query, "Science headline 20");
  assert.equal(rt.store.get(progressKey).completed, 7);
});

test("result verification requires a new document, matching q, and loaded results", async () => {
  const first = runtime();
  const state = await start(first);
  await assert.rejects(first.api.executeCatalog(state), /DOCUMENT_UNLOADED/);
  for (const options of [
    { href: "https://www.bing.com/search?q=wrong-query" },
    { href: `${first.location.href}&q=another-query` },
    { href: first.location.href, resultsReady: false },
    { href: homepage },
  ]) {
    const store = new Map([...first.store].map(([key, value]) => [key, structuredClone(value)]));
    const rt = runtime({ store, tabData: first.tabData, clock: { now: first.clock.now }, ...options });
    const restored = store.get(stateKey);
    await rt.api.resumePhase(restored);
    assert.equal(rt.counters.submissions, 0);
    assert.equal(store.get(progressKey).completed, 0);
    assert.equal(restored.results[0].reason, "SEARCH_SUBMIT_NOT_CONFIRMED");
  }
  const prevented = runtime({ preventSubmit: true, unloadOnSubmit: false });
  const pending = await start(prevented);
  await prevented.api.executeCatalog(pending);
  assert.equal(prevented.counters.submissions, 1);
  assert.equal(pending.results[0].reason, "SEARCH_SUBMIT_NOT_CONFIRMED");
  assert.equal(prevented.store.get(progressKey).completed, 0);
});

test("reloading a submitted document verifies once and never resubmits the pending query", async () => {
  const first = runtime();
  const state = await start(first);
  await assert.rejects(first.api.executeCatalog(state), /DOCUMENT_UNLOADED/);
  const pendingQuery = first.timeline[0].query;
  const next = runtime({ store: first.store, tabData: first.tabData, clock: first.clock, href: first.location.href, timeline: first.timeline });
  await expectSubmission(next);
  assert.equal(next.store.get(progressKey).completed, 1);
  assert.notEqual(next.timeline[1].query, pendingQuery);
  assert.ok(next.store.get(stateKey).dailySearch.nextSearchAt <= next.clock.now);
});

test("an already persisted confirmation cannot increment twice after an interrupted state write", async () => {
  const first = runtime();
  const state = await start(first);
  await assert.rejects(first.api.executeCatalog(state), /DOCUMENT_UNLOADED/);
  const persisted = first.store.get(stateKey);
  const progress = first.store.get(progressKey);
  progress.completed = 19;
  progress.lastConfirmedSearchId = persisted.dailySearch.pendingId;
  progress.nextSearchAt = first.clock.now + 12000;
  first.store.set(progressKey, progress);
  const next = runtime({ store: first.store, tabData: first.tabData, clock: first.clock, href: first.location.href });
  await expectSubmission(next);
  assert.equal(next.store.get(progressKey).completed, 19);
  assert.equal(next.store.get(stateKey).dailySearch.completedSearches, 19);
});

test("missing page terms stop explicitly while retaining the previous completion count", async () => {
  const rt = runtime({ terms: [] });
  const state = await start(rt);
  const dateKey = rt.api.beijingDateKey();
  rt.store.set(progressKey, { dateKey, completed: 4, queries: ["Earlier headline"] });
  await rt.api.executeCatalog(state);
  assert.equal(state.results[0].reason, "DAILY_SEARCH_TERMS_UNAVAILABLE");
  assert.equal(state.results[0].completedSearches, 4);
  assert.equal(state.results[0].title, "每日搜索 4/20");
  assert.equal(rt.store.get(progressKey).completed, 4);
  assert.equal(rt.counters.submissions, 0);
});

test("daily search waits for homepage terms to hydrate", async () => {
  const clock = { now: Date.UTC(2026, 9, 19, 3) };
  const rt = runtime({ clock, termsReadyAt: clock.now + 1500 });
  const state = await start(rt);
  await assert.rejects(rt.api.executeCatalog(state), /DOCUMENT_UNLOADED/);
  assert.equal(rt.counters.submissions, 1);
  assert.ok(rt.counters.delays.filter((value) => value === 500).length >= 3);
});

test("exhausted results reopen the homepage once and stop when it also has no terms", async () => {
  const first = runtime({ href: "https://www.bing.com/search?q=previous", terms: [] });
  const state = await start(first);
  await first.api.executeCatalog(state);
  assert.equal(first.location.href, homepage);
  assert.equal(state.phase, "daily-search-open");
  assert.equal(state.dailySearch.refillCompletedAt, 0);
  const next = runtime({ store: first.store, tabData: first.tabData, clock: first.clock, href: homepage, terms: [] });
  const restored = next.store.get(stateKey);
  await next.api.resumePhase(restored);
  assert.equal(restored.results[0].reason, "DAILY_SEARCH_TERMS_UNAVAILABLE");
  assert.equal(next.counters.submissions, 0);
  assert.equal(next.location.href, earn);
});

test("a reload after the final confirmation settles and returns without searching again", async () => {
  const rt = runtime({ href: "https://www.bing.com/search?q=last" });
  const state = await start(rt);
  state.phase = "daily-search-completed";
  state.dailySearch = { dateKey: rt.api.beijingDateKey(), completedSearches: 20, startedAt: rt.clock.now };
  rt.store.set(stateKey, structuredClone(state));
  await rt.api.resumePhase(state);
  assert.equal(state.results[0].reason, "DAILY_SEARCH_COMPLETED");
  assert.equal(state.results[0].completedSearches, 20);
  assert.equal(rt.counters.submissions, 0);
  assert.ok(rt.counters.delays.includes(1800));
});

test("daily terms can come from a previous Bing task page before the final phase", async () => {
  const rt = runtime({ href: "https://www.bing.com/search?q=task" });
  const state = await start(rt);
  state.claimsRefreshed = false;
  await rt.api.executeCatalog(state);
  assert.equal(state.phase, "rescan-dashboard");
  assert.ok(state.dailySearchTerms.length >= 20);
  assert.equal(rt.location.href, "https://rewards.bing.com/dashboard");
});

test("date changes during a persisted pause cannot submit or overwrite another day's progress", async () => {
  const rt = runtime();
  const state = await start(rt);
  const dateKey = rt.api.beijingDateKey();
  const saved = { dateKey, completed: 6, queries: ["Earlier headline"], nextSearchAt: Date.UTC(2026, 9, 19, 16, 0, 1) };
  rt.store.set(progressKey, saved);
  rt.clock.now = Date.UTC(2026, 9, 19, 15, 59, 59);
  await rt.api.executeCatalog(state);
  assert.equal(state.results[0].reason, "DAILY_SEARCH_DATE_CHANGED");
  assert.equal(state.results[0].completedSearches, 6);
  assert.equal(rt.counters.submissions, 0);
  assert.deepEqual(rt.store.get(progressKey), saved);
});

test("another tab cannot advance or submit the daily search phase", async () => {
  const first = runtime();
  const state = await start(first);
  await assert.rejects(first.api.executeCatalog(state), /DOCUMENT_UNLOADED/);
  const other = runtime({ store: first.store, href: first.location.href });
  await other.api.resumePhase(other.store.get(stateKey));
  assert.equal(other.counters.submissions, 0);
  assert.equal(other.store.get(progressKey).completed, 0);
});

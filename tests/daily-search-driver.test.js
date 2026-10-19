import test from "node:test";
import assert from "node:assert/strict";
import { createChromeDriver } from "../src/background/chrome-driver.js";

const dateKey = "2026-10-19";
const today = () => new Date("2026-10-19T02:00:00Z");
const terms = Array.from({ length: 30 }, (_, index) => `今日新闻主题 ${index + 1}`);

function setup({ pageTerms = terms, submit, now = today, resultsReady = true } = {}) {
  const tabs = new Map([[99, { id: 99, url: "https://rewards.bing.com/earn", status: "complete" }]]);
  const listeners = Object.fromEntries(["onUpdated", "onRemoved", "onCreated"].map(name => [name, new Set()]));
  const events = Object.fromEntries(Object.entries(listeners).map(([name, handlers]) => [name, {
    addListener: handler => handlers.add(handler), removeListener: handler => handlers.delete(handler),
  }]));
  const created = [], removed = [], updates = [], submissions = [], collections = [], overlays = [], waits = [], progress = [], readinessChecks = [];
  let nextId = 1;
  const fake = {
    created, removed, updates, submissions, collections, overlays, waits, progress, listeners, tabs, readinessChecks,
    emit(name, ...args) { for (const handler of [...listeners[name]]) handler(...args); },
    api: {
      tabs: {
        ...events,
        async create(options) {
          const tab = { id: nextId++, url: options.url, status: "complete" };
          created.push(options); tabs.set(tab.id, tab); return { ...tab };
        },
        async get(id) {
          if (!tabs.has(id)) throw new Error("TAB_CLOSED");
          return { ...tabs.get(id) };
        },
        async update(id, options) {
          if (!tabs.has(id)) throw new Error("TAB_CLOSED");
          const tab = { ...tabs.get(id), ...options, status: "complete" };
          updates.push({ id, ...options }); tabs.set(id, tab);
          fake.emit("onUpdated", id, { status: "complete" }, { ...tab }); return { ...tab };
        },
        async remove(id) { removed.push(id); tabs.delete(id); fake.emit("onRemoved", id); },
      },
      scripting: {
        async executeScript(options) {
          const id = options.target.tabId;
          if (options.files) { overlays.push(id); return [{}]; }
          if (options.func.name === "collectDailySearchTerms") {
            collections.push({ id, url: tabs.get(id).url });
            const result = typeof pageTerms === "function" ? pageTerms(fake) : pageTerms;
            return [{ result: structuredClone(result) }];
          }
          if (options.func.name === "isBingSearchResultsReady") {
            readinessChecks.push({ id, url: tabs.get(id).url });
            return [{ result: typeof resultsReady === "function" ? resultsReady(fake) : resultsReady }];
          }
          assert.equal(options.func.name, "submitBingSearch");
          const query = options.args[0];
          submissions.push({ id, query, options: options.args[1] });
          if (submit) return submit(fake, id, query);
          const tab = { ...tabs.get(id), url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`, status: "complete" };
          tabs.set(id, tab); fake.emit("onUpdated", id, { status: "complete" }, { ...tab });
          return [{ result: { submitted: true } }];
        },
      },
    },
  };
  fake.driver = createChromeDriver({
    chromeApi: fake.api, now, timeoutMs: 30, catalogAttempts: 2,
    delay: async duration => waits.push(duration),
  });
  fake.run = options => fake.driver.runDailySearches({ dateKey, onProgress: async value => progress.push(value), ...options });
  return fake;
}

function assertNoListeners(fake) {
  assert.ok(Object.values(fake.listeners).every(active => active.size === 0));
}

test("confirms twenty distinct native searches in one owned tab and pauses between them", async () => {
  const fake = setup();
  const result = await fake.run();
  assert.deepEqual(result, {
    reason: "DAILY_SEARCH_COMPLETED", completedSearches: 20,
    expectedPoints: 60, pointsVerified: false, rewardPoints: null,
  });
  assert.deepEqual(fake.created, [{ url: "https://www.bing.com/", active: false }]);
  assert.deepEqual(fake.removed, [1]);
  assert.equal(fake.submissions.length, 20);
  assert.equal(new Set(fake.submissions.map(item => item.query)).size, 20);
  assert.ok(fake.submissions.every(item => item.id === 1 && terms.includes(item.query)));
  assert.deepEqual(fake.submissions.map(item => item.options),
    Array.from({ length: 20 }, () => ({ forceFullNavigation: true })));
  const pauses = fake.waits.filter(duration => duration >= 8000);
  assert.equal(pauses.length, 19);
  assert.ok(pauses.every(duration => duration <= 15000));
  assert.equal(fake.waits.at(-1), 1500);
  assert.deepEqual(fake.progress.map(value => value.completed), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(fake.progress[0].queries.length, 1);
  assert.equal(fake.progress.at(-1).queries.length, 20);
  assertNoListeners(fake);
});

test("uses the manual tab, collects its existing terms and restores its overlay after navigation", async () => {
  const fake = setup();
  await fake.run({ targetTabId: 99 });
  assert.deepEqual(fake.created, []);
  assert.deepEqual(fake.removed, []);
  assert.equal(fake.collections[0].url, "https://rewards.bing.com/earn");
  assert.ok(fake.submissions.every(item => item.id === 99));
  assert.ok(fake.overlays.length >= 20);
  assert.ok(fake.overlays.every(id => id === 99));
  assertNoListeners(fake);
});

test("resumes only the remaining same-day searches and never repeats stored terms", async () => {
  const fake = setup();
  await fake.run({ progress: { dateKey, completed: 17, queries: terms.slice(0, 17) } });
  assert.equal(fake.submissions.length, 3);
  assert.ok(fake.submissions.every(item => !terms.slice(0, 17).includes(item.query)));
  assert.deepEqual(fake.progress.map(value => value.completed), [18, 19, 20]);
  assert.equal(fake.waits.filter(duration => duration >= 8000).length, 3);
  assert.equal(fake.waits.at(-1), 1500);
});

test("a completed same-day batch opens no tab and submits nothing", async () => {
  const fake = setup();
  const result = await fake.run({ progress: { dateKey, completed: 20, queries: terms.slice(0, 20) } });
  assert.equal(result.reason, "DAILY_SEARCH_ALREADY_COMPLETED");
  assert.deepEqual(fake.created, []);
  assert.deepEqual(fake.submissions, []);
});

test("replenishes exhausted terms from the search result page", async () => {
  const fake = setup({ pageTerms: fake => fake.submissions.length ? terms : [terms[0]] });
  await fake.run();
  assert.equal(fake.submissions.length, 20);
  assert.equal(new Set(fake.submissions.map(item => item.query)).size, 20);
});

test("missing page terms stop explicitly instead of generating substitute queries", async () => {
  const fake = setup({ pageTerms: [] });
  await assert.rejects(fake.run(), error => error.message === "DAILY_SEARCH_TERMS_UNAVAILABLE" && error.completedSearches === 0);
  assert.deepEqual(fake.submissions, []);
  assert.deepEqual(fake.removed, [1]);
  assertNoListeners(fake);
});

test("a result for another query is never counted", async () => {
  const fake = setup({ submit: async (fake, id) => {
    fake.tabs.set(id, { id, status: "complete", url: "https://www.bing.com/search?q=unrelated" });
    return [{ result: { submitted: true } }];
  } });
  await assert.rejects(fake.run(), error => error.message === "SEARCH_SUBMIT_NOT_CONFIRMED" && error.completedSearches === 0);
  assert.equal(fake.submissions.length, 1);
  assert.deepEqual(fake.progress, []);
  assert.deepEqual(fake.removed, [1]);
  assertNoListeners(fake);
});

test("a completed search URL with an unready or challenge shell is never counted", async () => {
  const fake = setup({ resultsReady: false });
  await assert.rejects(fake.run(), error => error.message === "SEARCH_SUBMIT_NOT_CONFIRMED" && error.completedSearches === 0);
  assert.equal(fake.submissions.length, 1);
  assert.equal(fake.readinessChecks.length, 2);
  assert.deepEqual(fake.progress, []);
  assert.deepEqual(fake.removed, [1]);
  assertNoListeners(fake);
});

test("waits for delayed result hydration before confirming each search", async () => {
  const fake = setup({ resultsReady: fake => fake.readinessChecks.length % 2 === 0 });
  await fake.run();
  assert.equal(fake.readinessChecks.length, 40);
  assert.equal(fake.progress.length, 20);
  assert.equal(fake.waits.filter(duration => duration === 500).length, 20);
  assertNoListeners(fake);
});

test("a failed native form submission cannot be hidden by a fast completed navigation", async () => {
  const fake = setup({ submit: async (fake, id, query) => {
    const tab = { id, status: "complete", url: `https://www.bing.com/search?q=${encodeURIComponent(query)}` };
    fake.tabs.set(id, tab); fake.emit("onUpdated", id, { status: "complete" }, tab);
    await Promise.resolve();
    return [{ result: { submitted: false } }];
  } });
  await assert.rejects(fake.run(), /SEARCH_SUBMIT_FAILED/);
  assert.deepEqual(fake.progress, []);
  assertNoListeners(fake);
});

test("partial confirmed progress survives a later form failure", async () => {
  const fake = setup({ submit: async (fake, id, query) => {
    if (fake.submissions.length === 3) throw new Error("SEARCH_FORM_UNAVAILABLE");
    fake.tabs.set(id, { id, status: "complete", url: `https://www.bing.com/search?q=${encodeURIComponent(query)}` });
    return [{ result: { submitted: true } }];
  } });
  await assert.rejects(fake.run(), error => error.message === "SEARCH_FORM_UNAVAILABLE" && error.completedSearches === 2);
  assert.deepEqual(fake.progress.map(value => value.completed), [1, 2]);
  assert.equal(fake.submissions.length, 3);
  assert.deepEqual(fake.removed, [1]);
  assertNoListeners(fake);
});

test("stops at a Beijing date change before the next search", async () => {
  const fake = setup({ now: () => fake.waits.some(duration => duration >= 8000) ? new Date("2026-10-19T16:00:00Z") : today() });
  await assert.rejects(fake.run(), /DAILY_SEARCH_DATE_CHANGED/);
  assert.equal(fake.submissions.length, 1);
  assert.equal(fake.progress.length, 1);
  assert.deepEqual(fake.removed, [1]);
  assertNoListeners(fake);
});

test("a tab closed during submission releases listeners and does not count the search", async () => {
  const fake = setup({ submit: async (fake, id) => {
    fake.tabs.delete(id); fake.emit("onRemoved", id);
    return [{ result: { submitted: true } }];
  } });
  await assert.rejects(fake.run(), /TAB_CLOSED/);
  assert.deepEqual(fake.progress, []);
  assertNoListeners(fake);
});

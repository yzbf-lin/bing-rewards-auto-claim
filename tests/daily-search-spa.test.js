import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../userscript/bing-rewards-auto-claim.user.js", import.meta.url), "utf8");
const stateKey = "bingRewardsAutoClaimState";
const progressKey = "bingRewardsAutoClaimDailySearchProgress";
let nextIdentity = 0;

// Model an intercepted GET form: the URL changes immediately and the existing
// results element is updated by a later response, without unloading the document.
function interceptedSearch({ response = "results", resultDelay = 1200, changeUrl = "matching", initialResults = true,
  nativeBehavior = "navigate", session = null } = {}) {
  const clock = session?.clock ?? { now: Date.UTC(2026, 9, 19, 3) };
  const location = session?.location ?? { href: "https://www.bing.com/search?q=previous", assign(value) { this.href = value; } };
  const store = session?.store ?? new Map();
  const tabData = session?.tabData ?? {};
  const events = session?.events ?? { interceptedSubmissions: 0, nativeSubmissions: 0, responseAt: null, confirmations: [] };
  let unloaded = false;
  let scheduledResponse = null;
  const observers = new Set();
  const visibleStyle = { display: "block", visibility: "visible", opacity: "1" };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  class Element {
    constructor(tagName, text = "") { this.tagName = tagName; this.nodeType = 1; this.textContent = text; this.innerText = text; this.isConnected = true; this.children = []; }
    getClientRects() { return [{}]; }
    getBoundingClientRect() { return { width: 300, height: 40, top: 10, left: 10 }; }
    getAttribute(name) { return this[name] ?? null; }
    hasAttribute() { return false; }
    closest() { return null; }
    matches() { return false; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll() { return []; }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  }
  let anchors = [];
  let headings = [];
  let algorithms = [];
  const results = new Element("OL");
  results.id = "b_results";
  results.querySelectorAll = (selector) => {
    if (!algorithms.length) return [];
    if (/a(?:\[|\b)/.test(selector)) return anchors;
    if (/h2/.test(selector)) return headings;
    if (/b_algo|li|:scope/.test(selector)) return algorithms;
    return [];
  };
  function render(title, href) {
    if (!title) {
      anchors = []; headings = []; algorithms = []; results.children = [];
      results.innerText = results.textContent = results.innerHTML = "";
      return;
    }
    const anchor = new Element("A", title);
    anchor.href = href;
    const heading = new Element("H2", title);
    heading.children = [anchor];
    heading.querySelectorAll = selector => /a/.test(selector) ? [anchor] : [];
    const item = new Element("LI", `${title} A useful public search result description.`);
    item.className = "b_algo";
    item.children = [heading];
    item.querySelectorAll = selector => /a/.test(selector) ? [anchor] : /h2/.test(selector) ? [heading] : [];
    anchor.parentElement = heading; heading.parentElement = item; item.parentElement = results;
    anchors = [anchor]; headings = [heading]; algorithms = [item];
    results.children = [item];
    results.innerText = results.textContent = item.textContent;
    results.innerHTML = `<li class="b_algo"><h2><a href="${href}">${title}</a></h2><p>A useful public search result description.</p></li>`;
  }
  render(initialResults ? "Earlier astronomy article" : null, "https://example.org/earlier-astronomy");
  class FakeEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options); this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
  }
  class Input extends Element {
    constructor() { super("INPUT"); this.name = "q"; this.id = "sb_form_q"; this.content = "previous"; }
    set value(value) { this.content = value; }
    get value() { return this.content; }
    dispatchEvent() { return true; }
  }
  class Form extends Element {
    constructor() { super("FORM"); this.action = "https://www.bing.com/search"; this.method = "get"; }
    checkValidity() { return true; }
    setAttribute(name, value) { this[name] = value; }
    requestSubmit() {
      events.interceptedSubmissions++;
      const event = new FakeEvent("submit", { cancelable: true });
      // The page handles submission and asynchronously renders its response.
      event.preventDefault();
      const query = field.value;
      const destinationQuery = changeUrl === "wrong" ? "unrelated search" : query;
      location.href = `https://www.bing.com/search?q=${encodeURIComponent(destinationQuery)}${changeUrl === "duplicate" ? "&q=unrelated" : ""}`;
      scheduledResponse = { at: clock.now + resultDelay, run() {
        events.responseAt = clock.now;
        if (response === "results") render("Fresh astronomy discovery", "https://example.org/fresh-discovery");
        if (response === "shell" || response === "blocked") render(null, null);
        if (response !== "stale") {
          document.title = `${destinationQuery} - Search`;
          for (const observer of observers) observer.callback([{ type: "childList", target: results }]);
        }
      } };
    }
    submit() {
      events.nativeSubmissions++;
      if (nativeBehavior === "throw") throw new Error("native submission unavailable");
      if (nativeBehavior === "noop") return;
      const pending = store.get(stateKey);
      assert.equal(pending.phase, "daily-search-wait", "navigation must start after the waiting state is saved");
      assert.equal(pending.dailySearch.pendingQuery, field.value);
      assert.equal(store.get(progressKey).completed, 19);
      const query = changeUrl === "wrong" ? "unrelated search" : field.value;
      location.href = `https://www.bing.com/search?q=${encodeURIComponent(query)}${changeUrl === "duplicate" ? "&q=unrelated" : ""}`;
      unloaded = true;
    }
  }
  const field = new Input();
  field.form = new Form();
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  const document = {
    readyState: "complete", title: "previous - Search", documentElement: new Element("HTML"), body: new Element("BODY"),
    defaultView: {
      HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLFormElement: Form,
      Event: FakeEvent, MutationObserver, getComputedStyle: () => visibleStyle,
    },
    getElementById(id) { return id === "b_results" ? results : id === "sb_form_q" ? field : null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    querySelectorAll(selector) {
      if (/captcha|challenge|b_error|b_errorPage|b_block|b_unavailable/.test(selector) && response === "blocked" && events.responseAt !== null) return [new Element("DIV", "Verify you are human")];
      if (selector.includes("sb_form_q") || selector.includes('input[name="q"]') || selector.includes('textarea[name="q"]')) return [field];
      if (selector === "#b_results") return [results];
      if (selector.includes("#b_results")) return results.querySelectorAll(selector);
      return [];
    },
  };
  const context = vm.createContext({
    __BING_REWARDS_USERSCRIPT_TEST__: true, URL, document, location,
    window: { location, getComputedStyle: () => visibleStyle },
    Date: ClockDate, Math: Object.assign(Object.create(Math), { random: () => 0.99 }),
    crypto: { randomUUID: () => `spa-search-${++nextIdentity}` }, MutationObserver,
    GM_getValue: (key, fallback) => store.has(key) ? structuredClone(store.get(key)) : fallback,
    GM_setValue(key, value) {
      if (key === progressKey && value.completed >= 20) events.confirmations.push(clock.now);
      store.set(key, structuredClone(value));
    },
    GM_getTab: callback => callback(structuredClone(tabData)),
    GM_saveTab: value => Object.assign(tabData, structuredClone(value)),
    setTimeout(callback, milliseconds) {
      if (unloaded) throw new Error("DOCUMENT_UNLOADED");
      const target = clock.now + milliseconds;
      if (scheduledResponse && scheduledResponse.at <= target) {
        const job = scheduledResponse; scheduledResponse = null;
        clock.now = job.at; job.run();
      }
      clock.now = target;
      callback();
      return 1;
    },
    clearTimeout() {}, console: { info() {}, warn() {} },
  });
  vm.runInContext(source, context);
  const api = context.__BING_REWARDS_USERSCRIPT_API__;
  const shared = { clock, location, store, tabData, events };
  return { api, store, events, location, session: shared, async run() {
    await api.initializeTabIdentity();
    const state = api.createRun("manual");
    state.phase = "execute"; state.claimsRefreshed = true;
    state.dailySearchTerms = ["Upcoming astronomical event"];
    store.set(progressKey, { dateKey: api.beijingDateKey(), completed: 19, queries: [] });
    store.set(stateKey, structuredClone(state));
    await api.executeCatalog(state);
    return state;
  }, async resume() {
    await api.initializeTabIdentity();
    const state = store.get(stateKey);
    await api.resumePhase(state);
    return state;
  } };
}

test("daily search bypasses the page's intercepted submission and confirms the resulting full navigation once", async () => {
  const rt = interceptedSearch();
  await assert.rejects(rt.run(), /DOCUMENT_UNLOADED/);
  assert.equal(rt.events.nativeSubmissions, 1);
  assert.equal(rt.events.interceptedSubmissions, 0);
  assert.equal(rt.store.get(progressKey).completed, 19);
  const next = interceptedSearch({ session: rt.session });
  const state = await next.resume();
  assert.equal(next.store.get(progressKey).completed, 20);
  assert.equal(state.results[0].reason, "DAILY_SEARCH_COMPLETED");
  assert.equal(next.events.confirmations.length, 1);
  await next.resume();
  assert.equal(next.events.nativeSubmissions, 1);
  assert.equal(next.events.interceptedSubmissions, 0);
});

test("ordinary search submissions retain the page's native requestSubmit behavior", async () => {
  const rt = interceptedSearch();
  await rt.api.submitBingSearch("Ordinary astronomy search");
  assert.equal(rt.events.interceptedSubmissions, 1);
  assert.equal(rt.events.nativeSubmissions, 0);
  assert.equal(new URL(rt.location.href).searchParams.get("q"), "Ordinary astronomy search");
});

test("a native submission that does not navigate cannot count the old results", async () => {
  const rt = interceptedSearch({ nativeBehavior: "noop" });
  const state = await rt.run();
  assert.equal(rt.events.nativeSubmissions, 1);
  assert.equal(rt.events.interceptedSubmissions, 0);
  assert.equal(rt.store.get(progressKey).completed, 19);
  assert.equal(state.results[0].outcome, "FAILED");
  assert.deepEqual(rt.events.confirmations, []);
});

test("a native submission exception preserves the completed count without trying the intercepted route", async () => {
  const rt = interceptedSearch({ nativeBehavior: "throw" });
  const state = await rt.run();
  assert.equal(rt.events.nativeSubmissions, 1);
  assert.equal(rt.events.interceptedSubmissions, 0);
  assert.equal(rt.store.get(progressKey).completed, 19);
  assert.equal(state.results[0].reason, "SEARCH_SUBMIT_FAILED");
  assert.deepEqual(rt.events.confirmations, []);
});

test("a full navigation with wrong or ambiguous q cannot confirm the pending native submission", async () => {
  for (const changeUrl of ["wrong", "duplicate"]) {
    const rt = interceptedSearch({ changeUrl });
    await assert.rejects(rt.run(), /DOCUMENT_UNLOADED/);
    const next = interceptedSearch({ session: rt.session });
    const state = await next.resume();
    assert.equal(rt.store.get(progressKey).completed, 19);
    assert.equal(state.results[0].outcome, "FAILED");
    assert.deepEqual(rt.events.confirmations, []);
  }
});

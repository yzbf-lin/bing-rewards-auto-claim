import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../userscript/bing-rewards-auto-claim.user.js", import.meta.url), "utf8");
const sourceUrl = "https://rewards.bing.com/earn";
const landingUrl = "https://www.bing.com/?form=ML2PCO";
const stateKey = "bingRewardsAutoClaimState";
const queryKey = "bingRewardsAutoClaimSearchQuery";
const candidate = {
  section: "连续打卡任务", title: "必应搜索连续打卡", text: "必应搜索连续打卡 搜索: 0/1",
  kind: "button", url: null, source: "earn", sourceUrl,
};

function runtime({
  store = new Map(), tabData = {}, href = sourceUrl, progress = "0/1", delayedProgressReads = 0,
  dialogDelay = 0, missingDialog = false, missingCard = false,
  unloadOnLinkNavigation = false, unloadOnSearchNavigation = false,
} = {}) {
  const location = { href, assign(value) { this.href = value; } };
  let unloaded = false;
  let dialogOpened = false;
  const counters = { cardClicks: 0, linkClicks: 0, dialogReads: 0, progressReads: 0, submissions: 0, writes: [] };
  const names = ["连续打卡任务", "升级活动", "任务", "日常任务"];
  const cardAttrs = new Map();
  const linkAttrs = new Map([["target", "_blank"]]);
  const visibleElement = {
    closest() { return null; },
    getClientRects() { return [{}]; },
  };
  const card = {
    ...visibleElement,
    tagName: "BUTTON",
    get innerText() { return `${candidate.title} 搜索: ${++counters.progressReads > delayedProgressReads ? progress : "0/1"}`; },
    getAttribute(name) { return cardAttrs.get(name) ?? null; },
    setAttribute(name, value) { cardAttrs.set(name, value); },
    removeAttribute(name) { cardAttrs.delete(name); },
    hasAttribute(name) { return cardAttrs.has(name); },
    querySelector(selector) { return selector === "img[alt]" ? { getAttribute: () => candidate.title } : null; },
    querySelectorAll() { return []; },
    click() {
      counters.cardClicks++;
      assert.equal(store.get(stateKey).phase, "search-streak-dialog", "persist the dialog phase before opening the card");
      dialogOpened = true;
    },
  };
  const link = {
    ...visibleElement,
    tagName: "A", href: landingUrl, innerText: "立即搜索",
    getAttribute(name) { return linkAttrs.get(name) ?? null; },
    setAttribute(name, value) { linkAttrs.set(name, value); },
    hasAttribute(name) { return linkAttrs.has(name); },
    click() {
      counters.linkClicks++;
      const persisted = store.get(stateKey);
      assert.equal(linkAttrs.get("target"), "_self", "the modal link must navigate the owner tab");
      assert.equal(persisted.phase, "search-streak-navigate", "persist the navigation phase before clicking the link");
      assert.equal(persisted.pending.searchLandingUrl, landingUrl);
      assert.equal(typeof persisted.pending.searchNavigationDocumentId, "string");
      assert.ok(persisted.pending.searchNavigationDocumentId);
      location.assign(landingUrl);
      unloaded = unloadOnLinkNavigation;
    },
  };
  const heading = { tagName: "H2", textContent: candidate.title };
  const dialog = {
    ...visibleElement,
    tagName: "SECTION",
    getAttribute(name) { return name === "role" ? "dialog" : name === "aria-labelledby" ? "search-streak-title" : null; },
    querySelector(selector) { return selector === "h1, h2, h3" ? heading : null; },
    querySelectorAll(selector) { return selector === "a[href]" ? [link] : []; },
  };
  const groups = names.map((name, index) => ({
    getAttribute: key => key === "aria-label" ? name : null,
    querySelectorAll: () => !index && !missingCard ? [card] : [],
  }));
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
      const persisted = store.get(stateKey);
      assert.equal(persisted.phase, "search-streak-wait", "persist the submission before form navigation");
      assert.equal(persisted.pending.searchSubmitted, true);
      location.assign(`https://www.bing.com/search?q=${encodeURIComponent(field.value)}`);
      unloaded = unloadOnSearchNavigation;
    }
  }
  const field = new Input();
  field.form = new Form();
  const document = {
    readyState: "complete",
    defaultView: {
      HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLFormElement: Form, Event: FakeEvent,
      getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    },
    getElementById(id) { return id === "search-streak-title" ? heading : null; },
    querySelector(selector) { return selector.includes("data-rewards-auto-id") && !missingCard ? card : null; },
    querySelectorAll(selector) {
      if (selector.includes("sb_form_q")) return [field];
      if (selector === "h2") return names.map(textContent => ({ textContent }));
      if (selector === '[role="group"]') return groups;
      if (selector === 'dialog, [role="dialog"], [aria-modal="true"]') {
        counters.dialogReads++;
        return dialogOpened && !missingDialog && counters.dialogReads > dialogDelay ? [dialog] : [];
      }
      return [];
    },
  };
  const context = vm.createContext({
    __BING_REWARDS_USERSCRIPT_TEST__: true, URL, document, location, window: { location, open() {} },
    GM_getValue(key, fallback) { return store.has(key) ? structuredClone(store.get(key)) : fallback; },
    GM_setValue(key, value) {
      store.set(key, structuredClone(value));
      counters.writes.push({ key, value: structuredClone(value) });
    },
    GM_getTab(callback) { callback(structuredClone(tabData)); },
    GM_saveTab(value) { Object.assign(tabData, structuredClone(value)); },
    GM_getTabs(callback) { callback(structuredClone({ current: tabData })); },
    setTimeout(callback) { if (unloaded) throw new Error("DOCUMENT_UNLOADED"); callback(); return 1; },
    console: { info() {}, warn() {} },
  });
  vm.runInContext(source, context);
  const api = context.__BING_REWARDS_USERSCRIPT_API__;
  const ready = api.initializeTabIdentity();
  return { api, store, tabData, ready, location, counters, field };
}

async function untilNavigation(action) {
  try { await action(); } catch (error) { if (error.message !== "DOCUMENT_UNLOADED") throw error; }
}

function pendingRun(rt, phase = "search-streak-open") {
  const state = rt.api.createRun("manual");
  state.catalog = [candidate];
  state.claimsRefreshed = true;
  state.pending = {
    entry: candidate, recognition: { reason: "SEARCH_STREAK", decision: "ELIGIBLE", rewardPoints: null },
    startedAt: Date.now(), searchQuery: "aurora forecast",
  };
  state.phase = phase;
  rt.store.set(stateKey, structuredClone(state));
  return state;
}

test("button and delayed dialog navigation submit once and require the source card to reach 1/1", async () => {
  const rt = runtime({ store: new Map([[queryKey, "  aurora forecast  "]]), dialogDelay: 3, unloadOnLinkNavigation: true });
  await rt.ready;
  const state = rt.api.createRun("automatic");
  state.catalog = [candidate];
  state.claimsRefreshed = true;
  await untilNavigation(() => rt.api.executeCatalog(state));
  assert.equal(rt.counters.cardClicks, 1);
  assert.ok(rt.counters.dialogReads >= 4, "wait for the delayed React dialog");
  assert.equal(rt.counters.linkClicks, 1);
  assert.equal(rt.counters.submissions, 0);
  const persisted = rt.store.get(stateKey);
  assert.equal(persisted.phase, "search-streak-navigate");
  assert.equal(persisted.pending.searchLandingUrl, landingUrl);
  assert.equal(persisted.pending.searchQuery, "aurora forecast");
  assert.equal(persisted.results.length, 0);

  const search = runtime({ store: rt.store, tabData: rt.tabData, href: landingUrl, unloadOnSearchNavigation: true });
  await untilNavigation(() => search.api.resumePhase(search.store.get(stateKey)));
  assert.equal(search.counters.submissions, 1);
  assert.equal(search.field.value, "aurora forecast");
  assert.equal(search.counters.cardClicks, 0);
  assert.equal(search.counters.linkClicks, 0);
  const submitted = search.store.get(stateKey);
  assert.equal(submitted.phase, "search-streak-wait");
  assert.equal(submitted.pending.searchSubmitted, true);
  assert.equal(submitted.results.length, 0);

  const results = runtime({ store: rt.store, tabData: rt.tabData, href: search.location.href });
  await results.api.resumePhase(results.store.get(stateKey));
  assert.equal(results.location.href, sourceUrl);
  assert.equal(results.counters.submissions, 0);
  assert.equal(results.store.get(stateKey).phase, "search-streak-verify");
  assert.equal(results.store.get(stateKey).results.length, 0);

  const verify = runtime({ store: rt.store, tabData: rt.tabData, progress: "1/1", delayedProgressReads: 3 });
  const restored = verify.store.get(stateKey);
  await verify.api.resumePhase(restored);
  assert.equal(restored.results[0]?.reason, "SEARCH_STREAK_COMPLETED");
  assert.equal(restored.results[0]?.outcome, "COMPLETED");
  assert.ok(verify.counters.progressReads >= 4, "allow source progress to refresh after navigation");
  assert.equal(verify.counters.submissions, 0);
  assert.equal(verify.counters.cardClicks, 0);
  assert.equal(verify.counters.linkClicks, 0);
  assert.doesNotMatch(JSON.stringify(restored.logs), /aurora forecast/);
});

test("a missing dialog fails explicitly without searching or completing the button task", async () => {
  const rt = runtime({ missingDialog: true });
  await rt.ready;
  const state = pendingRun(rt);
  await rt.api.resumePhase(state);
  assert.equal(state.results[0]?.reason, "SEARCH_STREAK_LINK_UNAVAILABLE");
  assert.equal(state.results[0]?.outcome, "FAILED");
  assert.equal(rt.counters.cardClicks, 1);
  assert.ok(rt.counters.dialogReads > 1, "wait for the dialog before reporting it unavailable");
  assert.equal(rt.counters.linkClicks, 0);
  assert.equal(rt.counters.submissions, 0);
  assert.equal(rt.field.value, undefined);
});

test("a source reload while awaiting the lost dialog never clicks the card again or submits", async () => {
  const first = runtime();
  await first.ready;
  pendingRun(first, "search-streak-dialog");
  const restored = runtime({ store: first.store, tabData: first.tabData });
  const state = restored.store.get(stateKey);
  await restored.api.resumePhase(state);
  assert.equal(state.results[0]?.reason, "SEARCH_STREAK_LINK_UNAVAILABLE");
  assert.equal(state.results[0]?.outcome, "FAILED");
  assert.equal(restored.counters.cardClicks, 0);
  assert.equal(restored.counters.linkClicks, 0);
  assert.equal(restored.counters.submissions, 0);
  assert.equal(restored.field.value, undefined);
});

test("a source reload after the dialog link was clicked cannot be mistaken for the search landing page", async () => {
  const first = runtime({ unloadOnLinkNavigation: true });
  await first.ready;
  const pending = pendingRun(first);
  await untilNavigation(() => first.api.resumePhase(pending));
  assert.equal(first.counters.linkClicks, 1);
  assert.equal(first.store.get(stateKey).phase, "search-streak-navigate");

  const restored = runtime({ store: first.store, tabData: first.tabData, href: sourceUrl });
  const state = restored.store.get(stateKey);
  await restored.api.resumePhase(state);
  assert.equal(state.results[0]?.reason, "SEARCH_STREAK_NAVIGATION_NOT_CONFIRMED");
  assert.equal(state.results[0]?.outcome, "FAILED");
  assert.equal(restored.counters.cardClicks, 0);
  assert.equal(restored.counters.linkClicks, 0);
  assert.equal(restored.counters.submissions, 0);
  assert.equal(restored.field.value, undefined);
});

test("a button that reached 1/1 before activation is completed without opening its dialog", async () => {
  const rt = runtime({ progress: "1/1" });
  await rt.ready;
  const state = pendingRun(rt);
  await rt.api.resumePhase(state);
  assert.equal(state.results[0]?.reason, "SEARCH_STREAK_COMPLETED");
  assert.equal(state.results[0]?.outcome, "COMPLETED");
  assert.equal(rt.counters.cardClicks, 0);
  assert.equal(rt.counters.dialogReads, 0);
  assert.equal(rt.counters.linkClicks, 0);
  assert.equal(rt.counters.submissions, 0);
});

test("button search verification requires exactly 1/1 and cannot accept 0/1, 2/1, 1/2 or a missing card", async () => {
  for (const options of [{ progress: "0/1" }, { progress: "2/1" }, { progress: "1/2" }, { missingCard: true }]) {
    const rt = runtime(options);
    await rt.ready;
    const state = pendingRun(rt, "search-streak-verify");
    state.pending.searchSubmitted = true;
    rt.store.set(stateKey, structuredClone(state));
    await rt.api.resumePhase(state);
    assert.equal(state.results[0]?.reason, "SEARCH_STREAK_NOT_CONFIRMED", JSON.stringify(options));
    assert.equal(state.results[0]?.outcome, "FAILED", JSON.stringify(options));
    assert.equal(rt.counters.cardClicks, 0);
    assert.equal(rt.counters.linkClicks, 0);
    assert.equal(rt.counters.submissions, 0);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { classifyEntry } from "../src/shared/task-policy.js";
import { getSearchStreakProgress } from "../src/shared/search-streak.js";

function streak(overrides = {}) {
  return {
    title: "必应搜索连续打卡",
    text: "必应搜索连续打卡 每天搜索即可继续连续打卡。搜索: 0/1",
    section: "连续打卡任务",
    kind: "link",
    url: "https://www.bing.com/?form=REWARDS",
    disabled: false,
    ...overrides,
  };
}

test("recognizes the observed single daily Bing search streak without a points badge", () => {
  assert.deepEqual(classifyEntry(streak()), {
    decision: "ELIGIBLE", reason: "SEARCH_STREAK", rewardPoints: null,
  });
});

test("recognizes traditional-Chinese and English Bing search streak titles and explicit counters", () => {
  for (const [title, text] of [
    ["必應搜尋連續打卡", "搜尋：0 / 1"],
    ["Bing 搜尋連續簽到", "搜尋: 0/1"],
    ["Bing search streak", "Search: 0/1"],
    ["Bing Search Streak", "Searches 0 / 1"],
  ]) {
    assert.equal(classifyEntry(streak({ title, text })).reason, "SEARCH_STREAK", title);
  }
});

test("the daily search counter marks completion despite an incomplete multi-day streak", () => {
  for (const current of [1, 2]) {
    const candidate = streak({ text: `搜索: ${current}/1 连续天数: 2/7`, signals: { completed: false } });
    assert.equal(classifyEntry(candidate).reason, "COMPLETED");
  }
});

test("search streak preserves disabled and explicit completed state", () => {
  assert.equal(classifyEntry(streak({ disabled: true })).reason, "DISABLED");
  assert.equal(classifyEntry(streak({ signals: { completed: true } })).reason, "COMPLETED");
});

test("search streak never admits general search tasks or unrelated multi-day campaigns", () => {
  for (const candidate of [
    streak({ title: "每日搜索" }),
    streak({ title: "每日连续打卡活动" }),
    streak({ title: "Bing search streak 7-day campaign" }),
    streak({ text: "搜索: 0/3" }),
    streak({ text: "活动: 0/1" }),
    streak({ text: "Research: 0/1" }),
    streak({ text: "搜索: 0/1 搜索: 0/3" }),
    streak({ kind: "button", url: null }),
    streak({ kind: "unknown" }),
  ]) {
    assert.equal(classifyEntry(candidate).decision, "SKIPPED", JSON.stringify(candidate));
  }
});

test("search streak only admits a trusted HTTPS Bing link", () => {
  for (const url of [
    "https://bing.com.evil.example/", "https://evilbing.com/", "http://www.bing.com/",
    "javascript:alert(1)", "https://www.bing.com@evil.example/", "https://user@www.bing.com/", "not-a-url",
  ]) {
    assert.equal(classifyEntry(streak({ url })).decision, "SKIPPED", url);
  }
});

test("the progress recognizer survives serialization and rejects malformed counters", () => {
  const recognize = vm.runInNewContext(`(${getSearchStreakProgress.toString()})`, { URL });
  assert.equal(JSON.stringify(recognize(streak())), '{"current":0,"total":1}');
  for (const text of ["搜索: 0/10", "搜索: -1/1", "搜索: 0.5/1", "搜索: 0/1.5", "搜索: 9007199254740992/1"]) {
    assert.equal(recognize(streak({ text })), null, text);
  }
});

const searchActionsSource = await readFile(new URL("../src/content/search-actions.js", import.meta.url), "utf8")
  .catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });

// Minimal native DOM contract fixture: value lives on the input prototype and
// requestSubmit dispatches a cancelable submit event before native submission.
function searchPage(options = {}) {
  const activity = [];
  const location = { href: options.url ?? "https://www.bing.com/" };
  class HTMLInputElement extends EventTarget {
    constructor() {
      super();
      this.tagName = "INPUT";
      this.name = "q";
      this.disabled = false;
      this.readOnly = false;
      this.hidden = false;
      this.attributes = {};
    }
    get value() { return this.storedValue ?? ""; }
    set value(value) { this.storedValue = value; activity.push(["value", value]); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    closest() { return this.hiddenAncestor ? {} : null; }
    matches(selector) { return selector === ":disabled" && (this.disabled || this.disabledFieldset); }
  }
  class HTMLTextAreaElement extends HTMLInputElement {
    constructor() { super(); this.tagName = "TEXTAREA"; }
  }
  Object.defineProperty(HTMLTextAreaElement.prototype, "value", Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"));
  class HTMLFormElement extends EventTarget {
    constructor() {
      super();
      this.tagName = "FORM";
      this.action = options.action ?? "/search";
      this.method = options.method ?? "get";
      this.target = "_blank";
    }
    getAttribute(name) { return this[name] ?? null; }
    setAttribute(name, value) { this[name] = value; }
    checkValidity() { return options.valid !== false; }
    submit() { activity.push(["submit", this.action, this.target]); }
    requestSubmit() {
      activity.push(["requestSubmit"]);
      if (this.checkValidity() && this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) {
        HTMLFormElement.prototype.submit.call(this);
      }
    }
  }
  const form = new HTMLFormElement();
  const field = options.textarea ? new HTMLTextAreaElement() : new HTMLInputElement();
  field.form = form;
  field.addEventListener("input", (event) => activity.push([event.type, event.bubbles, field.value]));
  field.addEventListener("change", (event) => activity.push([event.type, event.bubbles, field.value]));
  form.addEventListener("submit", () => activity.push(["submitEvent", field.value]));
  if (options.noRequestSubmit) HTMLFormElement.prototype.requestSubmit = undefined;
  let polls = 0;
  const document = {
    querySelectorAll() { polls += 1; return polls >= (options.readyAfter ?? 1) ? [field] : []; },
  };
  const context = vm.createContext({
    document, location, URL, Event, HTMLInputElement, HTMLTextAreaElement, HTMLFormElement,
    getComputedStyle: () => ({ display: "block", visibility: options.visibility ?? "visible", opacity: "1" }),
    setTimeout(callback) { options.onWait?.({ field, form, location }); callback(); return 1; },
  });
  document.defaultView = context;
  vm.runInContext(searchActionsSource.replace(/^export /gm, ""), context);
  assert.equal(typeof context.submitBingSearch, "function", "search-actions must expose the standalone submitBingSearch helper");
  return { submit: context.submitBingSearch, form, field, activity, location, get polls() { return polls; } };
}

test("submits the user's search once through native input events and the real Bing form", async () => {
  for (const textarea of [false, true]) {
    const page = searchPage({ textarea });
    // Framework-owned instance setters must not prevent the native value update.
    Object.defineProperty(page.field, "value", {
      get() { return this.storedValue ?? ""; }, set() { throw new Error("instance setter called"); },
    });
    assert.equal(JSON.stringify(await page.submit("  上海天气  ")), '{"submitted":true}');
    assert.deepEqual(page.activity, [
      ["value", "上海天气"], ["input", true, "上海天气"], ["change", true, "上海天气"],
      ["requestSubmit"], ["submitEvent", "上海天气"], ["submit", "/search", "_self"],
    ]);
  }
});

test("waits for Bing form hydration and then submits exactly once", async () => {
  const page = searchPage({ readyAfter: 4 });
  await page.submit("Bing search");
  assert.equal(page.polls, 4);
  assert.equal(page.activity.filter(([event]) => event === "submit").length, 1);
});

test("requires a nonblank user query no longer than 200 characters", async () => {
  for (const [query, code] of [
    [undefined, "SEARCH_QUERY_REQUIRED"], [null, "SEARCH_QUERY_REQUIRED"], [" \n\t", "SEARCH_QUERY_REQUIRED"],
    [123, "SEARCH_QUERY_INVALID"], ["x".repeat(201), "SEARCH_QUERY_INVALID"], ["abc\u0000def", "SEARCH_QUERY_INVALID"],
  ]) {
    const page = searchPage();
    await assert.rejects(page.submit(query), { message: code });
    assert.deepEqual(page.activity, []);
  }
  await searchPage().submit("x".repeat(200));
});

test("rejects unsafe page origins before interacting with any search input", async () => {
  for (const url of ["https://bing.com.evil.test/", "http://www.bing.com/", "https://evilbing.com/", "https://user@www.bing.com/"]) {
    const page = searchPage({ url });
    await assert.rejects(page.submit("weather"), { message: "SEARCH_PAGE_UNSUPPORTED" });
    assert.deepEqual(page.activity, []);
  }
});

test("rejects an unsafe form action or method before entering the query", async () => {
  for (const settings of [
    { action: "https://bing.com.evil.test/search" }, { action: "http://www.bing.com/search" },
    { action: "https://cn.bing.com/search" }, { action: "/account/login" },
    { action: "javascript:alert(1)" }, { action: "https://user@www.bing.com/search" }, { method: "post" },
  ]) {
    const page = searchPage(settings);
    await assert.rejects(page.submit("weather"), { message: "SEARCH_FORM_UNSAFE" });
    assert.deepEqual(page.activity, []);
  }
});

test("missing, hidden, disabled, readonly, and non-form search controls are never submitted", async () => {
  for (const alter of [
    (page) => { page.field.hidden = true; },
    (page) => { page.field.disabled = true; },
    (page) => { page.field.disabledFieldset = true; },
    (page) => { page.field.readOnly = true; },
    (page) => { page.field.hiddenAncestor = true; },
    (page) => { page.field.attributes["aria-disabled"] = "true"; },
    (page) => { page.field.form = null; },
    (page) => { page.field.form = { tagName: "FORM", action: "/search", requestSubmit() { throw new Error("fake form"); } }; },
  ]) {
    const page = searchPage();
    alter(page);
    await assert.rejects(page.submit("weather"), { message: "SEARCH_FORM_UNAVAILABLE" });
    assert.deepEqual(page.activity, []);
    assert.ok(page.polls <= 101, "hydration must be bounded");
  }
  await assert.rejects(searchPage({ readyAfter: Infinity }).submit("weather"), { message: "SEARCH_FORM_UNAVAILABLE" });
  await assert.rejects(searchPage({ visibility: "hidden" }).submit("weather"), { message: "SEARCH_FORM_UNAVAILABLE" });
});

test("rechecks the page after hydration and form destination after change handlers", async () => {
  const navigated = searchPage({ readyAfter: 2, onWait({ location }) { location.href = "https://evil.test/"; } });
  await assert.rejects(navigated.submit("weather"), { message: "SEARCH_PAGE_UNSUPPORTED" });
  const changed = searchPage();
  changed.field.addEventListener("change", () => { changed.form.action = "https://evil.test/search"; });
  await assert.rejects(changed.submit("weather"), { message: "SEARCH_FORM_UNSAFE" });
  assert.equal(changed.activity.some(([event]) => event === "submit"), false);
});

test("legacy form submission preserves validation and cancelable submit handlers", async () => {
  const legacy = searchPage({ noRequestSubmit: true });
  await legacy.submit("weather");
  assert.deepEqual(legacy.activity.slice(-2), [["submitEvent", "weather"], ["submit", "/search", "_self"]]);

  const invalid = searchPage({ noRequestSubmit: true, valid: false });
  await assert.rejects(invalid.submit("weather"), { message: "SEARCH_FORM_INVALID" });
  assert.equal(invalid.activity.some(([event]) => event === "submit"), false);

  const canceled = searchPage({ noRequestSubmit: true });
  canceled.form.addEventListener("submit", (event) => event.preventDefault());
  await assert.rejects(canceled.submit("weather"), { message: "SEARCH_SUBMIT_CANCELLED" });
  assert.equal(canceled.activity.some(([event]) => event === "submit"), false);
});

test("native submission failures have a stable error and never retry submission", async () => {
  const page = searchPage();
  Object.getPrototypeOf(page.form).requestSubmit = () => { page.activity.push(["attempt"]); throw new Error("native failure"); };
  await assert.rejects(page.submit("weather"), { message: "SEARCH_SUBMIT_FAILED" });
  assert.equal(page.activity.filter(([event]) => event === "attempt").length, 1);
});

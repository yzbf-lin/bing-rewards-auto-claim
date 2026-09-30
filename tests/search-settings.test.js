import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildPopupModel } from "../src/popup/model.js";

const html = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const source = await readFile(new URL("../src/popup/popup.js", import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

function node() {
  const listeners = new Map();
  const classes = new Set();
  return {
    value: "", textContent: "", disabled: false, hidden: false, dataset: {},
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains: name => classes.has(name),
    },
    set innerHTML(_value) { throw new Error("Popup content must use plain text"); },
    append() {}, replaceChildren() {},
    addEventListener(name, listener) { listeners.set(name, listener); },
    async fire(name) { await listeners.get(name)?.({ preventDefault() {} }); },
  };
}

function popup({ embedded = false } = {}) {
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [`#${match[1]}`, node()]));
  const state = {};
  const reads = [];
  const writes = [];
  const messages = [];
  const storageListeners = [];
  // An obsolete saved value must not be needed to open or run the popup.
  Object.defineProperty(state, "searchQuery", {
    get() { throw new Error("Obsolete searchQuery setting must not be read"); },
  });
  const get = selector => {
    const element = nodes.get(selector);
    assert.ok(element, `popup.html must provide ${selector}`);
    return element;
  };
  const body = node();
  const context = vm.createContext({
    buildPopupModel, URLSearchParams, location: { search: embedded ? "?embedded=1" : "" },
    document: { body, querySelector: selector => nodes.get(selector), createElement: node, addEventListener() {} },
    chrome: {
      runtime: {
        getManifest: () => ({ version: "test" }),
        async sendMessage(message) {
          messages.push(structuredClone(message));
          return { ok: message.type === "RUN_CLAIM_NOW" };
        },
      },
      tabs: { async query() { return [{ id: 42 }]; } },
      storage: {
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? [...keys] : [keys];
            reads.push(names);
            return Object.fromEntries(names.filter(key => key in state).map(key => [key, state[key]]));
          },
          async set(values) { writes.push(structuredClone(values)); },
        },
        onChanged: { addListener: listener => storageListeners.push(listener) },
      },
    },
    console: { log() { assert.fail("The popup must not log search terms"); } },
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/, ""), context);
  return {
    get, body, reads, writes, messages,
    async changeRun() {
      state.currentRun = { status: "running", results: [], progress: { current: 1, total: 2 } };
      for (const listener of storageListeners) listener({ currentRun: { newValue: state.currentRun } }, "local");
      await flush();
    },
    async changeLegacyQuery() {
      for (const listener of storageListeners) listener({ searchQuery: { newValue: "obsolete" } }, "local");
      await flush();
    },
  };
}

test("the popup explains automatic random search without a settings form", () => {
  assert.match(html, /搜索打卡自动使用随机字符串，无需设置。/);
  assert.doesNotMatch(html, /<form\b|<input\b|search-settings|search-query|保存的搜索词/);
});

test("opening and refreshing the popup never reads or writes the obsolete search query", async () => {
  const page = popup();
  await flush();
  assert.equal(page.get("#status-badge").textContent, "尚未运行");
  assert.equal(page.get("#run-button").disabled, false);
  assert.ok(page.reads.some(keys => keys.includes("currentRun")), "load the normal run status");
  assert.equal(page.reads.some(keys => keys.includes("searchQuery")), false);
  await page.changeRun();
  assert.equal(page.get("#status-badge").textContent, "正在领取 1/2");
  assert.equal(page.get("#run-button").disabled, true);
  const readCount = page.reads.length;
  await page.changeLegacyQuery();
  assert.equal(page.reads.length, readCount, "obsolete setting updates must not trigger a refresh");
  assert.equal(page.reads.some(keys => keys.includes("searchQuery")), false);
  assert.deepEqual(page.writes, []);
});

test("toolbar and embedded popups can start a run without search settings", async () => {
  for (const embedded of [false, true]) {
    const page = popup({ embedded });
    await flush();
    assert.equal(page.body.classList.contains("embedded"), embedded);
    await page.get("#run-button").fire("click");
    assert.deepEqual(page.messages.filter(message => message.type === "RUN_CLAIM_NOW"), [
      { type: "RUN_CLAIM_NOW", targetTabId: 42 },
    ]);
    assert.match(page.get("#feedback").textContent, /任务已启动/);
    assert.equal(page.reads.some(keys => keys.includes("searchQuery")), false);
    assert.deepEqual(page.writes, []);
  }
});

test("search query failures ask for a new run without referring to removed settings", () => {
  const reasons = ["SEARCH_QUERY_REQUIRED", "SEARCH_QUERY_INVALID", "SEARCH_QUERY_GENERATION_FAILED"];
  const model = buildPopupModel({ lastRun: { status: "completed", results: reasons.map(reason => ({ reason })) } });
  for (const item of model.groups[0].items) {
    assert.match(item.reasonLabel, /重新运行|重跑/, item.reason);
    assert.doesNotMatch(item.reasonLabel, /设置|保存|修改/, item.reason);
  }
  assert.match(model.groups[0].items[0].reasonLabel, /缺少.*本次搜索词|本次搜索词.*缺少/);
  assert.match(model.groups[0].items[1].reasonLabel, /本次搜索词.*无效/);
  assert.match(model.groups[0].items[2].reasonLabel, /随机字符串生成失败/);
});

test("search streak outcomes and helper failures retain readable explanations", () => {
  const reasons = [
    "SEARCH_STREAK", "SEARCH_STREAK_COMPLETED", "SEARCH_FORM_UNAVAILABLE", "SEARCH_FORM_UNSAFE",
    "SEARCH_FORM_INVALID", "SEARCH_PAGE_UNSUPPORTED", "SEARCH_SUBMIT_UNAVAILABLE", "SEARCH_SUBMIT_FAILED",
    "SEARCH_SUBMIT_CANCELLED", "SEARCH_STREAK_NOT_CONFIRMED", "SEARCH_STREAK_DATE_CHANGED",
  ];
  const model = buildPopupModel({ lastRun: { status: "completed", results: reasons.map(reason => ({ reason })) } });
  for (const item of model.groups[0].items) assert.match(item.reasonLabel, /[\u3400-\u9fff]/, item.reason);
  assert.match(model.groups[0].items[1].reasonLabel, /1\/1/);
});

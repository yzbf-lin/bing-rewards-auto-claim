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
  const attributes = new Map();
  const classes = new Set();
  return {
    value: "", textContent: "", disabled: false, hidden: false, dataset: {},
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains: name => classes.has(name),
    },
    set innerHTML(value) { throw new Error("Popup settings must use plain text"); },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    getAttribute: name => attributes.get(name),
    append() {}, replaceChildren() {},
    addEventListener(name, listener) { listeners.set(name, listener); },
    async fire(name) { await listeners.get(name)?.({ preventDefault() {} }); },
  };
}

function popup({ query = "", readQuery, writeQuery } = {}) {
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [`#${match[1]}`, node()]));
  const state = { searchQuery: query };
  const storageListeners = [];
  const get = selector => {
    const element = nodes.get(selector);
    assert.ok(element, `popup.html must provide ${selector}`);
    return element;
  };
  const context = vm.createContext({
    buildPopupModel, URLSearchParams, location: { search: "" },
    document: { body: node(), querySelector: selector => nodes.get(selector), createElement: node },
    chrome: {
      runtime: { getManifest: () => ({ version: "test" }), sendMessage: async () => ({ ok: false }) },
      storage: {
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            if (names.includes("searchQuery") && readQuery) await readQuery();
            return Object.fromEntries(names.filter(key => key in state).map(key => [key, state[key]]));
          },
          async set(values) {
            if (writeQuery) await writeQuery(values.searchQuery);
            Object.assign(state, values);
            for (const listener of storageListeners) listener({ searchQuery: { newValue: state.searchQuery } }, "local");
          },
        },
        onChanged: { addListener: listener => storageListeners.push(listener) },
      },
    },
    console: { log() { assert.fail("Settings must not log query text"); } },
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/, ""), context);
  return {
    get, state,
    async type(value) { get("#search-query").value = value; await get("#search-query").fire("input"); },
    save: () => get("#search-settings-form").fire("submit"),
    async changeRun() {
      state.currentRun = { status: "running", results: [], progress: { current: 1, total: 2 } };
      for (const listener of storageListeners) listener({ currentRun: { newValue: state.currentRun } }, "local");
      await flush();
    },
  };
}

test("restores the locally saved search query when the popup opens", async () => {
  const page = popup({ query: "春季观星" });
  await flush();
  assert.equal(page.get("#search-query").value, "春季观星");
});

test("run updates do not replace an unsaved search query", async () => {
  const page = popup({ query: "原搜索词" });
  await flush();
  await page.type("正在编辑的搜索词");
  await page.changeRun();
  assert.equal(page.get("#status-badge").textContent, "正在领取 1/2");
  assert.equal(page.get("#search-query").value, "正在编辑的搜索词");
  assert.equal(page.state.searchQuery, "原搜索词");
});

test("a delayed settings read cannot overwrite typing", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const page = popup({ query: "旧搜索词", readQuery: () => pending });
  await page.type("新搜索词");
  release();
  await flush();
  assert.equal(page.get("#search-query").value, "新搜索词");
});

test("saves trimmed query text without interpreting HTML", async () => {
  const page = popup();
  await flush();
  await page.type("  <b>观星 & 天气</b>  ");
  await page.save();
  assert.equal(page.state.searchQuery, "<b>观星 & 天气</b>");
  assert.equal(page.get("#search-query").value, "<b>观星 & 天气</b>");
  assert.match(page.get("#search-settings-feedback").textContent, /本机.*下次任务/);
  assert.doesNotMatch(page.get("#search-settings-feedback").textContent, /观星/);
});

test("saving an empty query disables search streaks", async () => {
  const page = popup({ query: "旧搜索词" });
  await flush();
  await page.type("   ");
  await page.save();
  assert.equal(page.state.searchQuery, "");
  assert.equal(page.get("#search-query").value, "");
  assert.match(page.get("#search-settings-feedback").textContent, /跳过搜索打卡/);
});

test("rejects control characters and overlong queries without replacing saved settings", async () => {
  for (const value of ["a\u0000b", "a\u001fb", "a\u007fb", " \n ", "x".repeat(201)]) {
    const page = popup({ query: "有效搜索词" });
    await flush();
    await page.type(value);
    await page.save();
    assert.equal(page.state.searchQuery, "有效搜索词");
    assert.equal(page.get("#search-query").value, value);
    assert.match(page.get("#search-settings-feedback").textContent, /200|控制字符/);
    assert.equal(page.get("#search-query").getAttribute("aria-invalid"), "true");
    assert.equal(page.get("#save-search-query").disabled, false);
  }
});

test("preserves the query after a storage failure and allows saving again", async () => {
  let attempts = 0;
  const page = popup({ query: "旧搜索词", writeQuery: async () => { if (++attempts === 1) throw new Error("Storage unavailable"); } });
  await flush();
  await page.type("  尚未保存的搜索词  ");
  await page.save();
  assert.equal(page.state.searchQuery, "旧搜索词");
  assert.equal(page.get("#search-query").value, "  尚未保存的搜索词  ");
  assert.match(page.get("#search-settings-feedback").textContent, /保存失败/);
  assert.equal(page.get("#save-search-query").disabled, false);
  await page.save();
  assert.equal(page.state.searchQuery, "尚未保存的搜索词");
});

test("a failed settings read leaves the input usable", async () => {
  const page = popup({ readQuery: async () => { throw new Error("Storage unavailable"); } });
  await flush();
  assert.match(page.get("#search-settings-feedback").textContent, /读取.*失败/);
  await page.type("观星天气");
  await page.save();
  assert.equal(page.state.searchQuery, "观星天气");
});

test("finishing a save preserves a newer edit and identifies it as unsaved", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const page = popup({ writeQuery: () => pending });
  await flush();
  await page.type("已提交的词");
  const saving = page.save();
  await page.type("保存期间新输入的词");
  release();
  await saving;
  assert.equal(page.state.searchQuery, "已提交的词");
  assert.equal(page.get("#search-query").value, "保存期间新输入的词");
  assert.match(page.get("#search-settings-feedback").textContent, /尚未保存/);
});

test("search streak outcomes and helper failures have readable explanations", () => {
  const reasons = [
    "SEARCH_STREAK", "SEARCH_STREAK_COMPLETED", "SEARCH_QUERY_REQUIRED", "SEARCH_QUERY_INVALID",
    "SEARCH_FORM_UNAVAILABLE", "SEARCH_FORM_UNSAFE", "SEARCH_FORM_INVALID", "SEARCH_PAGE_UNSUPPORTED",
    "SEARCH_SUBMIT_UNAVAILABLE", "SEARCH_SUBMIT_FAILED", "SEARCH_SUBMIT_CANCELLED",
    "SEARCH_STREAK_NOT_CONFIRMED", "SEARCH_STREAK_DATE_CHANGED",
  ];
  const model = buildPopupModel({ lastRun: { status: "completed", results: reasons.map(reason => ({ reason })) } });
  for (const item of model.groups[0].items) assert.match(item.reasonLabel, /[\u3400-\u9fff]/, item.reason);
  assert.match(model.groups[0].items[1].reasonLabel, /1\/1/);
  assert.match(model.groups[0].items[2].reasonLabel, /设置/);
});

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  collectDailySearchTerms,
  createDailySearchDelay,
  normalizeDailySearchProgress,
  selectDailySearchQuery,
} from "../src/shared/daily-search.js";

test("daily progress preserves a same-day count and normalizes independent query history", () => {
  assert.deepEqual(normalizeDailySearchProgress({
    dateKey: "2026-10-19", completed: 2,
    queries: ["  上海   天气  ", "上海 天气", "NASA Moon", "nasa moon", "今天新闻", "123", null, "https://bing.com"],
  }, "2026-10-19"), {
    dateKey: "2026-10-19", completed: 2, queries: ["上海 天气", "NASA Moon", "今天新闻"],
  });
});

test("daily progress resets on a new date and rejects invalid counters", () => {
  const empty = { dateKey: "2026-10-19", completed: 0, queries: [] };
  assert.deepEqual(normalizeDailySearchProgress(null, empty.dateKey), empty);
  assert.deepEqual(normalizeDailySearchProgress({ dateKey: "2026-10-18", completed: 20, queries: ["旧新闻"] }, empty.dateKey), empty);
  for (const completed of [-1, 21, 2.5, "20", NaN, Infinity]) {
    assert.equal(normalizeDailySearchProgress({ dateKey: empty.dateKey, completed }, empty.dateKey).completed, 0);
  }
  for (const completed of [0, 1, 20]) {
    assert.equal(normalizeDailySearchProgress({ dateKey: empty.dateKey, completed }, empty.dateKey).completed, completed);
  }
});

test("delay stays between eight and fifteen seconds with inclusive integer bounds", () => {
  assert.equal(createDailySearchDelay(() => 0), 8000);
  assert.equal(createDailySearchDelay(() => 1), 15000);
  assert.equal(createDailySearchDelay(() => -10), 8000);
  assert.equal(createDailySearchDelay(() => 10), 15000);
  for (const value of [0.1, 0.25, 0.5, 0.9999, NaN, Infinity]) {
    const delay = createDailySearchDelay(() => value);
    assert.ok(Number.isInteger(delay) && delay >= 8000 && delay <= 15000);
  }
});

test("query selection randomizes unique normalized page terms without repeating history", () => {
  const candidates = ["  中国   科学  ", "中国 科学", "NASA Moon", "nasa moon", "今日 天气"];
  assert.equal(selectDailySearchQuery(candidates, ["NASA MOON"], () => 0), "中国 科学");
  assert.equal(selectDailySearchQuery(candidates, ["NASA MOON"], () => 1), "今日 天气");
  assert.equal(selectDailySearchQuery(candidates, ["中国 科学", "nasa moon", "今日 天气"]), null);
  assert.equal(selectDailySearchQuery(null), null);
});

test("query validation rejects links, control characters, numeric-only values and tiny strings", () => {
  const invalid = [
    "", "  ", "中", "123456", "１２３４", "!?", "https://www.bing.com/search?q=weather", "www.bing.com",
    "bing.com/search", "例子.中国", "//bing.com/search", "javascript:alert(1)", "Weather https://example.com", "bad\u0000query", "bad\nquery", {}, 123,
  ];
  assert.equal(selectDailySearchQuery(invalid), null);
  const long = "A long page headline ".repeat(10);
  const selected = selectDailySearchQuery([long], [], () => 0);
  assert.ok(selected.length <= 80);
  assert.equal(selectDailySearchQuery([long], [selected], () => 0), null);
  assert.equal(selectDailySearchQuery(["C++ 2026", "二〇二六年新闻"], [], () => 1), "二〇二六年新闻");
  assert.equal(selectDailySearchQuery(["NASA: Moon research"], [], () => 0), "NASA: Moon research");
});

function node(value, { href, title, hidden = false, excluded = false, style = {} } = {}) {
  return {
    innerText: value, textContent: value, hidden, style,
    getClientRects: () => hidden ? [] : [{}],
    getAttribute: name => name === "href" ? href ?? null : name === "title" ? title ?? null : null,
    closest: selector => {
      assert.match(selector, /rewards/);
      assert.match(selector, /history/);
      assert.match(selector, /navigation/);
      return excluded ? {} : null;
    },
  };
}

function collectPage({ url = "https://www.bing.com/", results = [], related = [], anchors = [], headlines = [], headings = [] } = {}) {
  const reads = [];
  const document = {
    querySelectorAll(selector) {
      reads.push(selector);
      if (selector === "#b_results h2 a, #b_results h2") return results;
      if (selector.startsWith("#b_rs ")) return related;
      if (selector === "a[href]") return anchors;
      if (selector.startsWith("#headline ")) return headlines;
      if (selector === "h1, h2") return headings;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    defaultView: { getComputedStyle: element => ({ display: "block", visibility: "visible", opacity: "1", ...element.style }) },
  };
  const collect = vm.runInNewContext(`(${collectDailySearchTerms.toString()})`, { document, location: { href: url }, URL });
  return { terms: Array.from(collect()), reads };
}

test("collects visible result headings and trusted related search destinations", () => {
  const page = collectPage({
    url: "https://cn.bing.com/search?q=weather",
    results: [node("  中国\n科学新闻 "), node("中国 科学新闻"), node("Hidden result", { hidden: true }), node("Private text", { excluded: true }), node("Invisible result", { style: { visibility: "hidden" } })],
    related: [
      node("Read more", { href: "/search?q=Moon+research" }),
      node("相关搜索", { href: "https://www.bing.com/search?q=%E4%BB%8A%E6%97%A5%E5%A4%A9%E6%B0%94" }),
      node("Hidden", { href: "/search?q=hidden+query", hidden: true }),
      node("Other host", { href: "https://bing.com.evil.example/search?q=attack" }),
      node("Insecure", { href: "http://bing.com/search?q=insecure" }),
      node("Duplicate q", { href: "/search?q=first&q=second" }),
      node("Wrong path", { href: "/images/search?q=image+query" }),
      node("Credentials", { href: "https://user@www.bing.com/search?q=private" }),
    ],
    anchors: [node("Search navigation", { href: "/search?q=Should+not+scan+all+result+links" })],
  });
  assert.deepEqual(page.terms, ["中国 科学新闻", "Moon research", "今日天气"]);
  assert.ok(!page.reads.includes("a[href]"));
});

test("a fresh locale homepage supplies hot queries without relying on presentation classes", () => {
  const page = collectPage({
    url: "https://cn.bing.com/",
    anchors: [
      node("热门新闻", { href: "/search?q=%E5%9B%BD%E5%BA%86%E6%97%85%E6%B8%B8&form=HPQH" }),
      node("今日科技", { href: "https://www.bing.com/search?q=Space+exploration" }),
      node("History item", { href: "/search?q=My+personal+query", excluded: true }),
      node("Rewards", { href: "/search?q=Rewards+task", excluded: true }),
      node("Account", { href: "/search?q=My+account", excluded: true }),
      node("external", { href: "https://example.com/search?q=External+query" }),
      node("hidden", { href: "/search?q=Hidden+query", hidden: true }),
      node("link only", { href: "/search?q=" }),
    ],
  });
  assert.deepEqual(page.terms, ["国庆旅游", "Space exploration"]);
  assert.ok(page.reads.includes("a[href]"));
});

test("collects known visible homepage/news headlines and avoids arbitrary body or input content", () => {
  const page = collectPage({
    headlines: [
      node("A daily photo title"), node("Ignored display text", { title: "Bing homepage news title" }),
      node("登录"), node("Microsoft Rewards"), node("Hidden title", { style: { opacity: "0" } }),
    ],
    headings: [node("Fallback should not be read when headline seeds exist")],
  });
  assert.deepEqual(page.terms, ["A daily photo title", "Bing homepage news title"]);
  assert.ok(!page.reads.includes("h1, h2"));
  assert.ok(page.reads.every(selector => !selector.includes("input") && !selector.includes("body")));
  assert.deepEqual(collectPage({ url: "https://www.bing.com/news", headlines: [node("Today science headline")], anchors: [node("Unbounded news link", { href: "/search?q=Do+not+use" })] }).terms, ["Today science headline"]);
});

test("uses visible public homepage headings only as a final seed fallback", () => {
  assert.deepEqual(collectPage({ headings: [node("Daily landscape photograph"), node("Account greeting", { excluded: true }), node(" ")] }).terms, ["Daily landscape photograph"]);
});

test("collector rejects untrusted origins before reading any page content", () => {
  for (const url of ["http://www.bing.com/", "https://bing.com.evil.example/", "https://evilbing.com/", "https://user@www.bing.com/", "about:blank", "not-a-url"]) {
    const page = collectPage({ url, headings: [node("Must not collect")] });
    assert.deepEqual(page.terms, [], url);
    assert.deepEqual(page.reads, [], url);
  }
});

test("each shared helper survives isolated serialization for userscript/injected execution", () => {
  const normalize = vm.runInNewContext(`(${normalizeDailySearchProgress.toString()})`);
  assert.equal(JSON.stringify(normalize({ dateKey: "today", completed: 20, queries: ["Page title"] }, "today")), '{"dateKey":"today","completed":20,"queries":["Page title"]}');
  const delay = vm.runInNewContext(`(${createDailySearchDelay.toString()})`);
  assert.equal(delay(() => 0), 8000);
  const select = vm.runInNewContext(`(${selectDailySearchQuery.toString()})`);
  assert.equal(select(["A page title"], [], () => 0), "A page title");
  const collect = vm.runInNewContext(`(${collectDailySearchTerms.toString()})`, { URL });
  assert.equal(JSON.stringify(collect()), "[]");
});

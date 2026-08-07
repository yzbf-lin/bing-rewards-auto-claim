import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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

test("userscript reports an explicit reason for an interactive quiz", () => {
  const api = loadApi();
  const result = api.classifyEntry({
    section: "每日活动",
    title: "艺术叛逆者？",
    text: "测试你对弗里达·卡罗的了解 +10",
    kind: "link",
    url: "https://www.bing.com/search?q=Frida&form=dsetqu&filters=BingQA_QuizLanding_Layout",
    disabled: false,
  });

  assert.equal(result.reason, "INTERACTIVE_QUIZ");
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

test("userscript panel includes structured run logs", () => {
  assert.match(source, /data-role="logs"/);
  assert.match(source, /QUEST_RESCANNED/);
  assert.match(source, /CARD_CLICK/);
});

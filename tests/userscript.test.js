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

function loadApi() {
  const context = vm.createContext({
    __BING_REWARDS_USERSCRIPT_TEST__: true,
    URL,
  });
  vm.runInContext(source, context);
  return context.__BING_REWARDS_USERSCRIPT_API__;
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

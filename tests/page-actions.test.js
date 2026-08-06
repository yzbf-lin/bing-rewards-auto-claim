import test from "node:test";
import assert from "node:assert/strict";

import {
  activateRewardsButton,
  collectDashboardEntries,
  collectRewardsEntries,
} from "../src/content/page-actions.js";

const SECTION_NAMES = ["连续打卡任务", "升级活动", "任务", "日常任务"];

function card({ tagName = "A", text = "领取奖励 +5", title = "领取奖励", href = null, disabled = false } = {}) {
  const attributes = new Map();
  if (href) attributes.set("href", href);
  if (disabled) attributes.set("aria-disabled", "true");

  return {
    tagName,
    innerText: text,
    textContent: text,
    href,
    disabled,
    parentElement: null,
    clicked: false,
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    querySelector(selector) {
      if (selector === "img[alt]") {
        return { getAttribute: () => title };
      }
      return null;
    },
    matches(selector) {
      return selector.includes("a") ? tagName === "A" : tagName === "BUTTON";
    },
    click() {
      this.clicked = true;
    },
  };
}

function group(name, cards) {
  const value = {
    parentElement: null,
    getAttribute(attribute) {
      return attribute === "aria-label" ? name : null;
    },
    querySelectorAll() {
      return cards;
    },
  };
  for (const item of cards) item.parentElement = value;
  return value;
}

function installDocument(groups, headings = SECTION_NAMES, labelElements = {}) {
  const document = {
    querySelectorAll(selector) {
      if (selector === "h2") {
        return headings.map((textContent) => ({ textContent, parentElement: null }));
      }
      if (selector === '[role="group"]') return groups;
      return [];
    },
    querySelector(selector) {
      const match = selector.match(/data-rewards-auto-id="([^"]+)"/);
      if (!match) return null;
      for (const currentGroup of groups) {
        const found = currentGroup.querySelectorAll().find(
          (item) => item.getAttribute("data-rewards-auto-id") === match[1],
        );
        if (found) return found;
      }
      return null;
    },
    getElementById(id) {
      return labelElements[id] ?? null;
    },
  };
  globalThis.document = document;
  return document;
}

test("collects top-level cards from all four Rewards sections", () => {
  const dailyLink = card({ href: "https://example.com/daily" });
  const dailyButton = card({ tagName: "BUTTON", text: "领取 +10" });
  const groups = SECTION_NAMES.map((name) =>
    group(name, name === "日常任务" ? [dailyLink, dailyButton] : []),
  );
  installDocument(groups);

  const result = collectRewardsEntries();

  assert.deepEqual(result.missingSections, []);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((item) => item.kind), ["link", "button"]);
  assert.equal(result.entries[0].section, "日常任务");
  assert.equal(result.entries[0].url, "https://example.com/daily");
  assert.match(result.entries[0].id, /^reward-entry-/);
});

test("reports a missing target section", () => {
  const groups = SECTION_NAMES.slice(0, 3).map((name) => group(name, []));
  installDocument(groups, SECTION_NAMES.slice(0, 3));

  assert.deepEqual(collectRewardsEntries().missingSections, ["日常任务"]);
});

test("matches a section group named through aria-labelledby", () => {
  const target = card({ href: "https://example.com/daily" });
  const groups = SECTION_NAMES.map((name) => group(name, name === "日常任务" ? [target] : []));
  const dailyGroup = groups.at(-1);
  dailyGroup.getAttribute = (attribute) => {
    if (attribute === "aria-labelledby") return "daily-section-title";
    return null;
  };
  installDocument(groups, SECTION_NAMES, {
    "daily-section-title": {
      textContent: "",
      getAttribute(attribute) {
        return attribute === "aria-label" ? "日常任务" : null;
      },
    },
  });

  const result = collectRewardsEntries();

  assert.deepEqual(result.missingSections, []);
  assert.equal(result.entries.length, 1);
});

test("activates exactly the tagged button", async () => {
  const target = card({ tagName: "BUTTON" });
  const groups = [group("日常任务", [target])];
  installDocument(groups, ["日常任务"]);
  target.setAttribute("data-rewards-auto-id", "reward-entry-3");

  assert.equal(await activateRewardsButton("reward-entry-3"), true);
  assert.equal(target.clicked, true);
  assert.equal(await activateRewardsButton("missing"), false);
});

test("collects explicit reward links from the Rewards dashboard", () => {
  const browseEarn = card({
    text: "浏览赚取页面 了解如何收集更多积分 +10",
    title: "浏览赚取页面",
    href: "https://rewards.bing.com/earn",
  });
  const dailyTopic = card({
    text: "解码历史 了解古埃及的符号 +10",
    title: "解码历史",
    href: "https://www.bing.com/search?q=egypt&rnoreward=1",
  });
  const noReward = card({
    text: "免费专属壁纸",
    title: "免费专属壁纸",
    href: "https://www.bing.com/apps/wallpaper",
  });
  installDocument([]);
  document.querySelectorAll = (selector) =>
    selector === "a[href], button" ? [browseEarn, dailyTopic, noReward] : [];

  const result = collectDashboardEntries();

  assert.deepEqual(result.missingSections, []);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((item) => item.section), ["积分首页", "积分首页"]);
  assert.equal(result.entries[1].url, "https://www.bing.com/search?q=egypt&rnoreward=1");
});

test("labels dashboard cards through their aria-labelledby group", () => {
  const dailyTopic = card({
    text: "化学大佬？ 通过这个有趣的测验挑战 +10",
    title: "化学大佬？",
    href: "https://www.bing.com/search?q=quiz",
  });
  const dailyGroup = group(null, [dailyTopic]);
  dailyGroup.getAttribute = (attribute) =>
    attribute === "aria-labelledby" ? "daily-activity-label" : null;
  dailyTopic.closest = (selector) => selector === '[role="group"]' ? dailyGroup : null;
  installDocument([], SECTION_NAMES, {
    "daily-activity-label": {
      getAttribute(attribute) {
        return attribute === "aria-label" ? "每日活动" : null;
      },
    },
  });
  document.querySelectorAll = (selector) =>
    selector === "a[href], button" ? [dailyTopic] : [];

  const result = collectDashboardEntries();

  assert.equal(result.entries[0].section, "每日活动");
});

test("collects a positive claimable-points button", () => {
  const claimable = card({
    tagName: "BUTTON",
    text: "可领取 可领取 90 领取",
    title: "可领取",
  });
  const empty = card({
    tagName: "BUTTON",
    text: "可领取 可领取 0 领取",
    title: "可领取",
  });
  installDocument([]);
  document.querySelectorAll = (selector) =>
    selector === "a[href], button" ? [claimable, empty] : [];

  const result = collectDashboardEntries();

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].section, "待领取积分");
  assert.equal(result.entries[0].kind, "button");
  assert.equal(result.entries[0].action, "claim-points");
});

test("confirms the claim-points dialog after activating its card", async () => {
  const claimable = card({ tagName: "BUTTON", text: "可领取 90 领取" });
  const confirm = card({ tagName: "BUTTON", text: "领取积分" });
  confirm.closest = (selector) => selector === '[role="dialog"]' ? {} : null;
  const groups = [group("待领取积分", [claimable])];
  installDocument(groups);
  claimable.setAttribute("data-rewards-auto-id", "claimable-points");
  claimable.setAttribute("data-rewards-auto-action", "claim-points");
  const originalQuerySelectorAll = document.querySelectorAll;
  document.querySelectorAll = (selector) =>
    selector === "button" ? [claimable, confirm] : originalQuerySelectorAll(selector);

  assert.equal(await activateRewardsButton("claimable-points"), true);
  assert.equal(claimable.clicked, true);
  assert.equal(confirm.clicked, true);
});

test.after(() => {
  delete globalThis.document;
});

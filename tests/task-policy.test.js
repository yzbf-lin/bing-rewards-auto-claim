import test from "node:test";
import assert from "node:assert/strict";

import { classifyEntry } from "../src/shared/task-policy.js";

function entry(overrides = {}) {
  return {
    title: "浏览今日推荐",
    text: "浏览今日推荐 +5",
    url: "https://example.com/reward",
    kind: "link",
    disabled: false,
    ...overrides,
  };
}

test("allows a one-step link with an explicit reward", () => {
  assert.deepEqual(classifyEntry(entry()), {
    decision: "ELIGIBLE",
    reason: "ONE_STEP_REWARD",
    rewardPoints: 5,
  });
});

test("allows a one-click button with an explicit reward", () => {
  assert.deepEqual(
    classifyEntry(entry({ kind: "button", url: null, text: "领取今日奖励 +10" })),
    {
      decision: "ELIGIBLE",
      reason: "ONE_STEP_REWARD",
      rewardPoints: 10,
    },
  );
});

test("skips disabled and completed cards", () => {
  assert.equal(classifyEntry(entry({ disabled: true })).reason, "DISABLED");
  assert.equal(classifyEntry(entry({ text: "浏览今日推荐 5 已完成" })).reason, "COMPLETED");
});

test("skips cards without an explicit points reward", () => {
  assert.deepEqual(classifyEntry(entry({ text: "免费专属壁纸" })), {
    decision: "SKIPPED",
    reason: "NO_REWARD_SIGNAL",
    rewardPoints: null,
  });
});

test("skips search, quiz, puzzle, purchase and streak tasks", () => {
  const cases = [
    entry({ title: "每日搜索", url: "https://www.bing.com/search?q=test" }),
    entry({ title: "参加知识测验" }),
    entry({ title: "完成此拼图", url: "https://www.bing.com/spotlight/imagepuzzle" }),
    entry({ title: "购买 Game Pass" }),
    entry({ title: "连续签到 7 天" }),
    entry({
      title: "开始使用 Rewards",
      text: "开始使用 Rewards +1320 2/7 个任务",
      url: "https://rewards.bing.com/earn/quest/example_punchcard",
    }),
  ];

  for (const candidate of cases) {
    const result = classifyEntry(candidate);
    assert.equal(result.decision, "SKIPPED");
    assert.equal(result.reason, "COMPLEX_TASK");
  }
});

test("skips ambiguous entry types", () => {
  assert.deepEqual(classifyEntry(entry({ kind: "unknown" })), {
    decision: "SKIPPED",
    reason: "UNSUPPORTED_ENTRY_TYPE",
    rewardPoints: 5,
  });
});

test("parses reward values that contain thousands separators", () => {
  assert.deepEqual(
    classifyEntry(entry({
      title: "开始使用 Rewards",
      text: "开始使用 Rewards +1,320 3/7 个任务",
      url: "https://rewards.bing.com/earn/quest/example_punchcard",
    })),
    {
      decision: "SKIPPED",
      reason: "COMPLEX_TASK",
      rewardPoints: 1320,
    },
  );
});

test("recognizes a dashboard one-click topic while keeping normal searches skipped", () => {
  assert.deepEqual(
    classifyEntry(entry({
      section: "积分首页",
      title: "解码历史",
      text: "解码历史 了解古埃及的符号 +10",
      url: "https://www.bing.com/search?q=egypt&form=ML2G76&rnoreward=1",
    })),
    {
      decision: "ELIGIBLE",
      reason: "KNOWN_ONE_STEP_REWARD",
      rewardPoints: 10,
    },
  );

  assert.equal(
    classifyEntry(entry({
      title: "完成 3 次搜索",
      text: "完成 3 次搜索 +10",
      url: "https://www.bing.com/search?q=test",
    })).reason,
    "COMPLEX_TASK",
  );
});

test("recognizes every enabled daily-activity link as one-click", () => {
  assert.deepEqual(
    classifyEntry(entry({
      section: "每日活动",
      title: "化学大佬？",
      text: "通过这个有趣的测验挑战 +10",
      url: "https://www.bing.com/search?q=quiz",
    })),
    {
      decision: "ELIGIBLE",
      reason: "KNOWN_ONE_STEP_REWARD",
      rewardPoints: 10,
    },
  );
});

test("uses a daily-activity points badge when card text has no plus sign", () => {
  assert.deepEqual(
    classifyEntry(entry({
      section: "每日活动",
      title: "自然奇观",
      text: "自然奇观 探索今日主题 10",
      rewardPoints: 10,
      url: "https://www.bing.com/search?q=nature&rnoreward=1",
    })),
    {
      decision: "ELIGIBLE",
      reason: "KNOWN_ONE_STEP_REWARD",
      rewardPoints: 10,
    },
  );
});

test("recognizes a positive claimable-points button", () => {
  assert.deepEqual(
    classifyEntry(entry({
      section: "待领取积分",
      title: "领取待领取积分",
      text: "可领取 可领取 90 领取",
      kind: "button",
      url: null,
    })),
    {
      decision: "ELIGIBLE",
      reason: "KNOWN_ONE_STEP_REWARD",
      rewardPoints: 90,
    },
  );
});

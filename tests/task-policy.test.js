import test from "node:test";
import assert from "node:assert/strict";

import { analyzeEntryFeatures, classifyEntry } from "../src/shared/task-policy.js";

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

test("does not treat partial streak wording as a completed task", () => {
  const result = classifyEntry(entry({
    section: "连续打卡任务",
    title: "每日连续打卡活动",
    text: "已完成连续打卡 1 天，共 7 天。完成下一天即可赚取 30 积分。活动: 0/3",
    kind: "button",
    url: null,
  }));

  assert.equal(result.decision, "SKIPPED");
  assert.equal(result.reason, "COMPLEX_TASK");
});

test("recognizes a task as completed when every visible progress value reaches its target", () => {
  assert.equal(
    classifyEntry(entry({
      text: "每日活动 活动: 3/3",
    })).reason,
    "COMPLETED",
  );
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
    [entry({ title: "每日搜索", url: "https://www.bing.com/search?q=test" }), "COMPLEX_TASK"],
    [entry({ title: "参加知识测验" }), "INTERACTIVE_QUIZ"],
    [entry({ title: "完成此拼图", url: "https://www.bing.com/spotlight/imagepuzzle" }), "COMPLEX_TASK"],
    [entry({ title: "购买 Game Pass" }), "COMPLEX_TASK"],
    [entry({ title: "连续签到 7 天" }), "COMPLEX_TASK"],
    [entry({
      title: "开始使用 Rewards",
      text: "开始使用 Rewards +1320 2/7 个任务",
      url: "https://rewards.bing.com/earn/quest/example_punchcard",
    }), "COMPLEX_TASK"],
  ];

  for (const [candidate, expectedReason] of cases) {
    const result = classifyEntry(candidate);
    assert.equal(result.decision, "SKIPPED");
    assert.equal(result.reason, expectedReason);
  }
});

test("skips traditional-Chinese install tasks", () => {
  const result = classifyEntry(entry({
    section: "日常任务",
    title: "瀏覽器裡的 Rewards",
    text: "安裝最新的瀏覽器擴充功能，並賺取 10 點積分。",
    url: "https://www.bing.com/set/browserextension/rewards",
  }));

  assert.equal(result.decision, "SKIPPED");
  assert.equal(result.reason, "COMPLEX_TASK");
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

test("parses localized point labels", () => {
  assert.equal(
    classifyEntry(entry({ text: "打开活动即可获得 5 點" })).rewardPoints,
    5,
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
      reason: "FEATURE_MATCHED_ONE_STEP",
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

test("recognizes an unseen one-step task from page features", () => {
  const candidate = entry({
    source: "earn",
    section: "日常任务",
    title: "全新主题活动",
    text: "全新主题活动 +8",
    url: "https://rewards.bing.com/promo/new-topic",
    signals: {
      opensNewTab: true,
      hasProgress: false,
      hasRewardBadge: true,
      clickOnlyCue: false,
      completed: false,
    },
  });

  const features = analyzeEntryFeatures(candidate);
  assert.equal(features.genericOneStep, true);
  assert.ok(features.confidence >= 70);
  assert.deepEqual(classifyEntry(candidate), {
    decision: "ELIGIBLE",
    reason: "FEATURE_MATCHED_ONE_STEP",
    rewardPoints: 8,
  });
});

test("allows an observed daily task whose points badge has no plus sign", () => {
  assert.deepEqual(
    classifyEntry(entry({
      section: "日常任务",
      title: "達成目標！",
      text: "達成目標！ 恭喜您晉升到第 2 級。 5",
      rewardPoints: 5,
      url: "https://rewards.bing.com/levels?FORM=ML16O7",
      signals: {
        opensNewTab: true,
        hasProgress: false,
        hasRewardBadge: true,
        clickOnlyCue: false,
        completed: false,
      },
    })),
    {
      decision: "ELIGIBLE",
      reason: "FEATURE_MATCHED_ONE_STEP",
      rewardPoints: 5,
    },
  );
});

test("keeps a progress task out of generic one-step recognition", () => {
  const candidate = entry({
    source: "earn",
    section: "任务",
    title: "全新系列任务",
    text: "全新系列任务 +50 1/4 个任务",
    url: "https://rewards.bing.com/promo/new-series",
    signals: {
      opensNewTab: true,
      hasProgress: true,
      hasRewardBadge: true,
      clickOnlyCue: false,
      completed: false,
    },
  });

  const features = analyzeEntryFeatures(candidate);
  assert.equal(features.genericOneStep, false);
  assert.equal(classifyEntry(candidate).reason, "COMPLEX_TASK");
});

test("allows a daily-activity quiz card that credits on the original click", () => {
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

test("skips a daily-activity link without a points signal", () => {
  assert.deepEqual(
    classifyEntry(entry({
      section: "每日活动",
      title: "免费专属壁纸",
      text: "免费专属壁纸",
      url: "https://www.bing.com/apps/wallpaper",
    })),
    {
      decision: "SKIPPED",
      reason: "NO_REWARD_SIGNAL",
      rewardPoints: null,
    },
  );
});

test("allows an enabled click-to-complete quest child", () => {
  assert.deepEqual(
    classifyEntry(entry({
      section: "任务：八月活动",
      title: "探索八月优惠",
      text: "探索八月优惠，点击即可完成",
      action: "quest-step",
      rewardPoints: null,
      url: "https://www.bing.com/search?q=offers&rnoreward=1",
    })),
    {
      decision: "ELIGIBLE",
      reason: "KNOWN_ONE_STEP_REWARD",
      rewardPoints: null,
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

test("classifies the observed Rewards mix without skipping direct point links", () => {
  const directLinks = [
    entry({
      section: "日常任务",
      title: "達成目標！",
      text: "恭喜您晉升到第 2 級 +5",
      url: "https://rewards.bing.com/levels?FORM=ML16O7",
      signals: { opensNewTab: true, hasRewardBadge: true },
    }),
    entry({
      section: "每日活动",
      title: "温哥华清爽海岸",
      text: "非常适合徒步、骑行和海滩 +10",
      url: "https://www.bing.com/search?q=vancouver&filters=REWARDSQUIZ_DailySet_UrlOffer&rnoreward=1",
      signals: { opensNewTab: true, hasRewardBadge: true },
    }),
    entry({
      section: "日常任务",
      title: "設定目標",
      text: "設定第一個目標就可以賺取 100 點 +5",
      url: "https://rewards.bing.com/redeem/all?FORM=ML16O4",
      signals: { opensNewTab: true, hasRewardBadge: true },
    }),
  ];
  const interactiveLinks = [
    entry({
      section: "日常任务",
      title: "完成搜索",
      text: "只需完成3 searches即可获得10 points",
      url: "https://www.bing.com/?features=vstooltip",
    }),
    entry({
      section: "每日活动",
      title: "艺术叛逆者？",
      text: "测试你对弗里达·卡罗的了解 +10",
      url: "https://www.bing.com/search?q=Frida&form=dsetqu&filters=BingQA_QuizLanding_Layout",
    }),
  ];

  assert.deepEqual(directLinks.map((candidate) => classifyEntry(candidate).decision), [
    "ELIGIBLE",
    "ELIGIBLE",
    "ELIGIBLE",
  ]);
  assert.deepEqual(interactiveLinks.map((candidate) => classifyEntry(candidate).reason), [
    "COMPLEX_TASK",
    "KNOWN_ONE_STEP_REWARD",
  ]);
});

test("keeps a non-daily interactive quiz as a manual task", () => {
  assert.equal(
    classifyEntry(entry({
      section: "任务",
      title: "艺术知识测验",
      text: "回答三道题 +10",
      url: "https://www.bing.com/search?q=art&form=dsetqu",
    })).reason,
    "INTERACTIVE_QUIZ",
  );
});

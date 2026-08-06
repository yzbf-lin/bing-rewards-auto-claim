import test from "node:test";
import assert from "node:assert/strict";

import { buildPopupModel } from "../src/popup/model.js";

test("shows an active run and disables manual execution", () => {
  const model = buildPopupModel({
    currentRun: { status: "running", progress: { current: 1, total: 3 }, results: [] },
    lastRun: null,
  });

  assert.equal(model.statusLabel, "正在领取 1/3");
  assert.equal(model.actionDisabled, true);
});

test("formats the latest summary and groups entry results", () => {
  const model = buildPopupModel({
    currentRun: null,
    lastRun: {
      status: "completed",
      finishedAt: "2026-08-05T02:00:00.000Z",
      summary: { total: 3, completed: 1, skipped: 1, failed: 1 },
      results: [
        { section: "日常任务", title: "奖励 A", outcome: "COMPLETED", reason: "ACTION_TRIGGERED" },
        { section: "日常任务", title: "奖励 B", outcome: "SKIPPED", reason: "COMPLEX_TASK" },
      ],
    },
    taskMemory: {
      "task-a": { title: "奖励 A" },
      "task-b": { title: "奖励 B" },
    },
  });

  assert.equal(model.statusLabel, "上次领取已完成");
  assert.equal(model.summaryText, "完成 1 · 跳过 1 · 失败 1");
  assert.equal(model.memoryText, "已识别 2 个任务入口");
  assert.equal(model.groups[0].section, "日常任务");
  assert.equal(model.groups[0].items.length, 2);
});

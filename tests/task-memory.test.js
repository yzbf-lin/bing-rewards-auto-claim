import test from "node:test";
import assert from "node:assert/strict";

import { rememberTask, taskMemoryKey } from "../src/shared/task-memory.js";

const entry = {
  section: "积分首页",
  title: "解码历史",
  text: "解码历史 +10",
  kind: "link",
  url: "https://www.bing.com/search?q=egypt&form=ML2G76&rnoreward=1",
  signals: {
    opensNewTab: true,
    hasRewardBadge: true,
    hasProgress: false,
  },
};

test("builds a stable key and records recognition history", () => {
  const key = taskMemoryKey(entry);
  const first = rememberTask({}, {
    entry,
    decision: { decision: "ELIGIBLE", reason: "KNOWN_ONE_STEP_REWARD", rewardPoints: 10 },
    outcome: "COMPLETED",
    observedAt: "2026-08-06T01:00:00.000Z",
    dateKey: "2026-08-06",
  });
  const second = rememberTask(first, {
    entry,
    decision: { decision: "ELIGIBLE", reason: "KNOWN_ONE_STEP_REWARD", rewardPoints: 10 },
    outcome: "SKIPPED",
    observedAt: "2026-08-07T01:00:00.000Z",
    dateKey: "2026-08-07",
  });

  assert.equal(second[key].seenCount, 2);
  assert.equal(second[key].completedCount, 1);
  assert.equal(second[key].lastOutcome, "SKIPPED");
  assert.equal(second[key].lastCompletedDate, "2026-08-06");
  assert.equal(second[key].recognitionReason, "KNOWN_ONE_STEP_REWARD");
  assert.deepEqual(second[key].recognitionSignals, entry.signals);
});

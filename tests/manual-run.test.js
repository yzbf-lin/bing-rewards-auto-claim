import test from "node:test";
import assert from "node:assert/strict";

import { beginManualRun } from "../src/background/manual-run.js";

test("responds immediately while the manual run continues independently", async () => {
  let finishRun;
  const calls = [];
  const runner = {
    run(trigger, context) {
      calls.push(["run", trigger, context]);
      return new Promise((resolve) => {
        finishRun = resolve;
      });
    },
  };

  const started = beginManualRun({
    runner,
    targetTabId: 42,
    consumePendingAutomaticRun: async () => calls.push(["consume"]),
    logger: { warn() {} },
  });

  assert.deepEqual(started.response, { ok: true, started: true });
  assert.deepEqual(calls, [["run", "manual", { targetTabId: 42 }]]);

  finishRun();
  await started.completion;
  assert.deepEqual(calls, [
    ["run", "manual", { targetTabId: 42 }],
    ["consume"],
  ]);
});

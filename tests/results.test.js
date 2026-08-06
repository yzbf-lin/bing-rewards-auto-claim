import test from "node:test";
import assert from "node:assert/strict";

import { summarizeResults } from "../src/background/results.js";

test("summarizes completed, skipped and failed actions", () => {
  assert.deepEqual(
    summarizeResults([
      { outcome: "COMPLETED" },
      { outcome: "COMPLETED" },
      { outcome: "SKIPPED" },
      { outcome: "FAILED" },
    ]),
    { total: 4, completed: 2, skipped: 1, failed: 1 },
  );
});

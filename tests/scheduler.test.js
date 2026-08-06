import test from "node:test";
import assert from "node:assert/strict";

import {
  beijingDateKey,
  nextBeijingRunAt,
  shouldCatchUp,
} from "../src/background/scheduler.js";

test("returns today's 09:00 before the Beijing deadline", () => {
  const now = new Date("2026-08-05T00:30:00.000Z");
  assert.equal(nextBeijingRunAt(now).toISOString(), "2026-08-05T01:00:00.000Z");
});

test("returns tomorrow's 09:00 after the Beijing deadline", () => {
  const now = new Date("2026-08-05T01:30:00.000Z");
  assert.equal(nextBeijingRunAt(now).toISOString(), "2026-08-06T01:00:00.000Z");
});

test("uses the Beijing calendar date", () => {
  assert.equal(beijingDateKey(new Date("2026-08-04T16:30:00.000Z")), "2026-08-05");
});

test("catches up only after 09:00 when today has not run", () => {
  assert.equal(
    shouldCatchUp({ now: new Date("2026-08-05T00:59:59.000Z"), lastAutomaticDate: "2026-08-04" }),
    false,
  );
  assert.equal(
    shouldCatchUp({ now: new Date("2026-08-05T01:00:00.000Z"), lastAutomaticDate: "2026-08-04" }),
    true,
  );
  assert.equal(
    shouldCatchUp({ now: new Date("2026-08-05T02:00:00.000Z"), lastAutomaticDate: "2026-08-05" }),
    false,
  );
});

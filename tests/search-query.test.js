import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRandomSearchQuery } from "../src/shared/search-query.js";

test("random search queries encode fresh browser random bytes as 16 safe characters", t => {
  let calls = 0;
  t.mock.method(globalThis.crypto, "getRandomValues", bytes => {
    assert.equal(bytes.length, 8);
    bytes.set(calls++ ? [255, 254, 253, 252, 251, 250, 249, 248] : [0, 1, 15, 16, 127, 128, 254, 255]);
    return bytes;
  });
  assert.equal(createRandomSearchQuery(), "00010f107f80feff");
  assert.equal(createRandomSearchQuery(), "fffefdfcfbfaf9f8");
  assert.equal(calls, 2);
});

test("random generation fails explicitly when the browser random source is unavailable", () => {
  const source = readFileSync(new URL("../src/shared/search-query.js", import.meta.url), "utf8").replace("export function", "function");
  for (const crypto of [undefined, { getRandomValues() { throw new Error("unavailable"); } }]) {
    const context = vm.createContext({ crypto });
    vm.runInContext(source, context);
    assert.throws(() => context.createRandomSearchQuery(), /SEARCH_QUERY_GENERATION_FAILED/);
  }
});

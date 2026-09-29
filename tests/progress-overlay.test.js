import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/content/progress-overlay.js", import.meta.url), "utf8");

function overlay() {
  const frame = { contentWindow: {} };
  const messages = [];
  const statuses = [];
  let closeCount = 0;
  let ensureCount = 0;
  let frameCount = 0;
  let storageListener;
  let resolveInitial;
  const context = vm.createContext({
    document: { getElementById: () => null, createElement: () => frame },
    window: { addEventListener: (name, listener) => { if (name === "message") messages.push(listener); } },
    chrome: {
      runtime: { getURL: path => `chrome-extension://test/${path}` },
      storage: {
        local: {
          get: () => new Promise(resolve => { resolveInitial = resolve; }),
          set: async () => {},
        },
        onChanged: { addListener: listener => { storageListener = listener; } },
      },
    },
    createRewardsFloatingWidget: () => ({
      content: { append: () => { frameCount++; } },
      ensureVisible: () => { ensureCount++; },
      close: () => { closeCount++; },
      setStatus: value => statuses.push(value.running),
    }),
  });
  const inject = () => vm.runInContext(source, context);
  inject();
  return { frame, messages, statuses, inject,
    change: value => storageListener({ currentRun: { newValue: value } }, "local"),
    resolveInitial: value => resolveInitial(value),
    counts: () => ({ closeCount, ensureCount, frameCount }),
  };
}

test("only the embedded extension frame can request closing the panel", () => {
  const runtime = overlay();
  const send = runtime.messages[0];
  const valid = { source: runtime.frame.contentWindow, origin: "chrome-extension://test", data: { type: "BING_REWARDS_PANEL_CLOSE" } };
  send({ ...valid, source: {} });
  send({ ...valid, origin: "https://www.bing.com" });
  send({ ...valid, data: { type: "OTHER" } });
  assert.equal(runtime.counts().closeCount, 0);
  send(valid);
  assert.equal(runtime.counts().closeCount, 1);
  assert.equal(runtime.frame.src, "chrome-extension://test/src/popup/popup.html?embedded=1");
});

test("reinjection reuses the widget and a delayed initial read cannot reset its running status", async () => {
  const runtime = overlay();
  runtime.inject();
  assert.deepEqual(runtime.counts(), { closeCount: 0, ensureCount: 1, frameCount: 1 });
  assert.equal(runtime.messages.length, 1);
  runtime.change({ status: "running" });
  runtime.resolveInitial({ currentRun: { status: "completed" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.statuses, [true]);
  runtime.change({ status: "completed" });
  assert.deepEqual(runtime.statuses, [true, false]);
});

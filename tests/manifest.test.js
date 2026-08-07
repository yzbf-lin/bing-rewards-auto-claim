import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

test("manifest uses minimal permissions and references existing files", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, [
    "https://*.bing.com/*",
    "https://api.github.com/*",
  ]);
  assert.equal(manifest.permissions.includes("downloads"), true);
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  await access(new URL(`../${manifest.background.service_worker}`, import.meta.url));
  await access(new URL(`../${manifest.action.default_popup}`, import.meta.url));
  await access(new URL(`../${manifest.content_scripts[0].js[0]}`, import.meta.url));
});

test("progress overlay persists and restores the latest run after navigation", async () => {
  const source = await readFile(
    new URL("../src/content/progress-overlay.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /get\(\["currentRun", "lastRun"\]\)/);
  assert.match(source, /globalThis\[INSTANCE_KEY\] = \{ refresh \}/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => host\.remove\(\)/);
});

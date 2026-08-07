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
  const embeddedResources = manifest.web_accessible_resources[0].resources;
  assert.equal(embeddedResources.includes("src/popup/popup.html"), true);
  assert.equal(embeddedResources.includes("src/popup/model.js"), true);
});

test("page progress panel embeds the same popup component", async () => {
  const source = await readFile(
    new URL("../src/content/progress-overlay.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /src\/popup\/popup\.html\?embedded=1/);
  assert.match(source, /document\.createElement\("iframe"\)/);
  assert.match(source, /globalThis\[INSTANCE_KEY\] = \{ ensureVisible \}/);
  assert.doesNotMatch(source, /attachShadow/);
});

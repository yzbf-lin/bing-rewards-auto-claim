import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions, fetchLatestRelease } from "../src/background/update-checker.js";

test("compares dotted extension versions numerically", () => {
  assert.equal(compareVersions("0.2.10", "0.2.9"), 1);
  assert.equal(compareVersions("v1.0.0", "1.0"), 0);
  assert.equal(compareVersions("0.2.5", "0.2.6"), -1);
});

test("returns a trusted GitHub release update with its zip asset", async () => {
  const status = await fetchLatestRelease({
    currentVersion: "0.2.5",
    now: () => new Date("2026-08-06T08:00:00.000Z"),
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          tag_name: "v0.2.6",
          html_url: "https://github.com/yzbf-lin/bing-rewards-auto-claim/releases/tag/v0.2.6",
          assets: [{
            name: "bing-rewards-auto-claim-v0.2.6.zip",
            browser_download_url: "https://github.com/yzbf-lin/bing-rewards-auto-claim/releases/download/v0.2.6/bing-rewards-auto-claim-v0.2.6.zip",
          }],
        };
      },
    }),
  });

  assert.deepEqual(status, {
    status: "available",
    currentVersion: "0.2.5",
    latestVersion: "0.2.6",
    releaseUrl: "https://github.com/yzbf-lin/bing-rewards-auto-claim/releases/tag/v0.2.6",
    downloadUrl: "https://github.com/yzbf-lin/bing-rewards-auto-claim/releases/download/v0.2.6/bing-rewards-auto-claim-v0.2.6.zip",
    fileName: "bing-rewards-auto-claim-v0.2.6.zip",
    checkedAt: "2026-08-06T08:00:00.000Z",
  });
});

test("rejects release download URLs outside the configured repository", async () => {
  const status = await fetchLatestRelease({
    currentVersion: "0.2.5",
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          tag_name: "v0.2.6",
          html_url: "https://github.com/yzbf-lin/bing-rewards-auto-claim/releases/tag/v0.2.6",
          assets: [{
            name: "bing-rewards-auto-claim-v0.2.6.zip",
            browser_download_url: "https://example.com/update.zip",
          }],
        };
      },
    }),
  });

  assert.equal(status.downloadUrl, null);
});

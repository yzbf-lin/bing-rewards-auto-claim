import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const source = await readFile(
  resolve(root, "userscript/bing-rewards-auto-claim.user.js"),
  "utf8",
);

new Function(source);

const metadata = source.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/)?.[1] ?? "";
const version = metadata.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
const requiredMetadata = [
  "@match        https://rewards.bing.com/*",
  "@match        https://bing.com/*",
  "@match        https://www.bing.com/*",
  "@match        https://*.bing.com/*",
  "@grant        GM_getValue",
  "@grant        GM_setValue",
  "@grant        GM_registerMenuCommand",
  "@updateURL",
  "@downloadURL",
];

if (version !== packageJson.version) {
  throw new Error(`Userscript version ${version} does not match package ${packageJson.version}`);
}
for (const item of requiredMetadata) {
  if (!metadata.includes(item)) throw new Error(`Userscript metadata is missing ${item}`);
}
if (/\bchrome\./.test(source)) throw new Error("Userscript must not depend on chrome.* APIs");

console.log(`Userscript validation passed (v${version}).`);

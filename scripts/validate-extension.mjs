import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  "src/popup/popup.js",
  "src/popup/popup.css",
];

if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
if (manifest.host_permissions?.includes("<all_urls>")) throw new Error("<all_urls> is not allowed");
if (manifest.permissions?.includes("debugger")) throw new Error("debugger permission is not allowed");

for (const file of requiredFiles) {
  if (!file) throw new Error("Manifest is missing a required file reference");
  await access(resolve(root, file));
}

console.log(`Extension validation passed (${requiredFiles.length} referenced files checked).`);

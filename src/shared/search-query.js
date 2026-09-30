// Self-contained so the extension and userscript use the same generator.
export function createRandomSearchQuery() {
  try {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new Error("SEARCH_QUERY_GENERATION_FAILED");
  }
}

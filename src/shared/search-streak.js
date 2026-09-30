// Keep this function self-contained so the userscript can use the same recognizer.
export function getSearchStreakProgress(entry) {
  if (!entry || entry.kind !== "link") return null;
  try {
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !(url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"))) return null;
  } catch {
    return null;
  }

  const title = String(entry.title ?? "").replace(/\s+/g, " ").trim();
  if (!/^(?:(?:必[应應]|bing)\s*(?:搜索|搜尋)\s*(?:连续|連續)\s*(?:打卡|签到|簽到)|bing\s+search\s+streak)$/i.test(title)) {
    return null;
  }

  const matches = [...String(entry.text ?? "").matchAll(/(?:搜索|搜尋|\bsearch(?:es)?)\s*[:：]?\s*(\d+)\s*\/\s*(\d+)(?![\d.])/gi)];
  if (matches.length !== 1) return null;
  const current = Number(matches[0][1]);
  const total = Number(matches[0][2]);
  return Number.isSafeInteger(current) && total === 1 ? { current, total } : null;
}

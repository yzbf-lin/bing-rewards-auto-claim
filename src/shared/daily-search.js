// Keep each helper self-contained: the userscript embeds these functions verbatim.
export function normalizeDailySearchProgress(saved, dateKey) {
  const result = { dateKey, completed: 0, queries: [] };
  if (!saved || saved.dateKey !== dateKey) return result;
  if (Number.isInteger(saved.completed) && saved.completed >= 0 && saved.completed <= 20) {
    result.completed = saved.completed;
  }
  const seen = new Set();
  for (const value of Array.isArray(saved.queries) ? saved.queries : []) {
    if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) continue;
    const query = value.replace(/\s+/gu, " ").trim().slice(0, 80).replace(/[\uD800-\uDBFF]$/u, "").trim();
    if (query.length < 2 || !/\p{L}/u.test(query) ||
        /(?:[a-z][a-z\d+.-]*:\/\/|\bwww\.)/iu.test(query) ||
        /^(?:(?:javascript|data|mailto|file|about):|\/\/|[^\s]+\.\p{L}{2,}(?:[/?#][^\s]*)?$)/iu.test(query)) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.queries.push(query);
  }
  return result;
}

export function createDailySearchDelay(random = Math.random) {
  const value = typeof random === "function" ? random() : 0.5;
  const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  return 8000 + Math.min(7000, Math.floor(fraction * 7001));
}

export function selectDailySearchQuery(candidates, usedQueries = [], random = Math.random) {
  const normalize = value => {
    if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
    const query = value.replace(/\s+/gu, " ").trim().slice(0, 80).replace(/[\uD800-\uDBFF]$/u, "").trim();
    if (query.length < 2 || !/\p{L}/u.test(query) ||
        /(?:[a-z][a-z\d+.-]*:\/\/|\bwww\.)/iu.test(query) ||
        /^(?:(?:javascript|data|mailto|file|about):|\/\/|[^\s]+\.\p{L}{2,}(?:[/?#][^\s]*)?$)/iu.test(query)) return null;
    return query;
  };
  const seen = new Set((Array.isArray(usedQueries) ? usedQueries : [])
    .map(normalize).filter(Boolean).map(query => query.toLowerCase()));
  const available = [];
  for (const value of Array.isArray(candidates) ? candidates : []) {
    const query = normalize(value);
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    available.push(query);
  }
  if (!available.length) return null;
  const value = typeof random === "function" ? random() : 0.5;
  const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  return available[Math.min(available.length - 1, Math.floor(fraction * available.length))];
}

export function collectDailySearchTerms() {
  const pageDocument = globalThis.document;
  if (typeof pageDocument?.querySelectorAll !== "function") return [];
  let pageUrl;
  try {
    pageUrl = new URL(globalThis.location?.href ?? pageDocument.location?.href ?? pageDocument.defaultView?.location?.href);
    if (pageUrl.protocol !== "https:" || pageUrl.username || pageUrl.password || pageUrl.port ||
        !(pageUrl.hostname === "bing.com" || pageUrl.hostname.endsWith(".bing.com"))) return [];
  } catch {
    return [];
  }
  const terms = [];
  const seen = new Set();
  const excludedContainers = [
    "[hidden]", '[aria-hidden="true"]', "[inert]", "[contenteditable]", "input", "textarea", "form",
    "header", "nav", '[role="navigation"]', '[role="banner"]', '[role="listbox"]',
    "#id_h", "#id_d", "#id_rh", "#id_rfly", "#id_rewards", "#rewards", "#rewardsFlyout",
    '[id*="rewards" i]', '[class*="rewards" i]', '[data-testid*="rewards" i]',
    "#sa_ul", "#sw_as", ".sa_as", ".sa_sg", '[id*="history" i]', '[class*="history" i]',
    '[id*="recent" i]', '[class*="recent" i]', '[id*="personal" i]', '[class*="personal" i]',
    '[aria-label*="history" i]', '[aria-label*="历史" i]', '[aria-label*="最近" i]',
    '[aria-label*="account" i]', '[aria-label*="账户" i]', '[aria-label*="帐户" i]',
  ].join(", ");
  const visible = element => {
    if (!element || element.hidden || element.closest?.(excludedContainers)) return false;
    if (typeof element.getClientRects === "function" && !element.getClientRects().length) return false;
    const view = pageDocument.defaultView ?? globalThis;
    const style = typeof view.getComputedStyle === "function" ? view.getComputedStyle(element) : null;
    return !style || (style.display !== "none" && style.visibility !== "hidden" &&
      style.visibility !== "collapse" && style.opacity !== "0");
  };
  const add = value => {
    if (typeof value !== "string") return;
    // DOM headings often contain line breaks; flatten layout whitespace before validation.
    const query = value.replace(/[\t\r\n]+/gu, " ").replace(/\s+/gu, " ").trim()
      .slice(0, 80).replace(/[\uD800-\uDBFF]$/u, "").trim();
    if (query.length < 2 || /[\u0000-\u001f\u007f-\u009f]/u.test(query) || !/\p{L}/u.test(query) ||
        /(?:[a-z][a-z\d+.-]*:\/\/|\bwww\.)/iu.test(query) ||
        /^(?:(?:javascript|data|mailto|file|about):|\/\/|[^\s]+\.\p{L}{2,}(?:[/?#][^\s]*)?$)/iu.test(query) ||
        /^(?:sign in|sign out|log in|settings|privacy|terms|rewards|microsoft rewards|bing|news|images|videos|登录|登入|退出|设置|設定|隐私|隱私|账户|帐户|帳戶|奖励|獎勵|搜索历史|搜尋歷程|首页|首頁|主页|主頁|新闻|新聞|图片|圖片|视频|視頻)$/iu.test(query)) return;
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(query);
  };
  const text = element => typeof element.innerText === "string" ? element.innerText : element.textContent;
  const searchQuery = element => {
    try {
      const href = element.getAttribute?.("href") ?? element.href;
      if (typeof href !== "string" || !href) return null;
      const target = new URL(href, pageUrl.href);
      if (target.protocol !== "https:" || target.username || target.password || target.port ||
          !(target.hostname === "bing.com" || target.hostname.endsWith(".bing.com")) ||
          !/^\/search\/?$/u.test(target.pathname) || target.searchParams.getAll("q").length !== 1) return null;
      return target.searchParams.get("q");
    } catch {
      return null;
    }
  };
  const queryAll = selector => {
    try { return pageDocument.querySelectorAll(selector); } catch { return []; }
  };
  for (const element of queryAll("#b_results h2 a, #b_results h2")) {
    if (visible(element)) add(text(element));
  }
  for (const element of queryAll("#b_rs a[href], #b_relatedSearches a[href], #relatedSearches a[href], .b_rs a[href], .b_relSearches a[href], .b_relatedSearches a[href]")) {
    if (visible(element)) add(searchQuery(element));
  }
  const homepage = pageUrl.pathname === "/";
  if (homepage) {
    // Public homepage hot/trending links vary between Bing locales. Their search
    // destination is a more stable contract than their presentation classes.
    for (const element of queryAll("a[href]")) {
      if (visible(element)) add(searchQuery(element));
    }
  }
  if (homepage || /^\/news(?:\/|$)/u.test(pageUrl.pathname)) {
    for (const element of queryAll("#headline a, #headline .title, #hpcAttribution a, #musCard .title, #vs_cont .title, #vs_cont .t, #vs_cont a[title], #news .news-title, #news .news-card .title, #news .newsitem .title, #newscontainer .news-title, .news-card a.title")) {
      if (!visible(element)) continue;
      add(element.getAttribute?.("title") || text(element));
    }
    if (homepage && !terms.length) {
      for (const element of queryAll("h1, h2")) {
        if (visible(element)) add(text(element));
      }
    }
  }
  return terms;
}

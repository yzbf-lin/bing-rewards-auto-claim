// ==UserScript==
// @name         Bing Rewards 简单积分领取
// @namespace    https://github.com/yzbf-lin/bing-rewards-auto-claim
// @version      0.4.5
// @description  自动完成 Bing Rewards 单步任务、每日单次搜索打卡、3×3 滑块拼图并领取仪表盘待领积分，适用于 Chrome；Edge 暂不支持。
// @author       yzbf-lin
// @license      MIT
// @match        https://rewards.bing.com/*
// @match        https://bing.com/*
// @match        https://www.bing.com/*
// @match        https://*.bing.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_getTabs
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/yzbf-lin/bing-rewards-auto-claim/main/userscript/bing-rewards-auto-claim.user.js
// @downloadURL  https://raw.githubusercontent.com/yzbf-lin/bing-rewards-auto-claim/main/userscript/bing-rewards-auto-claim.user.js
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "0.4.5";
  const STATE_KEY = "bingRewardsAutoClaimState";
  const MEMORY_KEY = "bingRewardsAutoClaimMemory";
  const AUTO_DATE_KEY = "bingRewardsAutoClaimLastAutomaticDate";
  const PANEL_ID = "bing-rewards-userscript-panel";
  const RUNNER_KEY = "__bingRewardsUserscriptRunner";
  const REWARDS_URL = "https://rewards.bing.com/earn";
  const DASHBOARD_URL = "https://rewards.bing.com/dashboard";
  const MAX_TASK_RECORDS = 200;
  const SETTLE_DELAY_MS = 1_800;
  const TAB_ID_KEY = "bingRewardsAutoClaimTabId";
  const DOCUMENT_ID = uniqueId();
  let ownerTabId = null;
  let tabIdentityPromise = null;
  let tabIdentityError = null;

  const COMPLEX_TASK_PATTERNS = [
    /每日搜索|daily\s+search|(?:完成|进行|需要|只需)\s*\d+\s*(?:次|个)?\s*(?:搜索|search(?:es)?)|\d+\s*(?:次|个)?\s*(?:搜索|search(?:es)?)/i,
    /答题|测验|trivia/i,
    /拼[图圖]|puzzle/i,
    /投票|poll/i,
    /购买|購買|订阅|訂閱|purchase|subscribe/i,
    /下载|下載|安装|安裝|download|install/i,
    /xbox|game\s*pass|游戏|gaming/i,
    /连续|連續|签到|簽到|streak|check[ -]?in/i,
    /邀请|邀請|invite|refer/i,
    /默认搜索引擎|預設搜尋引擎|default\s+search/i,
    /\/earn\/quest\/|punchcard|\d+\s*\/\s*\d+\s*个任务|multi[ -]?step\s+quest/i,
  ];
  const COMPLETED_PATTERN = /已完成|已领取|completed|claimed/i;
  const CLICK_ONLY_PATTERN = /(?:点击|打开|访问).{0,12}(?:即可)?(?:完成|获得|领取|查看)|click.{0,12}(?:complete|earn|view)/i;
  const PROGRESS_PATTERN = /\d+\s*\/\s*\d+/;
  const SUPPORTED_KINDS = new Set(["link", "button"]);
  const TRACKING_PARAMETERS = new Set(["form", "ocid", "publ", "crea", "filters"]);
  const REASON_LABELS = {
    SEARCH_STREAK: "单次搜索打卡",
    SEARCH_STREAK_ALREADY_ATTEMPTED: "本轮已尝试搜索打卡，不重复提交",
    SEARCH_STREAK_UNAVAILABLE: "搜索打卡当前不可用，未提交搜索",
    SEARCH_STREAK_COMPLETED: "今日搜索已确认 1/1",
    SEARCH_STREAK_LINK_UNAVAILABLE: "搜索打卡弹窗未出现可用的“立即搜索”入口",
    SEARCH_STREAK_LINK_NOT_UNIQUE: "搜索打卡弹窗入口不唯一，已停止",
    SEARCH_STREAK_LINK_UNSAFE: "搜索打卡弹窗链接不受支持",
    SEARCH_STREAK_NAVIGATION_NOT_CONFIRMED: "未进入搜索打卡目标页，请重新运行",
    SEARCH_QUERY_REQUIRED: "本轮搜索内容丢失，请重新运行",
    SEARCH_QUERY_INVALID: "本轮搜索内容无效，请重新运行",
    SEARCH_QUERY_GENERATION_FAILED: "无法生成随机搜索内容，请重新运行",
    SEARCH_FORM_UNAVAILABLE: "未找到可用的 Bing 搜索框",
    SEARCH_PAGE_UNSUPPORTED: "未进入受支持的 Bing 搜索页面",
    SEARCH_FORM_UNSAFE: "搜索表单地址不受支持，未提交",
    SEARCH_FORM_INVALID: "搜索表单校验未通过",
    SEARCH_SUBMIT_CANCELLED: "搜索提交被页面取消",
    SEARCH_SUBMIT_FAILED: "搜索提交失败",
    SEARCH_SUBMIT_NOT_CONFIRMED: "未确认搜索结果页加载，已停止本次搜索",
    SEARCH_STREAK_NOT_CONFIRMED: "搜索已尝试，尚未确认今日打卡 1/1",
    SEARCH_STREAK_DATE_CHANGED: "日期已变化，请重新运行以核对今日任务",
    ACTION_TRIGGERED: "已触发领取动作",
    IMAGE_PUZZLE: "可自动完成的滑块拼图",
    PUZZLE_COMPLETED: "拼图已完成并确认",
    PUZZLE_LAYOUT_UNSUPPORTED: "拼图尚未加载或布局不受支持",
    PUZZLE_PAGE_UNAVAILABLE: "未进入受支持的拼图页面",
    PUZZLE_UNSOLVABLE: "当前拼图无法求解",
    PUZZLE_SEARCH_LIMIT: "拼图求解已达到限制",
    PUZZLE_STATE_CHANGED: "拼图状态发生变化，请重试",
    PUZZLE_MOVE_FAILED: "拼图移动未生效，请重试",
    PUZZLE_NOT_CONFIRMED: "未确认拼图完成，请重试",
    POINTS_CLAIMED: "待领取积分已领取",
    CLAIM_NOT_CONFIRMED: "待领取余额未减少，请检查页面后重试",
    CLAIM_BALANCE_UNAVAILABLE: "未读取到待领取余额，请确认已登录并重试",
    FEATURE_MATCHED_ONE_STEP: "根据页面特征识别为单步任务",
    ALREADY_TRIGGERED_TODAY: "今天已经触发过",
    COMPLEX_TASK: "需要继续交互",
    INTERACTIVE_QUIZ: "需要完成测验答题",
    WAITING_24_HOURS: "已点击，等待 24 小时后计入",
    PROGRESS_NOT_ADVANCED: "已点击，但页面进度尚未增长",
    COMPLETED: "此前已经完成",
    DISABLED: "当前不可用",
    NO_REWARD_SIGNAL: "没有明确积分奖励",
    UNSUPPORTED_ENTRY_TYPE: "不支持的入口类型",
    SECTION_NOT_FOUND: "未找到任务区域",
  };

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function readValue(key, fallback) {
    try {
      return GM_getValue(key, fallback);
    } catch {
      return fallback;
    }
  }

  function writeValue(key, value) {
    GM_setValue(key, value);
  }

  function getState() {
    return readValue(STATE_KEY, null);
  }

  function uniqueId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function initializeTabIdentity() {
    if (!tabIdentityPromise) {
      tabIdentityPromise = new Promise((resolve, reject) => {
        if (typeof GM_getTab !== "function" || typeof GM_saveTab !== "function") {
          reject(new Error("TAB_IDENTITY_UNAVAILABLE"));
          return;
        }
        try {
          GM_getTab((tab) => {
            try {
              if (!tab || typeof tab !== "object") throw new Error("TAB_IDENTITY_UNAVAILABLE");
              if (!tab[TAB_ID_KEY]) {
                tab[TAB_ID_KEY] = uniqueId();
                GM_saveTab(tab);
              }
              ownerTabId = tab[TAB_ID_KEY];
              resolve(ownerTabId);
            } catch {
              reject(new Error("TAB_IDENTITY_UNAVAILABLE"));
            }
          });
        } catch {
          reject(new Error("TAB_IDENTITY_UNAVAILABLE"));
        }
      }).catch((error) => {
        tabIdentityError = "当前脚本管理器不支持标签页身份，无法安全运行；请使用最新版 Tampermonkey";
        throw error;
      });
    }
    return tabIdentityPromise;
  }

  function ownsRun(state) {
    return Boolean(ownerTabId && state?.ownerTabId === ownerTabId);
  }

  async function canRestartRun(state) {
    if (!state?.ownerTabId) return true;
    if (typeof GM_getTabs !== "function") {
      tabIdentityError = "无法确认原标签页是否关闭；请使用最新版 Tampermonkey";
      return false;
    }
    try {
      const tabs = await new Promise((resolve) => GM_getTabs(resolve));
      if (!tabs || typeof tabs !== "object") return false;
      return !Object.values(tabs).some((tab) => tab?.[TAB_ID_KEY] === state.ownerTabId);
    } catch {
      return false;
    }
  }

  function refreshOwnedState(state) {
    if (!ownsRun(state)) return false;
    const latest = getState();
    if (latest && latest.runId !== state.runId) return false;
    if (latest && (latest.revision ?? 0) > (state.revision ?? 0)) Object.assign(state, latest);
    return state.status === "running";
  }

  function setState(state) {
    if (!ownsRun(state)) return state;
    const latest = getState();
    if (latest?.runId === state.runId && (latest.revision ?? 0) > (state.revision ?? 0)) {
      Object.assign(state, latest);
      return state;
    }
    state.revision = (state.revision ?? 0) + 1;
    writeValue(STATE_KEY, state);
    renderPanel(state);
    return state;
  }

  function appendLog(state, event, details = {}) {
    const record = {
      at: new Date().toISOString(),
      event,
      details,
    };
    state.logs = [...(state.logs ?? []), record].slice(-200);
    console.info(`[Rewards Auto Claim] ${event}`, JSON.stringify(details));
    return record;
  }

  function beijingDateKey(date = new Date()) {
    return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function isAfterBeijingRunTime(date = new Date()) {
    return new Date(date.getTime() + 8 * 60 * 60 * 1000).getUTCHours() >= 9;
  }

  function inferCompleted(searchable) {
    const progressValues = [...searchable.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
      .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
      .filter(({ current, total }) => Number.isFinite(current) && Number.isFinite(total) && total > 0);
    const hasIncompleteProgress = progressValues.some(({ current, total }) => current < total);
    const allProgressComplete = progressValues.length > 0 &&
      progressValues.every(({ current, total }) => current >= total);
    return allProgressComplete || (COMPLETED_PATTERN.test(searchable) && !hasIncompleteProgress);
  }

  function findRewardPoints(text) {
    const claimableMatch = text.match(/可领取(?:\s+可领取)?\s+([\d,]+)\s+领取/i);
    if (claimableMatch) return Number(claimableMatch[1].replaceAll(",", ""));
    const plusMatch = text.match(/\+\s*([\d,]{1,9})(?:\s*(?:积分|点|點|points?))?/i);
    if (plusMatch) return Number(plusMatch[1].replaceAll(",", ""));
    const pointsMatch = text.match(/([\d,]{1,9})\s*(?:积分|点|點|points?)/i);
    return pointsMatch ? Number(pointsMatch[1].replaceAll(",", "")) : null;
  }

  function isTrustedDestination(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        (url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"));
    } catch {
      return false;
    }
  }

  function getSearchStreakProgress(entry) {
    if (!entry) return null;
    if (entry.kind === "button") {
      const section = String(entry.section ?? "").replace(/\s+/g, " ").trim();
      if (entry.url != null || !/^(?:连续打卡任务|連續打卡任務)$/.test(section)) return null;
    } else if (entry.kind === "link") {
      try {
        const url = new URL(entry.url);
        if (url.protocol !== "https:" || url.username || url.password || url.port ||
            !(url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"))) return null;
      } catch {
        return null;
      }
    } else {
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
    return Number.isSafeInteger(current) && total === 1 && current <= total ? { current, total } : null;
  }

  function createRandomSearchQuery() {
    try {
      const bytes = new Uint8Array(8);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      throw new Error("SEARCH_QUERY_GENERATION_FAILED");
    }
  }

  async function submitBingSearch(query) {
    if (query == null || (typeof query === "string" && !query.trim())) {
      throw new Error("SEARCH_QUERY_REQUIRED");
    }
    if (typeof query !== "string" || query.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(query.trim())) {
      throw new Error("SEARCH_QUERY_INVALID");
    }
    const queryText = query.trim();
    const pageUrl = () => {
      try {
        const url = new URL(location.href);
        if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
            (url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"))) return url;
      } catch {
        // Report the same stable code for an absent or malformed page URL.
      }
      throw new Error("SEARCH_PAGE_UNSUPPORTED");
    };
    pageUrl();
    const view = document.defaultView || globalThis;
    const Form = view.HTMLFormElement;
    const Input = view.HTMLInputElement;
    const Textarea = view.HTMLTextAreaElement;
    const EventType = view.Event;
    const usable = (field) => {
      if (!((Input && field instanceof Input) || (Textarea && field instanceof Textarea)) ||
          !Form || !(field.form instanceof Form) || field.name !== "q" ||
          field.disabled || field.readOnly || field.hidden || field.matches(":disabled") ||
          field.hasAttribute("disabled") || field.getAttribute("aria-disabled") === "true" ||
          field.closest('[hidden], [aria-hidden="true"]') || field.getClientRects().length === 0) return false;
      const style = view.getComputedStyle(field);
      return style.display !== "none" && !["hidden", "collapse"].includes(style.visibility) && style.opacity !== "0";
    };
    const validateForm = (form) => {
      const currentUrl = pageUrl();
      try {
        const action = new URL(form.action, currentUrl.href);
        if (action.origin === currentUrl.origin && !action.username && !action.password &&
            /^\/search\/?$/i.test(action.pathname) && String(form.method).toLowerCase() === "get") return;
      } catch {
        // A malformed action must not receive the query either.
      }
      throw new Error("SEARCH_FORM_UNSAFE");
    };

    let field = null;
    for (let attempt = 0; attempt <= 100; attempt += 1) {
      pageUrl();
      field = Array.from(document.querySelectorAll('#sb_form_q, input[name="q"], textarea[name="q"]')).find(usable);
      if (field) break;
      if (attempt < 100) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!field) throw new Error("SEARCH_FORM_UNAVAILABLE");
    const form = field.form;
    validateForm(form);
    const prototype = field instanceof Input ? Input.prototype : Textarea.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("SEARCH_FORM_UNAVAILABLE");

    try {
      setter.call(field, queryText);
      field.dispatchEvent(new EventType("input", { bubbles: true }));
      field.dispatchEvent(new EventType("change", { bubbles: true }));
      validateForm(form);
      if (!usable(field) || field.form !== form) throw new Error("SEARCH_FORM_UNAVAILABLE");
      if (!form.checkValidity()) throw new Error("SEARCH_FORM_INVALID");
      form.setAttribute("target", "_self");
      if (typeof Form.prototype.requestSubmit === "function") {
        Form.prototype.requestSubmit.call(form);
      } else {
        const event = new EventType("submit", { bubbles: true, cancelable: true });
        if (!form.dispatchEvent(event)) throw new Error("SEARCH_SUBMIT_CANCELLED");
        validateForm(form);
        Form.prototype.submit.call(form);
      }
    } catch (error) {
      if (/^SEARCH_(?:PAGE_UNSUPPORTED|FORM_UNSAFE|FORM_UNAVAILABLE|FORM_INVALID|SUBMIT_CANCELLED)$/.test(error?.message)) {
        throw error;
      }
      throw new Error("SEARCH_SUBMIT_FAILED");
    }
    // This reports a submission attempt; Rewards progress is verified by the caller.
    return { submitted: true };
  }

  function activateSearchStreakLink(activate = false) {
    const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();
    const view = document.defaultView || globalThis;
    const visible = element => {
      if (element.hidden || element.closest?.('[hidden], [aria-hidden="true"]') ||
          (element.getClientRects && element.getClientRects().length === 0)) return false;
      const style = view.getComputedStyle?.(element);
      return !style || (style.display !== "none" &&
        !["hidden", "collapse"].includes(style.visibility) && style.opacity !== "0");
    };
    const dialogs = Array.from(document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]'))
      .filter(dialog => {
        if (!visible(dialog)) return false;
        const labelledBy = normalize(dialog.getAttribute("aria-labelledby"));
        const title = labelledBy
          ? normalize(labelledBy.split(" ").map(id => document.getElementById(id)?.textContent).join(" "))
          : normalize(dialog.getAttribute("aria-label") || dialog.querySelector("h1, h2, h3")?.textContent);
        return /^(?:(?:必[应應]|bing)\s*(?:搜索|搜尋)\s*(?:连续|連續)\s*(?:打卡|签到|簽到)|bing\s+search\s+streak)$/i.test(title);
      });
    if (dialogs.length > 1) throw new Error("SEARCH_STREAK_LINK_NOT_UNIQUE");
    if (dialogs.length === 0) return null;
    const links = Array.from(dialogs[0].querySelectorAll("a[href]")).filter(link =>
      visible(link) && !link.disabled && !link.hasAttribute("disabled") &&
      link.getAttribute("aria-disabled") !== "true" &&
      /^(?:立即搜索|立即搜尋|search\s+now)$/i.test(normalize(link.innerText || link.textContent || link.getAttribute("aria-label"))),
    );
    if (links.length > 1) throw new Error("SEARCH_STREAK_LINK_NOT_UNIQUE");
    if (links.length === 0) return null;
    const link = links[0];
    let url;
    try {
      url = new URL(link.href || link.getAttribute("href"), location.href);
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
          !(url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"))) throw new Error();
    } catch {
      throw new Error("SEARCH_STREAK_LINK_UNSAFE");
    }
    if (activate) {
      link.setAttribute("target", "_self");
      link.click();
    }
    return { url: url.href, activated: Boolean(activate) };
  }

  function analyzeEntryFeatures(entry) {
    const title = normalize(entry.title);
    const text = normalize(entry.text);
    const url = normalize(entry.url);
    const visibleContent = `${title} ${text}`;
    const searchable = `${title} ${text} ${url}`;
    const puzzleTask = /拼[图圖]|puzzle/i.test(searchable);
    const declaredRewardPoints = Number(entry.rewardPoints);
    const rewardPoints = Number.isFinite(declaredRewardPoints) && declaredRewardPoints > 0
      ? declaredRewardPoints
      : findRewardPoints(`${title} ${text}`);
    const signals = entry.signals ?? {};
    const supported = SUPPORTED_KINDS.has(entry.kind);
    const navigationOnly = entry.kind === "link";
    const trustedDestination = navigationOnly && isTrustedDestination(url);
    const imagePuzzle = trustedDestination && /^\/spotlight\/imagepuzzle\/?$/i.test(new URL(url).pathname);
    const searchStreakProgress = getSearchStreakProgress(entry);
    const completed = (searchStreakProgress?.current >= 1) || (signals.completed ?? inferCompleted(searchable));
    const hasProgress = signals.hasProgress ?? PROGRESS_PATTERN.test(searchable);
    const clickOnlyCue = signals.clickOnlyCue ?? (
      CLICK_ONLY_PATTERN.test(searchable) || /[?&]rnoreward=1(?:&|$)/i.test(url)
    );
    const hasRewardSignal = signals.hasRewardBadge === true || rewardPoints !== null;
    const opensNewTab = signals.opensNewTab === true;
    const interactiveQuiz = /答题|测验|trivia|\bquiz\b/i.test(visibleContent) ||
      /[?&]form=dsetqu(?:&|$)|BingQA_QuizLanding/i.test(url);
    const complex = interactiveQuiz ||
      COMPLEX_TASK_PATTERNS.some((pattern) => pattern.test(searchable));
    const dailyActivityLink = hasRewardSignal && entry.section === "每日活动" && navigationOnly;
    const declaredOneStep =
      (entry.action === "quest-step" && navigationOnly) ||
      (hasRewardSignal && entry.section === "待领取积分" && entry.kind === "button") ||
      dailyActivityLink;

    let confidence = 0;
    if (supported) confidence += 10;
    if (!entry.disabled && !completed) confidence += 10;
    if (navigationOnly) confidence += 30;
    if (trustedDestination) confidence += 25;
    if (hasRewardSignal) confidence += 20;
    if (opensNewTab) confidence += 15;
    if (clickOnlyCue) confidence += 20;
    if (hasProgress) confidence -= 50;
    if (complex) confidence -= 50;
    if (declaredOneStep && !entry.disabled && !completed) confidence = Math.max(confidence, 90);

    return {
      rewardPoints,
      supported,
      completed,
      hasProgress,
      hasRewardSignal,
      imagePuzzle,
      searchStreakProgress,
      puzzleTask,
      interactiveQuiz,
      complex,
      dailyActivityLink,
      declaredOneStep,
      genericOneStep:
        confidence >= 70 &&
        !hasProgress &&
        !complex &&
        (hasRewardSignal || clickOnlyCue) &&
        (!navigationOnly || trustedDestination),
    };
  }

  function classifyEntry(entry) {
    const features = analyzeEntryFeatures(entry);
    const { rewardPoints } = features;
    if (entry.disabled) return { decision: "SKIPPED", reason: "DISABLED", rewardPoints };
    if (features.completed) return { decision: "SKIPPED", reason: "COMPLETED", rewardPoints };
    if (!features.supported) {
      return { decision: "SKIPPED", reason: "UNSUPPORTED_ENTRY_TYPE", rewardPoints };
    }
    if (features.imagePuzzle && features.hasRewardSignal) {
      return { decision: "ELIGIBLE", reason: "IMAGE_PUZZLE", rewardPoints };
    }
    if (features.searchStreakProgress?.current === 0) {
      return { decision: "ELIGIBLE", reason: "SEARCH_STREAK", rewardPoints };
    }
    if (features.interactiveQuiz && !features.dailyActivityLink) {
      return { decision: "SKIPPED", reason: "INTERACTIVE_QUIZ", rewardPoints };
    }
    if ((features.complex && (!features.dailyActivityLink || features.puzzleTask)) || features.hasProgress) {
      return { decision: "SKIPPED", reason: "COMPLEX_TASK", rewardPoints };
    }
    if (features.declaredOneStep) {
      return { decision: "ELIGIBLE", reason: "KNOWN_ONE_STEP_REWARD", rewardPoints };
    }
    if (features.genericOneStep) {
      return { decision: "ELIGIBLE", reason: "FEATURE_MATCHED_ONE_STEP", rewardPoints };
    }
    if (rewardPoints === null) {
      return { decision: "SKIPPED", reason: "NO_REWARD_SIGNAL", rewardPoints };
    }
    return { decision: "ELIGIBLE", reason: "ONE_STEP_REWARD", rewardPoints };
  }

  function groupName(group) {
    if (!group) return "";
    const directLabel = normalize(group.getAttribute("aria-label"));
    if (directLabel) return directLabel;
    const labelledBy = normalize(group.getAttribute("aria-labelledby"));
    if (!labelledBy) return "";
    return normalize(labelledBy.split(" ").map((id) => {
      const label = document.getElementById(id);
      return label?.getAttribute?.("aria-label") || label?.getAttribute?.("title") ||
        label?.innerText || label?.textContent;
    }).filter(Boolean).join(" "));
  }

  function completedFromPageState(value) {
    return inferCompleted(normalize(value));
  }

  function isTopLevelCard(element, group) {
    let parent = element.parentElement;
    while (parent && parent !== group) {
      if (parent.matches?.("a[href], button")) return false;
      parent = parent.parentElement;
    }
    return parent === group;
  }

  function collectRewardsEntries() {
    const sectionNames = ["连续打卡任务", "升级活动", "任务", "日常任务"];
    const headings = Array.from(document.querySelectorAll("h2"));
    const groups = Array.from(document.querySelectorAll('[role="group"]'));
    const entries = [];
    const missingSections = [];

    sectionNames.forEach((section, sectionIndex) => {
      const heading = headings.find((item) => normalize(item.textContent) === section);
      const group = groups.find((item) => groupName(item) === section);
      if (!heading || !group) {
        missingSections.push(section);
        return;
      }

      const cards = Array.from(group.querySelectorAll("a[href], button"))
        .filter((item) => isTopLevelCard(item, group));
      cards.forEach((element, cardIndex) => {
        const id = `reward-entry-${sectionIndex}-${cardIndex}`;
        const text = normalize(element.innerText || element.textContent);
        const imageTitle = normalize(element.querySelector("img[alt]")?.getAttribute("alt"));
        const paragraphTitle = normalize(element.querySelector("p")?.textContent);
        const ariaTitle = normalize(element.getAttribute("aria-label"));
        const paragraphTexts = Array.from(element.querySelectorAll("p"))
          .map((paragraph) => normalize(paragraph.textContent));
        const dailyTaskReward = section === "日常任务"
          ? paragraphTexts
            .slice()
            .reverse()
            .map((value) => value.match(/^\+?\s*([\d,]{1,9})(?:\s*(?:积分|点|點|points?))?$/i))
            .find(Boolean)
          : null;
        const rewardPoints = dailyTaskReward
          ? Number(dailyTaskReward[1].replaceAll(",", ""))
          : null;
        const restrictionText = /需要.+级别|等级不足|level required/i.test(text);
        const url = element.tagName === "A" ? element.href || element.getAttribute("href") : null;
        element.setAttribute("data-rewards-auto-id", id);
        entries.push({
          id,
          section,
          title: imageTitle || paragraphTitle || ariaTitle || text.slice(0, 80) || "未命名入口",
          text,
          kind: element.tagName === "A" ? "link" : "button",
          url,
          rewardPoints,
          disabled: Boolean(
            element.disabled || element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true" || restrictionText
          ),
          signals: {
            opensNewTab: element.getAttribute("target") === "_blank",
            hasProgress: PROGRESS_PATTERN.test(text),
            hasRewardBadge:
              rewardPoints !== null || paragraphTexts.some((value) => /^\+\s*[\d,]+/.test(value)),
            clickOnlyCue: CLICK_ONLY_PATTERN.test(text) || /[?&]rnoreward=1(?:&|$)/i.test(url ?? ""),
            completed: completedFromPageState(text),
          },
        });
      });
    });
    return { entries, missingSections };
  }

  function collectDashboardEntries() {
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const elements = [...new Set([
      ...document.querySelectorAll("a[href], button"),
      ...document.querySelectorAll('[role="button"]'),
    ])];
    const entries = [];
    let claimablePoints = null;
    const claimScopes = new Set();
    const claimPattern = /^(?:(?:可[领領]取(?:[积積]分|[点點][数數])?|claimable(?:\s+points?)?|points?\s+(?:available\s+)?to\s+claim|available\s+to\s+claim)\s*[:：]?\s*)+([\d,]+)/i;
    const claimContext = (element) => {
      const label = normalize(element.innerText || element.textContent || element.getAttribute("aria-label"));
      if (!/可[领領]取|[领領]取|claim/i.test(label)) return null;
      let scope = element;
      for (let depth = 0; scope && depth < 5; depth += 1, scope = scope.parentElement) {
        if (["BODY", "MAIN", "HTML"].includes(scope.tagName)) break;
        const text = normalize(scope.innerText || scope.textContent);
        // Never associate the claim action with the neighboring spendable balance.
        if (/可用[积積]分|available\s+points|redeem|兑换|兌換/i.test(text)) break;
        const match = text.match(claimPattern);
        if (match) return { scope, text, points: Number(match[1].replaceAll(",", "")) };
      }
      return null;
    };
    const completedFromPageState = (value) => {
      const progressValues = [...value.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
        .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
        .filter(({ current, total }) => Number.isFinite(current) && Number.isFinite(total) && total > 0);
      const hasIncompleteProgress = progressValues.some(({ current, total }) => current < total);
      const allProgressComplete = progressValues.length > 0 &&
        progressValues.every(({ current, total }) => current >= total);
      return allProgressComplete ||
        (/已完成|已领取|completed|claimed/i.test(value) && !hasIncompleteProgress);
    };

    const groupName = (group) => {
      if (!group) return "";
      const directLabel = normalize(group.getAttribute("aria-label"));
      if (directLabel) return directLabel;

      const labelledBy = normalize(group.getAttribute("aria-labelledby"));
      if (!labelledBy) return "";
      return normalize(
        labelledBy
          .split(" ")
          .map((id) => {
            const labelElement = document.getElementById(id);
            return (
              labelElement?.getAttribute?.("aria-label") ||
              labelElement?.getAttribute?.("title") ||
              labelElement?.innerText ||
              labelElement?.textContent
            );
          })
          .filter(Boolean)
          .join(" "),
      );
    };

    // Clear stale IDs even on cards that became hidden, disabled or zero-balance.
    elements.forEach((element) => {
      element.removeAttribute("data-rewards-auto-id");
      element.removeAttribute("data-rewards-auto-action");
    });
    elements.forEach((element) => {
      if (element.hidden || element.closest?.('[hidden], [aria-hidden="true"]') ||
          (element.getClientRects && element.getClientRects().length === 0)) return;
      const claim = claimContext(element);
      if (claim) {
        claimablePoints = Math.max(claimablePoints ?? 0, claim.points);
        if (claim.points <= 0 || claimScopes.has(claim.scope)) return;
        claimScopes.add(claim.scope);
      }
      const text = claim?.text || normalize(element.innerText || element.textContent);
      const group = element.closest?.('[role="group"]');
      const section = groupName(group) || "积分首页";
      const dailyRewardPoints = section === "每日活动"
        ? Array.from(element.querySelectorAll("p"))
          .map((paragraph) => normalize(paragraph.textContent))
          .reverse()
          .map((value) => value.match(/^\+?\s*([\d,]{1,9})(?:\s*(?:积分|points?))?$/i))
          .find(Boolean)
        : null;
      const detectedRewardPoints = claim
        ? claim.points
        : dailyRewardPoints
          ? Number(dailyRewardPoints[1].replaceAll(",", ""))
          : null;
      const explicitReward = /\+\s*[\d,]{1,9}(?:\s*(?:积分|points?))?/i.test(text);
      if (!explicitReward && detectedRewardPoints === null) return;

      const id = `dashboard-entry-${entries.length}`;
      const imageTitle = normalize(element.querySelector("img[alt]")?.getAttribute("alt"));
      const paragraphTitle = normalize(element.querySelector("p")?.textContent);
      const ariaTitle = normalize(element.getAttribute("aria-label"));
      const title = claim
        ? "领取待领取积分"
        : imageTitle || paragraphTitle || ariaTitle || text.slice(0, 80) || "未命名入口";
      const restrictionText = /需要.+级别|等级不足|level required/i.test(text);
      const disabled = Boolean(
        element.disabled ||
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          restrictionText,
      );

      element.setAttribute("data-rewards-auto-id", id);
      if (claim) {
        element.setAttribute("data-rewards-auto-action", "claim-points");
      } else {
        element.removeAttribute("data-rewards-auto-action");
      }
      entries.push({
        id,
        section: claim ? "待领取积分" : section,
        title,
        text,
        kind: !claim && element.tagName === "A" ? "link" : "button",
        url: !claim && element.tagName === "A" ? element.href || element.getAttribute("href") : null,
        disabled,
        action: claim ? "claim-points" : null,
        rewardPoints: detectedRewardPoints,
        signals: {
          opensNewTab: element.getAttribute("target") === "_blank",
          hasProgress: /\d+\s*\/\s*\d+/.test(text),
          hasRewardBadge: explicitReward || detectedRewardPoints !== null,
          clickOnlyCue:
            /(?:点击|打开|访问).{0,12}(?:即可)?(?:完成|获得|领取|查看)/i.test(text) ||
            /[?&]rnoreward=1(?:&|$)/i.test(element.href ?? ""),
          completed: completedFromPageState(text),
        },
      });
    });

    return { entries, missingSections: [], claimablePoints };
  }

  function collectQuestEntries(parentTitle) {
    const main = document.querySelector("main");
    if (!main) return { entries: [], missingSections: [`任务子步骤：${parentTitle}`] };
    const entries = [];
    const progressMatch = normalize(main.innerText || main.textContent)
      .match(/状态:\s*(\d+)\s*\/\s*(\d+)\s*个任务/i);
    const progress = progressMatch
      ? { current: Number(progressMatch[1]), total: Number(progressMatch[2]) }
      : null;
    Array.from(main.querySelectorAll("a[href]")).forEach((element) => {
      const url = element.href || element.getAttribute("href");
      let trustedTaskLink = false;
      try {
        const parsed = new URL(url, location.href);
        trustedTaskLink = parsed.protocol === "https:" &&
          (parsed.hostname === "bing.com" || parsed.hostname.endsWith(".bing.com")) &&
          !/^\/earn\/?$/i.test(parsed.pathname);
      } catch {
        trustedTaskLink = false;
      }
      if (!trustedTaskLink) return;
      const text = normalize(element.innerText || element.textContent);
      const ariaTitle = normalize(element.getAttribute("aria-label"));
      const contextText = normalize(
        element.parentElement?.innerText || element.parentElement?.textContent,
      );
      const id = `quest-entry-${entries.length}`;
      element.setAttribute("data-rewards-auto-id", id);
      entries.push({
        id,
        section: `任务：${parentTitle}`,
        parentTitle,
        title: text || ariaTitle || `任务子步骤 ${entries.length + 1}`,
        text: ariaTitle || text,
        kind: "link",
        url,
        disabled: Boolean(
          element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" ||
          element.getAttribute("data-disabled") === "true"
        ),
        action: "quest-step",
        signals: {
          opensNewTab: element.getAttribute("target") === "_blank",
          hasProgress: PROGRESS_PATTERN.test(ariaTitle || text),
          hasRewardBadge: false,
          clickOnlyCue: CLICK_ONLY_PATTERN.test(ariaTitle || text) ||
            /[?&]rnoreward=1(?:&|$)/i.test(url),
          completed: completedFromPageState(ariaTitle || text),
          waits24Hours: /等待\s*24\s*小时|wait\s*24\s*hours/i.test(contextText),
        },
      });
    });
    return { entries, missingSections: [], progress };
  }

  async function activateRewardsButton(entryId) {
    const element = document.querySelector(`[data-rewards-auto-id="${entryId}"]`);
    if (!element || element.disabled || element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true" || element.hidden ||
        element.closest?.('[hidden], [aria-hidden="true"]') ||
        (element.getClientRects && element.getClientRects().length === 0)) return false;
    const action = element.getAttribute("data-rewards-auto-action");
    if (element.tagName !== "BUTTON" && action !== "claim-points") return false;
    if (element.tagName === "A") element.setAttribute("target", "_self");
    element.querySelectorAll?.("a[target]").forEach((link) => link.removeAttribute("target"));
    element.click();

    if (action === "claim-points") {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const buttons = [...new Set([
          ...document.querySelectorAll("button"),
          ...document.querySelectorAll('[role="button"]'),
        ])];
        const confirmButton = buttons.find((button) => {
          const text = String(button.innerText || button.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          return /^(?:[领領]取(?:[积積]分|[点點][数數])?|claim(?:\s+(?:points|now))?)$/i.test(text) &&
            Boolean(button.closest?.('[role="dialog"], dialog, [aria-modal="true"]')) &&
            !button.disabled && !button.hidden && !button.hasAttribute("disabled") &&
            button.getAttribute("aria-disabled") !== "true" &&
            !button.closest?.('[hidden], [aria-hidden="true"]') &&
            (!button.getClientRects || button.getClientRects().length > 0);
        });
        if (confirmButton) {
          confirmButton.click();
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      // Some versions claim immediately. The caller must still verify the balance.
      return true;
    }

    return true;
  }

  function activateRewardsLink(entryId) {
    const element = document.querySelector(`[data-rewards-auto-id="${entryId}"]`);
    if (!element || element.tagName !== "A" || element.hidden ||
        element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled") ||
        element.closest?.('[hidden], [aria-hidden="true"]') ||
        (element.getClientRects && element.getClientRects().length === 0)) return null;
    const url = element.href || element.getAttribute("href");
    element.removeAttribute("target");
    element.setAttribute("target", "_self");
    element.click();
    return { activated: true, url };
  }

  async function solveImagePuzzle({ waitAttempts = 60, pollMs = 100, moveDelayMs = 120 } = {}) {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const success = () => {
      const popup = document.getElementById("congrats");
      return Boolean(popup && !popup.hidden && !popup.classList.contains("b_hide"));
    };
    const cells = () => Array.from(document.querySelectorAll("#tiles div.tile"));
    const readBoard = () => cells().map((cell) => {
      const image = cell.querySelector("img.tile");
      if (!image) return -1;
      const match = image.id?.match(/^img([0-7])$/);
      return match ? Number(match[1]) : NaN;
    });

    if (success()) return { solved: true, moves: 0 };
    for (let attempt = 0; cells().length === 0 && attempt < waitAttempts; attempt += 1) {
      await pause(pollMs);
    }
    const boardCells = cells();
    if (boardCells.length !== 9 || boardCells.some((cell, index) =>
      Number(cell.getAttribute("x")) !== Math.floor(index / 3) ||
      Number(cell.getAttribute("y")) !== index % 3
    )) throw new Error("PUZZLE_LAYOUT_UNSUPPORTED");

    // The revamped page uses the empty tile as a start button on the first click.
    const start = document.getElementById("final_parentTile");
    if (start) {
      start.parentElement.click();
      await pause(pollMs);
    }
    const initial = readBoard();
    if (initial.length !== 9 || new Set(initial).size !== 9 ||
        !initial.every((value) => Number.isInteger(value) && value >= -1 && value <= 7)) {
      throw new Error("PUZZLE_LAYOUT_UNSUPPORTED");
    }
    const numbered = initial.filter((value) => value !== -1);
    let inversions = 0;
    numbered.forEach((value, index) => {
      inversions += numbered.slice(index + 1).filter((other) => other < value).length;
    });
    if (inversions % 2) throw new Error("PUZZLE_UNSOLVABLE");

    // IDA* with Manhattan distance bounds memory and yields the shortest legal path.
    const searchBoard = [...initial];
    const path = [];
    const neighbors = Array.from({ length: 9 }, (_, index) =>
      Array.from({ length: 9 }, (_, candidate) => candidate).filter((candidate) =>
        Math.abs(Math.floor(index / 3) - Math.floor(candidate / 3)) +
        Math.abs(index % 3 - candidate % 3) === 1
      )
    );
    const distance = () => searchBoard.reduce((sum, value, index) => sum + (value === -1 ? 0 :
      Math.abs(Math.floor(index / 3) - Math.floor(value / 3)) + Math.abs(index % 3 - value % 3)), 0);
    let visited = 0;
    const search = (empty, depth, bound, previous) => {
      if (++visited > 500_000) throw new Error("PUZZLE_SEARCH_LIMIT");
      const estimate = distance();
      if (depth + estimate > bound) return depth + estimate;
      if (estimate === 0) return true;
      let nextBound = Infinity;
      for (const next of neighbors[empty]) {
        if (next === previous) continue;
        [searchBoard[empty], searchBoard[next]] = [searchBoard[next], searchBoard[empty]];
        path.push(next);
        const result = search(next, depth + 1, bound, empty);
        if (result === true) return true;
        nextBound = Math.min(nextBound, result);
        path.pop();
        [searchBoard[empty], searchBoard[next]] = [searchBoard[next], searchBoard[empty]];
      }
      return nextBound;
    };
    let bound = distance();
    while (bound <= 31) {
      const result = search(initial.indexOf(-1), 0, bound, -1);
      if (result === true) break;
      bound = result;
    }
    if (bound > 31) throw new Error("PUZZLE_UNSOLVABLE");
    // A random shuffle can already be ordered; a legal out-and-back fires the site's check.
    if (path.length === 0) path.push(neighbors[8][0], 8);

    const expected = [...initial];
    let empty = expected.indexOf(-1);
    for (const next of path) {
      if (readBoard().some((value, index) => value !== expected[index])) {
        throw new Error("PUZZLE_STATE_CHANGED");
      }
      cells()[next].click();
      [expected[empty], expected[next]] = [expected[next], expected[empty]];
      empty = next;
      await pause(moveDelayMs);
      if (!success() && readBoard().some((value, index) => value !== expected[index])) {
        throw new Error("PUZZLE_MOVE_FAILED");
      }
    }
    for (let attempt = 0; attempt < waitAttempts; attempt += 1) {
      if (success()) return { solved: true, moves: path.length };
      await pause(pollMs);
    }
    throw new Error("PUZZLE_NOT_CONFIRMED");
  }

  function normalizedUrl(value) {
    try {
      const url = new URL(value);
      for (const name of [...url.searchParams.keys()]) {
        if (TRACKING_PARAMETERS.has(name.toLowerCase())) url.searchParams.delete(name);
      }
      url.searchParams.sort();
      return url.toString();
    } catch {
      return normalize(value);
    }
  }

  function taskMemoryKey(entry) {
    return [
      normalize(entry.source || entry.section),
      normalize(entry.kind),
      normalize(entry.title),
      normalizedUrl(entry.url),
    ].join("|");
  }

  function rememberTask(memory, entry, decision, outcome, dateKey) {
    const key = taskMemoryKey(entry);
    const previous = memory[key] ?? {};
    const next = {
      ...memory,
      [key]: {
        key,
        section: entry.section,
        title: entry.title,
        kind: entry.kind,
        url: entry.url,
        rewardPoints: decision.rewardPoints,
        recognitionDecision: decision.decision,
        recognitionReason: decision.reason,
        recognitionSignals: entry.signals ?? previous.recognitionSignals ?? null,
        lastOutcome: outcome,
        lastSeenAt: new Date().toISOString(),
        lastSeenDate: dateKey,
        lastCompletedDate: outcome === "COMPLETED" ? dateKey : previous.lastCompletedDate ?? null,
        seenCount: (previous.seenCount ?? 0) + 1,
        completedCount: (previous.completedCount ?? 0) + (outcome === "COMPLETED" ? 1 : 0),
      },
    };
    const records = Object.values(next);
    if (records.length <= MAX_TASK_RECORDS) return next;
    records.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
    return Object.fromEntries(records.slice(0, MAX_TASK_RECORDS).map((record) => [record.key, record]));
  }

  function summarizeResults(results) {
    const summary = { total: results.length, completed: 0, skipped: 0, failed: 0 };
    results.forEach((result) => {
      if (result.outcome === "COMPLETED") summary.completed += 1;
      if (result.outcome === "SKIPPED") summary.skipped += 1;
      if (result.outcome === "FAILED") summary.failed += 1;
    });
    return summary;
  }

  function signature(catalog) {
    return JSON.stringify({
      missingSections: catalog.missingSections,
      claimablePoints: catalog.claimablePoints ?? null,
      entries: catalog.entries.map(({ section, title, text, kind, url, disabled, action }) => ({
        section, title, text, kind, url, disabled, action,
      })),
    });
  }

  async function collectStableCatalog(collector, args = [], requireSections = false, requireClaimBalance = false) {
    let previousSignature = null;
    let latest = { entries: [], missingSections: [] };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      latest = collector(...args);
      const currentSignature = signature(latest);
      if (currentSignature === previousSignature &&
          (!requireClaimBalance || typeof latest.claimablePoints === "number") &&
          (!requireSections || latest.missingSections.length === 0)) return latest;
      previousSignature = currentSignature;
      if (attempt < 29) await delay(500);
    }
    if (requireClaimBalance && typeof latest.claimablePoints !== "number") {
      throw new Error("CLAIM_BALANCE_UNAVAILABLE");
    }
    return latest;
  }

  function urlsMatchPage(currentValue, targetValue) {
    try {
      const current = new URL(currentValue);
      const expected = new URL(targetValue);
      const normalizedPath = (value) => value.replace(/\/+$/, "") || "/";
      if (current.origin !== expected.origin ||
          normalizedPath(current.pathname) !== normalizedPath(expected.pathname)) return false;
      return [...expected.searchParams.entries()].every(([name, value]) =>
        current.searchParams.getAll(name).includes(value)
      );
    } catch {
      return false;
    }
  }

  function isCurrentUrl(target) {
    return urlsMatchPage(location.href, target);
  }

  function navigateCurrentTab(url) {
    if (isCurrentUrl(url)) return false;
    location.assign(url);
    return true;
  }

  function setCurrentStep(state, title, section, status = "running") {
    state.currentStep = {
      title,
      section,
      status,
      index: state.index ?? 0,
      total: state.catalog?.length ?? 0,
    };
    setState(state);
  }

  function appendCatalog(state, catalog, source, sourceUrl) {
    state.catalog.push(...catalog.entries.map((entry) => ({
      ...entry,
      source,
      sourceUrl,
      ...(source === "quest" ? { questProgress: catalog.progress ?? null } : {}),
    })));
    catalog.missingSections.forEach((section) => {
      state.results.push({
        scope: "section",
        section,
        title: section,
        outcome: "FAILED",
        reason: "SECTION_NOT_FOUND",
        durationMs: 0,
      });
    });
    state.summary = summarizeResults(state.results);
    appendLog(state, "CATALOG_SOURCE_LOADED", {
      source,
      entries: catalog.entries.length,
      missingSections: catalog.missingSections,
    });
  }

  function storeTaskResult(state, entry, recognition, outcome, reason, startedAt = Date.now()) {
    state.results.push({
      ...entry,
      scope: "entry",
      outcome,
      reason,
      rewardPoints: recognition.rewardPoints,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    const dateKey = beijingDateKey(new Date(state.startedAt));
    const memory = rememberTask(
      readValue(MEMORY_KEY, {}), entry, recognition, outcome, dateKey,
    );
    writeValue(MEMORY_KEY, memory);
    state.summary = summarizeResults(state.results);
    appendLog(state, `ENTRY_${outcome}`, {
      title: entry.title,
      section: entry.section,
      reason,
    });
  }

  function findNewQuestEntries(existingEntries, refreshedEntries, sourceEntry, progress = null) {
    const knownKeys = new Set(existingEntries.map((entry) => taskMemoryKey(entry)));
    return refreshedEntries
      .map((entry) => ({
        ...entry,
        source: "quest",
        sourceUrl: sourceEntry.sourceUrl,
        questProgress: progress,
      }))
      .filter((entry) => {
        const key = taskMemoryKey(entry);
        if (knownKeys.has(key)) return false;
        knownKeys.add(key);
        return true;
      });
  }

  function questProgressAdvanced(previous, current) {
    const previousValue = Number(previous);
    const currentValue = Number(current);
    return !Number.isFinite(previousValue) ||
      !Number.isFinite(currentValue) ||
      currentValue > previousValue;
  }

  function forceWindowOpenIntoCurrentTab() {
    try {
      const pageWindow = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
      const originalOpen = pageWindow.open;
      pageWindow.open = (url) => {
        if (url) pageWindow.location.assign(String(url));
        return pageWindow;
      };
      return () => {
        pageWindow.open = originalOpen;
      };
    } catch {
      return () => {};
    }
  }

  async function finishPendingAction(state, outcome = "COMPLETED", reason = "ACTION_TRIGGERED") {
    if (!refreshOwnedState(state)) return;
    const pending = state.pending;
    if (!pending?.entry) throw new Error("PENDING_ACTION_MISSING");
    if (outcome === "COMPLETED" && pending.recognition.reason === "SEARCH_STREAK" && reason !== "SEARCH_STREAK_COMPLETED") {
      state.phase = pending.searchSubmitted ? "search-streak-wait" : "search-streak-submit";
      setCurrentStep(state, "正在提交今日打卡搜索", pending.entry.section);
      await submitPendingSearch(state);
      return;
    }
    if (outcome === "COMPLETED" && pending.recognition.reason === "IMAGE_PUZZLE" && reason !== "PUZZLE_COMPLETED") {
      state.phase = "solve-puzzle";
      setCurrentStep(state, "正在完成拼图", pending.entry.section);
      await completePendingPuzzle(state);
      return;
    }
    if (outcome === "COMPLETED" && pending.entry.action === "claim-points" && reason !== "POINTS_CLAIMED") {
      state.phase = "verify-claim";
      setCurrentStep(state, "正在确认积分到账", "待领取积分");
      await verifyPendingClaim(state);
      return;
    }
    if (outcome === "COMPLETED" && pending.entry.source === "quest" && pending.recognition.reason !== "SEARCH_STREAK") {
      state.phase = "rescan-quest";
      state.questRescan = {
        sourceUrl: pending.entry.sourceUrl,
        parentTitle: pending.entry.parentTitle,
        entry: pending.entry,
        recognition: pending.recognition,
        startedAt: pending.startedAt,
      };
      state.pending = null;
      appendLog(state, "QUEST_RESCAN_STARTED", {
        parentTitle: pending.entry.parentTitle,
        previousProgress: pending.entry.questProgress?.current ?? null,
      });
      setState(state);
      if (navigateCurrentTab(pending.entry.sourceUrl)) return;
      await resumePhase(state);
      return;
    }
    storeTaskResult(
      state,
      pending.entry,
      pending.recognition,
      outcome,
      reason,
      pending.startedAt,
    );
    state.index += 1;
    state.pending = null;
    state.phase = "execute";
    setState(state);
    await executeCatalog(state);
  }

  async function completePendingPuzzle(state) {
    try {
      if (!analyzeEntryFeatures({ kind: "link", url: location.href }).imagePuzzle) {
        throw new Error("PUZZLE_PAGE_UNAVAILABLE");
      }
      const result = await solveImagePuzzle();
      appendLog(state, "PUZZLE_COMPLETED", { moves: result.moves });
    } catch (error) {
      await finishPendingAction(state, "FAILED", error.message || "PUZZLE_NOT_CONFIRMED");
      return;
    }
    // Persist verified completion before Bing's own delayed redirect can unload us.
    state.phase = "puzzle-completed";
    setState(state);
    await delay(SETTLE_DELAY_MS);
    await finishPendingAction(state, "COMPLETED", "PUZZLE_COMPLETED");
  }

  function searchStreakDateChanged(state) {
    return beijingDateKey(new Date(state.startedAt)) !== beijingDateKey();
  }

  async function openPendingSearchDialog(state) {
    if (!refreshOwnedState(state) || state.phase !== "search-streak-dialog") return;
    if (searchStreakDateChanged(state)) {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_DATE_CHANGED");
      return;
    }
    if (!isCurrentUrl(state.pending.entry.sourceUrl || REWARDS_URL)) {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_NAVIGATION_NOT_CONFIRMED");
      return;
    }
    setCurrentStep(state, "正在等待搜索打卡弹窗", state.pending.entry.section);
    let link;
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!refreshOwnedState(state) || state.phase !== "search-streak-dialog") return;
        link = activateSearchStreakLink();
        if (link) break;
        if (attempt < 29) await delay(500);
      }
    } catch (error) {
      await finishPendingAction(state, "FAILED", error.message || "SEARCH_STREAK_LINK_UNAVAILABLE");
      return;
    }
    if (!link) {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_LINK_UNAVAILABLE");
      return;
    }
    // The original link may unload immediately: record the next phase first.
    state.pending.searchLandingUrl = link.url;
    state.pending.searchNavigationDocumentId = DOCUMENT_ID;
    state.phase = "search-streak-navigate";
    appendLog(state, "SEARCH_STREAK_LINK_CLICK", { destination: link.url });
    setState(state);
    const restoreWindowOpen = forceWindowOpenIntoCurrentTab();
    let activated;
    try {
      activated = activateSearchStreakLink(true);
    } catch (error) {
      restoreWindowOpen();
      await finishPendingAction(state, "FAILED", error.message || "SEARCH_STREAK_LINK_UNAVAILABLE");
      return;
    }
    if (!activated?.activated) {
      restoreWindowOpen();
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_LINK_UNAVAILABLE");
      return;
    }
    await delay(250);
    restoreWindowOpen();
    await navigatePendingSearch(state);
  }

  async function navigatePendingSearch(state) {
    if (!refreshOwnedState(state) || state.phase !== "search-streak-navigate") return;
    if (searchStreakDateChanged(state)) {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_DATE_CHANGED");
      return;
    }
    if (isCurrentUrl(state.pending.entry.sourceUrl || REWARDS_URL)) {
      if (state.pending.searchNavigationDocumentId === DOCUMENT_ID &&
          isTrustedDestination(state.pending.searchLandingUrl)) {
        location.assign(state.pending.searchLandingUrl);
        return;
      }
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_NAVIGATION_NOT_CONFIRMED");
      return;
    }
    if (!isTrustedDestination(location.href) || new URL(location.href).hostname === "rewards.bing.com") {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_NAVIGATION_NOT_CONFIRMED");
      return;
    }
    await delay(SETTLE_DELAY_MS);
    await finishPendingAction(state);
  }

  async function submitPendingSearch(state) {
    if (!refreshOwnedState(state) || !state.pending ||
        !["search-streak-submit", "search-streak-wait"].includes(state.phase)) return;
    if (searchStreakDateChanged(state)) {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_DATE_CHANGED");
      return;
    }
    if (!state.pending.searchSubmitted) {
      // Save before the native form can unload this document. A restored run only verifies.
      state.pending.searchSubmitted = true;
      state.pending.searchDocumentId = DOCUMENT_ID;
      state.phase = "search-streak-wait";
      setState(state);
      try {
        await submitBingSearch(state.pending.searchQuery);
      } catch (error) {
        await finishPendingAction(state, "FAILED", error.message || "SEARCH_SUBMIT_FAILED");
        return;
      }
    }
    await waitForPendingSearch(state);
  }

  async function waitForPendingSearch(state) {
    if (!refreshOwnedState(state) || state.phase !== "search-streak-wait") return;
    if (searchStreakDateChanged(state)) {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_DATE_CHANGED");
      return;
    }
    const target = state.pending.entry.sourceUrl || REWARDS_URL;
    // Back/refresh on Rewards must never lead to a second submission.
    if (!isCurrentUrl(target)) {
      let loaded = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const url = new URL(location.href);
        if (state.pending.searchDocumentId !== DOCUMENT_ID &&
            isTrustedDestination(url.href) && /^\/search\/?$/i.test(url.pathname) &&
            url.searchParams.get("q") === state.pending.searchQuery && document.readyState === "complete") {
          loaded = true;
          break;
        }
        await delay(500);
      }
      if (!loaded) {
        await finishPendingAction(state, "FAILED", "SEARCH_SUBMIT_NOT_CONFIRMED");
        return;
      }
      await delay(SETTLE_DELAY_MS);
    }
    state.phase = "search-streak-verify";
    setCurrentStep(state, "正在核对今日搜索进度", state.pending.entry.section);
    await verifyPendingSearch(state);
  }

  async function verifyPendingSearch(state) {
    if (!refreshOwnedState(state) || state.phase !== "search-streak-verify") return;
    if (searchStreakDateChanged(state)) {
      await finishPendingAction(state, "FAILED", "SEARCH_STREAK_DATE_CHANGED");
      return;
    }
    const { entry } = state.pending;
    if (navigateCurrentTab(entry.sourceUrl || REWARDS_URL)) return;
    const collector = entry.source === "dashboard" ? collectDashboardEntries
      : entry.source === "quest" ? () => collectQuestEntries(entry.parentTitle) : collectRewardsEntries;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const matches = collector().entries.filter((candidate) =>
        candidate.section === entry.section && candidate.title === entry.title);
      if (matches.length === 1 && getSearchStreakProgress(matches[0])?.current >= 1) {
        appendLog(state, "SEARCH_STREAK_COMPLETED", { current: 1, total: 1 });
        await finishPendingAction(state, "COMPLETED", "SEARCH_STREAK_COMPLETED");
        return;
      }
      if (attempt < 29) await delay(500);
    }
    await finishPendingAction(state, "FAILED", "SEARCH_STREAK_NOT_CONFIRMED");
  }

  async function verifyPendingClaim(state) {
    if (navigateCurrentTab(DASHBOARD_URL)) return;
    const before = state.pending.claimBefore;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { claimablePoints } = collectDashboardEntries();
      if (typeof claimablePoints === "number" && claimablePoints >= 0 && claimablePoints < before) {
        appendLog(state, "POINTS_CLAIMED", { claimedPoints: before - claimablePoints });
        await finishPendingAction(state, "COMPLETED", "POINTS_CLAIMED");
        return;
      }
      await delay(500);
    }
    await finishPendingAction(state, "FAILED", "CLAIM_NOT_CONFIRMED");
  }

  async function executeButton(state) {
    const { entry } = state.pending;
    if (navigateCurrentTab(entry.sourceUrl || REWARDS_URL)) return;
    setCurrentStep(state, entry.title || "未命名入口", entry.section || "积分任务");
    await delay(SETTLE_DELAY_MS);
    const collector = entry.source === "dashboard" ? collectDashboardEntries : collectRewardsEntries;
    const catalog = collector();
    let matches = catalog.entries.filter((candidate) =>
      candidate.section === entry.section && candidate.title === entry.title &&
      candidate.text === entry.text && candidate.kind === "button"
    );
    if (matches.length === 0) {
      matches = catalog.entries.filter((candidate) =>
        candidate.section === entry.section && candidate.title === entry.title &&
        candidate.kind === "button"
      );
    }
    if (matches.length !== 1) {
      await finishPendingAction(state, "FAILED", "BUTTON_NOT_UNIQUE");
      return;
    }

    const searchStreak = state.pending.recognition.reason === "SEARCH_STREAK";
    if (searchStreak) {
      const progress = getSearchStreakProgress(matches[0]);
      if (matches[0].disabled) {
        await finishPendingAction(state, "FAILED", "SEARCH_STREAK_UNAVAILABLE");
        return;
      }
      if (progress?.current >= 1) {
        await finishPendingAction(state, "COMPLETED", "SEARCH_STREAK_COMPLETED");
        return;
      }
      if (!progress || matches[0].signals?.completed === true) {
        await finishPendingAction(state, "FAILED", "SEARCH_STREAK_NOT_CONFIRMED");
        return;
      }
    }
    if (entry.action === "claim-points") state.pending.claimBefore = matches[0].rewardPoints;

    state.phase = searchStreak ? "search-streak-dialog" : "execute-button-wait";
    appendLog(state, "CARD_CLICK", {
      kind: "button",
      title: entry.title,
      sourceUrl: entry.sourceUrl || REWARDS_URL,
    });
    setState(state);
    const restoreWindowOpen = forceWindowOpenIntoCurrentTab();
    const activated = await activateRewardsButton(matches[0].id);
    await delay(SETTLE_DELAY_MS);
    restoreWindowOpen();
    if (!activated) {
      await finishPendingAction(state, "FAILED", "BUTTON_ACTIVATION_FAILED");
      return;
    }
    if (searchStreak) {
      await openPendingSearchDialog(state);
      return;
    }
    await finishPendingAction(state);
  }

  async function executeLink(state) {
    const { entry } = state.pending;
    if (navigateCurrentTab(entry.sourceUrl || REWARDS_URL)) return;
    setCurrentStep(state, entry.title || "未命名入口", entry.section || "积分任务");
    await delay(SETTLE_DELAY_MS);
    const collector = entry.source === "dashboard"
      ? collectDashboardEntries
      : entry.source === "quest"
        ? () => collectQuestEntries(entry.parentTitle)
        : collectRewardsEntries;
    const catalog = collector();
    let matches = catalog.entries.filter((candidate) =>
      candidate.section === entry.section && candidate.title === entry.title &&
      candidate.text === entry.text && candidate.kind === "link"
    );
    if (matches.length === 0) {
      matches = catalog.entries.filter((candidate) =>
        candidate.section === entry.section && candidate.title === entry.title &&
        candidate.kind === "link"
      );
    }
    if (matches.length !== 1) {
      await finishPendingAction(state, "FAILED", "LINK_NOT_UNIQUE");
      return;
    }

    if (state.pending.recognition.reason === "SEARCH_STREAK") {
      const progress = getSearchStreakProgress(matches[0]);
      if (matches[0].disabled) {
        await finishPendingAction(state, "FAILED", "SEARCH_STREAK_UNAVAILABLE");
        return;
      }
      if (progress?.current >= 1) {
        await finishPendingAction(state, "COMPLETED", "SEARCH_STREAK_COMPLETED");
        return;
      }
      if (!progress || matches[0].signals?.completed === true) {
        await finishPendingAction(state, "FAILED", "SEARCH_STREAK_NOT_CONFIRMED");
        return;
      }
    }

    state.phase = "execute-link-wait";
    appendLog(state, "CARD_CLICK", {
      kind: "link",
      title: entry.title,
      sourceUrl: entry.sourceUrl || REWARDS_URL,
      destination: matches[0].url,
    });
    setState(state);
    const restoreWindowOpen = forceWindowOpenIntoCurrentTab();
    const sourceUrl = location.href;
    const activation = activateRewardsLink(matches[0].id);
    if (!activation?.activated) {
      restoreWindowOpen();
      await finishPendingAction(state, "FAILED", "LINK_ACTIVATION_FAILED");
      return;
    }
    await delay(250);
    const destination = activation.url || entry.url;
    if (location.href === sourceUrl && destination !== sourceUrl) {
      restoreWindowOpen();
      location.assign(destination);
      return;
    }
    await delay(SETTLE_DELAY_MS);
    restoreWindowOpen();
    await finishPendingAction(state);
  }

  async function executeCatalog(state) {
    if (!refreshOwnedState(state)) return;
    while (state.index < state.catalog.length) {
      const entry = state.catalog[state.index];
      setCurrentStep(state, entry.title || "未命名入口", entry.section || "积分任务");
      const recognition = classifyEntry(entry);
      const previous = readValue(MEMORY_KEY, {})[taskMemoryKey(entry)];
      const dateKey = beijingDateKey(new Date(state.startedAt));
      let decision = state.trigger !== "manual" && recognition.decision === "ELIGIBLE" &&
        entry.action !== "claim-points" &&
        previous?.lastCompletedDate === dateKey
        ? { ...recognition, decision: "SKIPPED", reason: "ALREADY_TRIGGERED_TODAY" }
        : recognition;
      const searchStreak = recognition.reason === "SEARCH_STREAK";
      if (decision.decision === "ELIGIBLE" && searchStreak && state.searchStreakAttempted) {
        decision = { ...recognition, decision: "SKIPPED", reason: "SEARCH_STREAK_ALREADY_ATTEMPTED" };
      }

      if (decision.decision === "SKIPPED") {
        storeTaskResult(state, entry, recognition, "SKIPPED", decision.reason, Date.now());
        state.index += 1;
        setState(state);
        await delay(30);
        continue;
      }

      state.pending = { entry, recognition, startedAt: Date.now() };
      if (searchStreak) {
        state.searchStreakAttempted = true;
        try {
          state.pending.searchQuery = createRandomSearchQuery();
        } catch {
          await finishPendingAction(state, "FAILED", "SEARCH_QUERY_GENERATION_FAILED");
          return;
        }
      }
      appendLog(state, "ENTRY_ACTIVATING", {
        title: entry.title,
        section: entry.section,
        kind: entry.kind,
      });
      if (entry.kind === "link") {
        state.phase = "execute-link";
        setState(state);
        await executeLink(state);
        return;
      }

      state.phase = searchStreak ? "search-streak-open" : "execute-button";
      setState(state);
      await executeButton(state);
      return;
    }

    if (!state.claimsRefreshed) {
      state.phase = "rescan-dashboard";
      setCurrentStep(state, "正在检查本轮可领取积分", "待领取积分");
      await resumePhase(state);
      return;
    }
    state.phase = "returning";
    setCurrentStep(state, "正在返回积分页面", "运行状态");
    if (navigateCurrentTab(REWARDS_URL)) return;
    finishRun(state);
  }

  function finishRun(state) {
    state.status = "completed";
    state.phase = "finished";
    state.finishedAt = new Date().toISOString();
    state.currentStep = {
      title: "本轮任务检查完成",
      section: "运行状态",
      status: "completed",
    };
    state.summary = summarizeResults(state.results);
    if (state.trigger !== "manual") {
      writeValue(AUTO_DATE_KEY, beijingDateKey());
    }
    appendLog(state, "RUN_FINISHED", state.summary);
    setState(state);
  }

  function abortRun(state, error) {
    const reason = error instanceof Error ? error.message : String(error);
    state.status = "aborted";
    state.phase = "finished";
    state.finishedAt = new Date().toISOString();
    state.results.push({
      scope: "page",
      section: "运行状态",
      title: "积分页面",
      outcome: "FAILED",
      reason,
      durationMs: Date.now() - new Date(state.startedAt).getTime(),
    });
    state.summary = summarizeResults(state.results);
    state.currentStep = {
      title: `执行过程已中断：${reason}`,
      section: "运行状态",
      status: "failed",
    };
    appendLog(state, "RUN_ABORTED", { reason });
    setState(state);
    console.warn(`[Rewards Auto Claim] ABORTED: ${reason}`);
  }

  async function resumeRun() {
    await initializeTabIdentity();
    const state = getState();
    if (!ownsRun(state) || state.status !== "running" || globalThis[RUNNER_KEY]) return;
    globalThis[RUNNER_KEY] = true;
    try {
      mountPanel();
      renderPanel(state);
      if (state.phase === "scan-earn") {
        if (navigateCurrentTab(REWARDS_URL)) return;
        setCurrentStep(state, "正在识别积分赚取页", "任务识别");
        const catalog = await collectStableCatalog(collectRewardsEntries, [], true);
        appendCatalog(state, catalog, "earn", REWARDS_URL);
        state.quests = catalog.entries
          .filter((entry) => entry.kind === "link" && /\/earn\/quest\//i.test(entry.url ?? ""))
          .map((entry) => ({ title: entry.title, url: entry.url }));
        state.questIndex = 0;
        state.phase = state.quests.length > 0 ? "scan-quest" : "scan-dashboard";
        setState(state);
        await resumePhase(state);
        return;
      }

      await resumePhase(state);
    } catch (error) {
      abortRun(getState() ?? state, error);
    } finally {
      globalThis[RUNNER_KEY] = false;
    }
  }

  async function resumePhase(state) {
    await initializeTabIdentity();
    if (!refreshOwnedState(state)) return;
    if (state.phase === "search-streak-open") {
      await executeButton(state);
      return;
    }
    if (state.phase === "search-streak-dialog") {
      await openPendingSearchDialog(state);
      return;
    }
    if (state.phase === "search-streak-navigate") {
      await navigatePendingSearch(state);
      return;
    }
    if (state.phase === "search-streak-submit") {
      await submitPendingSearch(state);
      return;
    }
    if (state.phase === "search-streak-wait") {
      await waitForPendingSearch(state);
      return;
    }
    if (state.phase === "search-streak-verify") {
      await verifyPendingSearch(state);
      return;
    }
    if (state.phase === "puzzle-completed") {
      await finishPendingAction(state, "COMPLETED", "PUZZLE_COMPLETED");
      return;
    }
    if (state.phase === "solve-puzzle") {
      await completePendingPuzzle(state);
      return;
    }
    if (state.phase === "verify-claim") {
      await verifyPendingClaim(state);
      return;
    }
    if (state.phase === "rescan-dashboard") {
      if (navigateCurrentTab(DASHBOARD_URL)) return;
      await delay(SETTLE_DELAY_MS);
      const catalog = await collectStableCatalog(collectDashboardEntries, [], false, true);
      appendCatalog(state, { ...catalog, entries: catalog.entries.filter((entry) => entry.action === "claim-points") }, "dashboard", DASHBOARD_URL);
      state.claimsRefreshed = true;
      state.phase = "execute";
      setState(state);
      await executeCatalog(state);
      return;
    }
    if (state.phase === "rescan-quest") {
      const rescan = state.questRescan;
      if (!rescan?.sourceUrl || !rescan.parentTitle) throw new Error("QUEST_RESCAN_STATE_MISSING");
      if (navigateCurrentTab(rescan.sourceUrl)) return;
      setCurrentStep(state, rescan.parentTitle, "重新识别已解锁任务");
      const refreshed = await collectStableCatalog(collectQuestEntries, [rescan.parentTitle]);
      const previousProgress = Number(rescan.entry?.questProgress?.current);
      const refreshedProgress = Number(refreshed.progress?.current);
      const progressDidNotAdvance = !questProgressAdvanced(previousProgress, refreshedProgress);
      const outcome = progressDidNotAdvance ? "SKIPPED" : "COMPLETED";
      const reason = progressDidNotAdvance
        ? rescan.entry?.signals?.waits24Hours
          ? "WAITING_24_HOURS"
          : "PROGRESS_NOT_ADVANCED"
        : "ACTION_TRIGGERED";
      storeTaskResult(
        state,
        rescan.entry,
        rescan.recognition,
        outcome,
        reason,
        rescan.startedAt,
      );
      state.index += 1;
      const discovered = findNewQuestEntries(
        state.catalog,
        refreshed.entries,
        rescan,
        refreshed.progress ?? null,
      );
      if (discovered.length > 0) state.catalog.splice(state.index, 0, ...discovered);
      appendLog(state, "QUEST_RESCANNED", {
        parentTitle: rescan.parentTitle,
        previousProgress: Number.isFinite(previousProgress) ? previousProgress : null,
        refreshedProgress: Number.isFinite(refreshedProgress) ? refreshedProgress : null,
        discovered: discovered.length,
        total: state.catalog.length,
      });
      state.questRescan = null;
      state.phase = "execute";
      setState(state);
      await executeCatalog(state);
      return;
    }

    if (state.phase === "scan-quest") {
      const quest = state.quests[state.questIndex];
      if (!quest) {
        state.phase = "scan-dashboard";
        setState(state);
        await resumePhase(state);
        return;
      }
      if (navigateCurrentTab(quest.url)) return;
      setCurrentStep(state, quest.title, "识别任务子步骤");
      const catalog = await collectStableCatalog(collectQuestEntries, [quest.title]);
      appendCatalog(state, catalog, "quest", quest.url);
      state.questIndex += 1;
      setState(state);
      if (state.questIndex < state.quests.length) {
        navigateCurrentTab(state.quests[state.questIndex].url);
        return;
      }
      state.phase = "scan-dashboard";
      setState(state);
      await resumePhase(state);
      return;
    }

    if (state.phase === "scan-dashboard") {
      if (navigateCurrentTab(DASHBOARD_URL)) return;
      setCurrentStep(state, "正在识别积分首页", "任务识别");
      const catalog = await collectStableCatalog(collectDashboardEntries);
      appendCatalog(state, { ...catalog, entries: catalog.entries.filter((entry) => entry.action !== "claim-points") }, "dashboard", DASHBOARD_URL);
      state.phase = "execute";
      state.index = 0;
      setState(state);
      await executeCatalog(state);
      return;
    }

    if (state.phase === "execute") {
      await executeCatalog(state);
      return;
    }

    if (state.phase === "execute-link-wait" || state.phase === "execute-button-wait") {
      setCurrentStep(
        state,
        state.pending?.entry?.title || "正在确认任务结果",
        state.pending?.entry?.section || "积分任务",
      );
      await delay(SETTLE_DELAY_MS);
      await finishPendingAction(state);
      return;
    }

    if (state.phase === "execute-link") {
      await executeLink(state);
      return;
    }

    if (state.phase === "execute-button") {
      await executeButton(state);
      return;
    }

    if (state.phase === "returning") {
      if (navigateCurrentTab(REWARDS_URL)) return;
      finishRun(state);
    }
  }

  function createRun(trigger) {
    if (!ownerTabId) throw new Error("TAB_IDENTITY_UNAVAILABLE");
    const startedAt = new Date();
    return {
      version: VERSION,
      runId: `userscript-${uniqueId()}`,
      ownerTabId,
      revision: 0,
      trigger,
      status: "running",
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      phase: "scan-earn",
      catalog: [],
      quests: [],
      questIndex: 0,
      index: 0,
      pending: null,
      questRescan: null,
      currentStep: {
        title: "正在识别积分入口",
        section: "任务识别",
        status: "running",
        index: 0,
        total: 0,
      },
      results: [],
      logs: [{
        at: startedAt.toISOString(),
        event: "RUN_STARTED",
        details: { trigger },
      }],
      summary: { total: 0, completed: 0, skipped: 0, failed: 0 },
    };
  }

  async function startRun(trigger = "manual") {
    try {
      await initializeTabIdentity();
    } catch {
      mountPanel();
      renderPanel();
      return;
    }
    const current = getState();
    if (current?.status === "running") {
      mountPanel();
      renderPanel(current);
      if (ownsRun(current)) {
        void resumeRun();
        return;
      }
      if (trigger !== "manual" || !await canRestartRun(current)) {
        renderPanel(current);
        return;
      }
      // A different document may have advanced the run while tab data loaded.
      const latest = getState();
      if (latest?.runId !== current.runId || latest?.revision !== current.revision) return;
    }
    const state = createRun(trigger);
    mountPanel();
    setState(state);
    void resumeRun();
  }

  function createRewardsFloatingWidget({ hostId, loadPosition = () => null, savePosition = () => {} }) {
    const SIZE = 56;
    const MARGIN = 12;
    const host = document.createElement("div");
    host.id = hostId;
    Object.assign(host.style, {
      all: "initial", position: "fixed", zIndex: "2147483647", display: "block",
      font: '13px/1.45 "Segoe UI", "PingFang SC", sans-serif', colorScheme: "light",
    });
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { color-scheme: light; font: 13px/1.45 "Segoe UI", "PingFang SC", sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      button { font: inherit; -webkit-tap-highlight-color: transparent; }
      .rw-launcher {
        position: absolute; top: 0; left: 0; width: 56px; height: 56px; display: flex;
        align-items: center; padding: 0; border: 1px solid rgba(255,255,255,.78);
        border-radius: 999px; color: #333367; cursor: grab; touch-action: none; user-select: none;
        background: linear-gradient(135deg,rgba(255,255,255,.8),rgba(232,239,255,.32));
        backdrop-filter: blur(18px) saturate(180%); -webkit-backdrop-filter: blur(18px) saturate(180%);
        box-shadow: inset 0 1px 2px #fff, inset 0 -6px 14px rgba(116,98,230,.12),
          0 7px 24px rgba(87,75,164,.2), 0 0 24px rgba(139,124,255,.16);
        overflow: hidden; isolation: isolate;
        transition: width .42s cubic-bezier(.22,1,.36,1), box-shadow .3s, opacity .16s, transform .25s;
      }
      :host([data-side="right"]) .rw-launcher { left: auto; right: 0; }
      .rw-launcher::before {
        content: ""; position: absolute; z-index: -2; inset: -40%; opacity: .72; filter: blur(9px);
        background: conic-gradient(from 0deg,transparent 0deg,#ab9cff 70deg,#cdfcff 130deg,
          transparent 180deg,#f2bcff 245deg,#88e2ff 300deg,transparent 360deg);
        animation: rw-flow 7s linear infinite;
      }
      .rw-launcher::after {
        content: ""; position: absolute; z-index: -1; inset: 1px; border-radius: inherit;
        background: radial-gradient(ellipse at 28% 15%,rgba(255,255,255,.97),rgba(255,255,255,.05) 53%),
          linear-gradient(150deg,rgba(255,255,255,.22),rgba(204,226,255,.18) 65%,rgba(255,255,255,.58));
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.35);
      }
      .rw-spark { flex: 0 0 24px; width: 24px; height: 24px; margin: 0 12px 0 15px;
        filter: drop-shadow(0 0 6px rgba(130,97,255,.38)); animation: rw-shimmer 4s ease-in-out infinite; }
      .rw-label { opacity: 0; white-space: nowrap; text-align: left; transform: translateX(-5px);
        transition: opacity .2s, transform .35s; pointer-events: none; }
      .rw-label strong { display: block; font-size: 12px; font-weight: 650; letter-spacing: .04em; }
      .rw-label small { display: block; margin-top: 1px; font-size: 10px; color: #6c6c96; }
      @media (hover: hover) {
        :host(:not([data-dragging="true"])) .rw-launcher:hover { width: var(--rw-hover-width,156px);
          box-shadow: inset 0 1px 2px #fff,0 10px 30px rgba(92,76,185,.23),0 0 30px rgba(131,196,255,.22); }
        :host(:not([data-dragging="true"])) .rw-launcher:hover .rw-label { opacity: 1; transform: none; }
      }
      .rw-launcher:focus-visible { width: var(--rw-hover-width,156px); outline: 2px solid #8976ed; outline-offset: 4px; }
      .rw-launcher:focus-visible .rw-label { opacity: 1; transform: none; }
      :host([data-running="true"]) .rw-launcher::before { animation-duration: 3s; opacity: .95; }
      :host([data-dragging="true"]) .rw-launcher, :host([data-dragging="true"]) .rw-grip { cursor: grabbing; }
      :host([data-dragging="true"]) .rw-launcher { transition: none; }
      .rw-panel {
        position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
        border: 1px solid rgba(255,255,255,.88); border-radius: 22px;
        background: rgba(248,250,255,.86); backdrop-filter: blur(24px) saturate(140%);
        -webkit-backdrop-filter: blur(24px) saturate(140%);
        box-shadow: 0 22px 70px rgba(31,34,76,.19),0 2px 9px rgba(62,56,108,.1),inset 0 1px 0 #fff;
        opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-5px) scale(.94);
        transform-origin: top left; transition: opacity .2s, transform .3s cubic-bezier(.22,1,.36,1),visibility .2s;
      }
      :host([data-side="right"]) .rw-panel { transform-origin: top right; }
      :host([data-open="true"]) .rw-panel { opacity: 1; visibility: visible; pointer-events: auto; transform: none; }
      :host([data-open="true"]) .rw-launcher { opacity: 0; visibility: hidden; pointer-events: none; transform: scale(.8); }
      .rw-bar { display: flex; align-items: center; flex: 0 0 48px; gap: 8px; padding: 0 10px 0 16px;
        border-bottom: 1px solid rgba(126,122,169,.12); background: linear-gradient(100deg,rgba(237,231,255,.6),rgba(224,247,255,.5)); }
      .rw-grip { display: flex; align-items: center; align-self: stretch; flex: 1; min-width: 0; gap: 9px;
        color: #57527e; cursor: grab; touch-action: none; user-select: none; }
      .rw-grip svg { flex: 0 0 14px; opacity: .55; }
      .rw-grip strong { font-size: 11px; font-weight: 650; letter-spacing: .12em; }
      .rw-grip span { margin-left: auto; color: #89869f; font-size: 10px; }
      .rw-close { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px;
        border: 1px solid rgba(133,123,171,.12); border-radius: 50%; background: rgba(255,255,255,.6);
        color: #78718e; cursor: pointer; transition: background .2s,color .2s; }
      .rw-close:hover { background: #fff; color: #514680; }
      .rw-close:focus-visible { outline: 2px solid #8976ed; outline-offset: 2px; }
      .rw-content { flex: 1; min-height: 0; overflow: auto; }
      .rw-content > iframe { display: block; width: 100%; height: 100%; border: 0; background: #f5f7fa; }
      @keyframes rw-flow { to { transform: rotate(360deg); } }
      @keyframes rw-shimmer { 50% { opacity: .78; filter: drop-shadow(0 0 9px rgba(130,97,255,.6)); } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition: none !important; }
      }
    </style>
    <button class="rw-launcher" type="button" aria-label="展开积分面板，可拖动调整位置" aria-expanded="false" aria-controls="rw-panel" title="拖动移动位置 · 点击展开">
      <svg class="rw-spark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M11 2.5c.9 5.6 2.9 7.6 8.5 8.5-5.6.9-7.6 2.9-8.5 8.5C10.1 13.9 8.1 11.9 2.5 11 8.1 10.1 10.1 8.1 11 2.5Z" fill="#8474ce"/>
        <path d="M19 2.5c.3 2.2 1.3 3.2 3.5 3.5-2.2.3-3.2 1.3-3.5 3.5-.3-2.2-1.3-3.2-3.5-3.5 2.2-.3 3.2-1.3 3.5-3.5Z" fill="#8bcfdd"/>
        <circle cx="19.5" cy="18.5" r="1.5" fill="#baa2e8"/>
      </svg>
      <span class="rw-label"><strong class="rw-orb-title">积分助手</strong><small>点击展开 · 拖动移动</small></span>
    </button>
    <section class="rw-panel" id="rw-panel" aria-label="Bing Rewards 积分面板" aria-hidden="true">
      <div class="rw-bar"><div class="rw-grip" title="拖动调整面板位置">
        <svg viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="4" cy="9" r="1.2"/><circle cx="10" cy="9" r="1.2"/><circle cx="4" cy="14" r="1.2"/><circle cx="10" cy="14" r="1.2"/></svg>
        <strong>REWARDS</strong><span>拖动调整位置</span></div>
        <button class="rw-close" type="button" aria-label="收起积分面板" title="收起 (Esc)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      </div><div class="rw-content"></div>
    </section>`;

    const launcher = root.querySelector(".rw-launcher");
    const panel = root.querySelector(".rw-panel");
    const grip = root.querySelector(".rw-grip");
    const closeButton = root.querySelector(".rw-close");
    const content = root.querySelector(".rw-content");
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
    const bounds = () => expanded
      ? { width: Math.min(400, viewport().width - MARGIN * 2), height: Math.min(720, viewport().height - MARGIN * 2) }
      : { width: SIZE, height: SIZE };
    let expanded = false;
    let interacted = false;
    let destroyed = false;
    let running = false;
    let suppressClick = false;
    let drag = null;
    let side = "right";
    let orb = { x: viewport().width - SIZE - 24, y: 96 };
    let position = { ...orb };

    function layout() {
      const view = viewport();
      const size = bounds();
      orb.x = clamp(orb.x, MARGIN, view.width - SIZE - MARGIN);
      orb.y = clamp(orb.y, MARGIN, view.height - SIZE - MARGIN);
      position.x = clamp(expanded ? position.x : orb.x, MARGIN, view.width - size.width - MARGIN);
      position.y = clamp(expanded ? position.y : orb.y, MARGIN, view.height - size.height - MARGIN);
      if (!expanded) side = orb.x + SIZE / 2 >= view.width / 2 ? "right" : "left";
      host.dataset.side = side;
      host.dataset.open = String(expanded);
      Object.assign(host.style, { left: `${position.x}px`, top: `${position.y}px`, width: `${size.width}px`, height: `${size.height}px` });
      const hoverWidth = Math.min(156, side === "right" ? orb.x + SIZE - MARGIN : view.width - orb.x - MARGIN);
      host.style.setProperty?.("--rw-hover-width", `${Math.max(SIZE, hoverWidth)}px`);
      panel.inert = !expanded;
      launcher.inert = expanded;
      panel.setAttribute("aria-hidden", String(!expanded));
      launcher.setAttribute("aria-expanded", String(expanded));
    }

    function persist() {
      const view = viewport();
      try {
        Promise.resolve(savePosition({
          xRatio: clamp((orb.x - MARGIN) / Math.max(1, view.width - SIZE - MARGIN * 2), 0, 1),
          yRatio: clamp((orb.y - MARGIN) / Math.max(1, view.height - SIZE - MARGIN * 2), 0, 1),
        })).catch(() => {});
      } catch { /* A disabled extension/storage must not prevent dragging. */ }
    }

    function open() {
      if (expanded) return;
      interacted = true;
      expanded = true;
      position = { x: orb.x - (side === "right" ? bounds().width - SIZE : 0), y: orb.y };
      layout();
      closeButton.focus({ preventScroll: true });
    }

    function close() {
      if (!expanded) return;
      expanded = false;
      layout();
      launcher.focus({ preventScroll: true });
    }

    launcher.addEventListener("click", (event) => {
      if (suppressClick && event.detail !== 0) {
        suppressClick = false;
        event.preventDefault();
        return;
      }
      suppressClick = false;
      open();
    });
    closeButton.addEventListener("click", close);

    for (const handle of [launcher, grip]) {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        interacted = true;
        suppressClick = false;
        drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y, moved: false };
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        host.dataset.dragging = "true";
        event.preventDefault();
        position = { x: drag.x + dx, y: drag.y + dy };
        if (!expanded) orb = { ...position };
        layout();
        if (expanded) orb = { x: position.x + (side === "right" ? bounds().width - SIZE : 0), y: position.y };
      });
      const endDrag = (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        const moved = drag.moved;
        drag = null;
        host.dataset.dragging = "false";
        suppressClick = moved;
        try { handle.releasePointerCapture(event.pointerId); } catch { /* Already released on cancel. */ }
        if (moved) persist();
      };
      handle.addEventListener("pointerup", endDrag);
      handle.addEventListener("pointercancel", endDrag);
      handle.addEventListener("lostpointercapture", endDrag);
    }

    const onKey = (event) => {
      if (event.key === "Escape" && expanded) { event.preventDefault(); close(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", layout);
    function ensureVisible() {
      if (destroyed) return;
      if (!host.isConnected) document.documentElement.append(host);
      layout();
    }
    function setStatus({ running: active = false } = {}) {
      running = Boolean(active);
      host.dataset.running = String(running);
      root.querySelector(".rw-orb-title").textContent = running ? "正在领取" : "积分助手";
      launcher.setAttribute("aria-label", `${running ? "领取中，" : ""}展开积分面板，可拖动调整位置`);
    }
    const widget = {
      host, root, content, open, close, ensureVisible, setStatus,
      destroy() {
        destroyed = true;
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", layout);
        host.remove();
      },
    };
    host.__rewardsFloatingWidget = widget;
    ensureVisible();
    setStatus();
    try {
      Promise.resolve(loadPosition()).then((stored) => {
        if (destroyed || interacted || !Number.isFinite(stored?.xRatio) || !Number.isFinite(stored?.yRatio)) return;
        orb = {
          x: MARGIN + clamp(stored.xRatio, 0, 1) * Math.max(0, viewport().width - SIZE - MARGIN * 2),
          y: MARGIN + clamp(stored.yRatio, 0, 1) * Math.max(0, viewport().height - SIZE - MARGIN * 2),
        };
        layout();
      }).catch(() => {});
    } catch { /* Fall back to the default corner if saved coordinates are unavailable. */ }
    return widget;
  }

  function panelMarkup() {
    return `
      <div class="brac-body">
        <header><div><small>BING REWARDS v${VERSION}</small><h1>简单积分领取</h1></div><span data-role="status">尚未运行</span></header>
        <div class="brac-schedule"><span>每日首次访问自动执行</span><strong>北京时间 09:00 后</strong></div>
        <p>搜索打卡自动使用随机字符串，无需设置。</p>
        <button class="brac-run" data-role="run" type="button">立即领取</button>
        <section class="brac-progress" data-role="progress" hidden><small data-role="progress-meta"></small><strong data-role="progress-title"></strong></section>
        <section class="brac-summary"><div><small>最近结果</small><strong data-role="summary">完成 0 · 跳过 0 · 失败 0</strong><small data-role="memory">已识别 0 个任务入口</small></div><time data-role="finished"></time></section>
        <div class="brac-results" data-role="results"></div>
        <details class="brac-logs"><summary>运行日志</summary><pre data-role="logs">暂无日志</pre></details>
      </div>`;
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const widget = createRewardsFloatingWidget({
      hostId: PANEL_ID,
      loadPosition: () => readValue("bingRewardsFloatingPosition", null),
      savePosition: (position) => writeValue("bingRewardsFloatingPosition", position),
    });
    const style = document.createElement("style");
    style.textContent = `
      .brac-body{padding:20px;color:#162033;background:#f5f7fa;min-height:100%}
      header,.brac-schedule,.brac-summary{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{margin:2px 0 0;font-size:22px}small{display:block;color:#667085;font-size:11px;font-weight:650}header span{border:1px solid #d0d5dd;border-radius:999px;padding:6px 10px;background:#fff;color:#475467;font-size:12px}
      .brac-schedule,.brac-summary{margin-top:16px;border:1px solid #e4e7ec;border-radius:12px;padding:13px;background:#fff;font-size:12px}.brac-run{width:100%;min-height:44px;margin-top:14px;border:0;border-radius:10px;background:#175cd3;color:#fff;font:inherit;font-weight:700;cursor:pointer}.brac-run:disabled{opacity:.55;cursor:wait}
      .brac-progress{margin-top:12px;border:1px solid #84adff;border-radius:12px;padding:12px 14px;background:#eff8ff}.brac-progress[hidden]{display:none}.brac-progress strong{display:block;margin-top:4px;color:#1849a9;font-size:14px}.brac-summary strong{display:block;margin:3px 0;font-size:13px}.brac-summary time{color:#667085;font-size:11px}.brac-results{display:grid;gap:8px;margin-top:14px}.brac-item{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;border-left:3px solid #98a2b3;padding:8px 9px;background:#fff;font-size:11px}.brac-item[data-outcome="COMPLETED"]{border-left-color:#079455}.brac-item[data-outcome="FAILED"]{border-left-color:#d92d20}.brac-item strong{display:block;font-size:12px}.brac-item small{margin-top:3px}.brac-outcome{flex:none;color:#475467}
      .brac-logs{margin-top:14px;border:1px solid #e4e7ec;border-radius:10px;padding:10px;background:#fff;font-size:12px}.brac-logs summary{cursor:pointer;font-weight:700}.brac-logs pre{overflow:auto;max-height:220px;margin:10px 0 0;white-space:pre-wrap;color:#475467;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    `;
    widget.root.append(style);
    widget.content.innerHTML = panelMarkup();
    widget.root.querySelector('[data-role="run"]').addEventListener("click", () => startRun("manual"));
  }

  function renderPanel(state = getState()) {
    const host = document.getElementById(PANEL_ID);
    const root = host?.shadowRoot;
    if (!root) return;
    const running = state?.status === "running";
    host.__rewardsFloatingWidget?.setStatus({ running });
    const summary = state?.summary ?? { completed: 0, skipped: 0, failed: 0 };
    const memory = readValue(MEMORY_KEY, {});
    const status = root.querySelector('[data-role="status"]');
    const runButton = root.querySelector('[data-role="run"]');
    const progress = root.querySelector('[data-role="progress"]');
    status.textContent = tabIdentityError || (running && !ownsRun(state)
      ? state.ownerTabId ? "任务由另一个标签页执行" : "旧版本任务需手动重新开始"
      : running ? "执行中" : state?.status === "completed" ? "执行完成" :
      state?.status === "aborted" ? "异常结束" : "尚未运行");
    runButton.disabled = Boolean(tabIdentityError || (running && ownsRun(state)));
    runButton.textContent = running && !ownsRun(state) ? "原标签页关闭后重新开始" : running ? "正在领取…" : "立即领取";
    progress.hidden = !running;
    root.querySelector('[data-role="progress-meta"]').textContent = running
      ? `${state.currentStep?.section || "积分任务"} · ${state.index || 0}/${state.catalog?.length || 0}`
      : "";
    root.querySelector('[data-role="progress-title"]').textContent =
      running ? state.currentStep?.title || "正在准备执行任务" : "";
    root.querySelector('[data-role="summary"]').textContent =
      `完成 ${summary.completed} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`;
    root.querySelector('[data-role="memory"]').textContent =
      `已识别 ${Object.keys(memory).length} 个任务入口`;
    root.querySelector('[data-role="finished"]').textContent = state?.finishedAt
      ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).format(new Date(state.finishedAt))
      : "";
    const results = root.querySelector('[data-role="results"]');
    results.replaceChildren();
    (state?.results ?? []).slice(-30).reverse().forEach((result) => {
      const item = document.createElement("div");
      item.className = "brac-item";
      item.dataset.outcome = result.outcome;
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = result.title || "未命名入口";
      const reason = document.createElement("small");
      reason.textContent = REASON_LABELS[result.reason] || result.reason;
      const outcome = document.createElement("span");
      outcome.className = "brac-outcome";
      outcome.textContent = result.outcome === "COMPLETED" ? "已完成" :
        result.outcome === "SKIPPED" ? "已跳过" : "失败";
      detail.append(title, reason);
      item.append(detail, outcome);
      results.append(item);
    });
    const logs = state?.logs ?? [];
    root.querySelector('[data-role="logs"]').textContent = logs.length > 0
      ? logs.slice(-40).map((record) => {
        const time = new Date(record.at).toLocaleTimeString("zh-CN", { hour12: false });
        return `${time} ${record.event} ${JSON.stringify(record.details ?? {})}`;
      }).join("\n")
      : "暂无日志";
  }

  function scheduleAutomaticRun() {
    const attempt = () => {
      const state = getState();
      if (state?.status === "running") {
        void resumeRun();
        return;
      }
      if (location.hostname === "rewards.bing.com" && isAfterBeijingRunTime() &&
          readValue(AUTO_DATE_KEY, null) !== beijingDateKey()) startRun("automatic");
    };
    attempt();
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const next = new Date(shifted);
    next.setUTCHours(9, 0, 0, 0);
    if (next <= shifted) next.setUTCDate(next.getUTCDate() + 1);
    setTimeout(attempt, next.getTime() - shifted.getTime());
  }

  const testApi = {
    initializeTabIdentity,
    canRestartRun,
    createRandomSearchQuery,
    getSearchStreakProgress,
    submitBingSearch,
    activateSearchStreakLink,
    createRewardsFloatingWidget,
    inferCompleted,
    analyzeEntryFeatures,
    classifyEntry,
    activateRewardsLink,
    solveImagePuzzle,
    collectDashboardEntries,
    activateRewardsButton,
    createRun,
    executeCatalog,
    resumePhase,
    findNewQuestEntries,
    questProgressAdvanced,
    beijingDateKey,
    isAfterBeijingRunTime,
    urlsMatchPage,
  };
  if (globalThis.__BING_REWARDS_USERSCRIPT_TEST__) {
    globalThis.__BING_REWARDS_USERSCRIPT_API__ = testApi;
    return;
  }

  GM_registerMenuCommand("Bing Rewards：立即领取", () => startRun("manual"));
  void initializeTabIdentity().then(() => {
    const initialState = getState();
    if (location.hostname === "rewards.bing.com" || initialState?.status === "running") {
      mountPanel();
      renderPanel(initialState);
    }
    scheduleAutomaticRun();
  }).catch(() => {
    mountPanel();
    renderPanel();
  });
})();

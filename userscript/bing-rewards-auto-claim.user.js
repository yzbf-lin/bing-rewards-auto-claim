// ==UserScript==
// @name         Bing Rewards 简单积分领取
// @namespace    https://github.com/yzbf-lin/bing-rewards-auto-claim
// @version      0.3.0
// @description  识别并处理 Bing Rewards 中只需打开或点击一次即可完成的积分入口。
// @author       yzbf-lin
// @license      MIT
// @match        https://rewards.bing.com/*
// @match        https://bing.com/*
// @match        https://www.bing.com/*
// @match        https://*.bing.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/yzbf-lin/bing-rewards-auto-claim/main/userscript/bing-rewards-auto-claim.user.js
// @downloadURL  https://raw.githubusercontent.com/yzbf-lin/bing-rewards-auto-claim/main/userscript/bing-rewards-auto-claim.user.js
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "0.3.0";
  const STATE_KEY = "bingRewardsAutoClaimState";
  const MEMORY_KEY = "bingRewardsAutoClaimMemory";
  const AUTO_DATE_KEY = "bingRewardsAutoClaimLastAutomaticDate";
  const PANEL_ID = "bing-rewards-userscript-panel";
  const RUNNER_KEY = "__bingRewardsUserscriptRunner";
  const REWARDS_URL = "https://rewards.bing.com/earn";
  const DASHBOARD_URL = "https://rewards.bing.com/dashboard?section=dailyset";
  const MAX_TASK_RECORDS = 200;
  const SETTLE_DELAY_MS = 1_800;

  const COMPLEX_TASK_PATTERNS = [
    /每日搜索|daily\s+search|(?:完成|进行|需要|只需)\s*\d+\s*(?:次|个)?\s*(?:搜索|search(?:es)?)|\d+\s*(?:次|个)?\s*(?:搜索|search(?:es)?)/i,
    /答题|测验|trivia/i,
    /拼图|puzzle/i,
    /投票|poll/i,
    /购买|订阅|purchase|subscribe/i,
    /下载|安装|download|install/i,
    /xbox|game\s*pass|游戏|gaming/i,
    /连续|签到|streak|check[ -]?in/i,
    /邀请|invite|refer/i,
    /默认搜索引擎|default\s+search/i,
    /\/earn\/quest\/|punchcard|\d+\s*\/\s*\d+\s*个任务|multi[ -]?step\s+quest/i,
  ];
  const COMPLETED_PATTERN = /已完成|已领取|completed|claimed/i;
  const CLICK_ONLY_PATTERN = /(?:点击|打开|访问).{0,12}(?:即可)?(?:完成|获得|领取|查看)|click.{0,12}(?:complete|earn|view)/i;
  const PROGRESS_PATTERN = /\d+\s*\/\s*\d+/;
  const SUPPORTED_KINDS = new Set(["link", "button"]);
  const TRACKING_PARAMETERS = new Set(["form", "ocid", "publ", "crea", "filters"]);
  const REASON_LABELS = {
    ACTION_TRIGGERED: "已触发领取动作",
    FEATURE_MATCHED_ONE_STEP: "根据页面特征识别为单步任务",
    ALREADY_TRIGGERED_TODAY: "今天已经触发过",
    COMPLEX_TASK: "需要继续交互",
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

  function setState(state) {
    writeValue(STATE_KEY, state);
    renderPanel(state);
    return state;
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
    const plusMatch = text.match(/\+\s*([\d,]{1,9})(?:\s*积分)?/i);
    if (plusMatch) return Number(plusMatch[1].replaceAll(",", ""));
    const pointsMatch = text.match(/([\d,]{1,9})\s*(?:积分|points?)/i);
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

  function analyzeEntryFeatures(entry) {
    const title = normalize(entry.title);
    const text = normalize(entry.text);
    const url = normalize(entry.url);
    const visibleContent = `${title} ${text}`;
    const searchable = `${title} ${text} ${url}`;
    const declaredRewardPoints = Number(entry.rewardPoints);
    const rewardPoints = Number.isFinite(declaredRewardPoints) && declaredRewardPoints > 0
      ? declaredRewardPoints
      : findRewardPoints(`${title} ${text}`);
    const signals = entry.signals ?? {};
    const supported = SUPPORTED_KINDS.has(entry.kind);
    const navigationOnly = entry.kind === "link";
    const trustedDestination = navigationOnly && isTrustedDestination(url);
    const completed = signals.completed ?? inferCompleted(searchable);
    const hasProgress = signals.hasProgress ?? PROGRESS_PATTERN.test(searchable);
    const clickOnlyCue = signals.clickOnlyCue ?? (
      CLICK_ONLY_PATTERN.test(searchable) || /[?&]rnoreward=1(?:&|$)/i.test(url)
    );
    const hasRewardSignal = signals.hasRewardBadge === true || rewardPoints !== null;
    const opensNewTab = signals.opensNewTab === true;
    const interactiveQuiz = /\bquiz\b/i.test(visibleContent) ||
      /[?&]form=dsetqu(?:&|$)|BingQA_QuizLanding/i.test(url);
    const complex = interactiveQuiz ||
      COMPLEX_TASK_PATTERNS.some((pattern) => pattern.test(searchable));
    const declaredOneStep =
      (entry.action === "quest-step" && navigationOnly) ||
      (hasRewardSignal && entry.section === "待领取积分" && entry.kind === "button") ||
      (hasRewardSignal && entry.section === "每日活动" && navigationOnly);

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
      complex,
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
    if (features.complex || features.hasProgress) {
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
          disabled: Boolean(
            element.disabled || element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true" || restrictionText
          ),
          signals: {
            opensNewTab: element.getAttribute("target") === "_blank",
            hasProgress: PROGRESS_PATTERN.test(text),
            hasRewardBadge: paragraphTexts.some((value) => /^\+\s*[\d,]+/.test(value)),
            clickOnlyCue: CLICK_ONLY_PATTERN.test(text) || /[?&]rnoreward=1(?:&|$)/i.test(url ?? ""),
            completed: completedFromPageState(text),
          },
        });
      });
    });
    return { entries, missingSections };
  }

  function collectDashboardEntries() {
    const entries = [];
    Array.from(document.querySelectorAll("a[href], button")).forEach((element) => {
      const text = normalize(element.innerText || element.textContent);
      const section = groupName(element.closest?.('[role="group"]')) || "积分首页";
      const claimMatch = element.tagName === "BUTTON"
        ? text.match(/可领取(?:\s+可领取)?\s+([\d,]+)\s+领取/i)
        : null;
      const claimablePoints = claimMatch ? Number(claimMatch[1].replaceAll(",", "")) : 0;
      const dailyRewardPoints = section === "每日活动"
        ? Array.from(element.querySelectorAll("p"))
          .map((paragraph) => normalize(paragraph.textContent))
          .reverse()
          .map((value) => value.match(/^\+?\s*([\d,]{1,9})(?:\s*(?:积分|points?))?$/i))
          .find(Boolean)
        : null;
      const detectedRewardPoints = claimablePoints > 0
        ? claimablePoints
        : dailyRewardPoints ? Number(dailyRewardPoints[1].replaceAll(",", "")) : null;
      const explicitReward = /\+\s*[\d,]{1,9}(?:\s*(?:积分|points?))?/i.test(text);
      if (!explicitReward && detectedRewardPoints === null) return;

      const id = `dashboard-entry-${entries.length}`;
      const imageTitle = normalize(element.querySelector("img[alt]")?.getAttribute("alt"));
      const paragraphTitle = normalize(element.querySelector("p")?.textContent);
      const ariaTitle = normalize(element.getAttribute("aria-label"));
      const restrictionText = /需要.+级别|等级不足|level required/i.test(text);
      element.setAttribute("data-rewards-auto-id", id);
      if (claimablePoints > 0) element.setAttribute("data-rewards-auto-action", "claim-points");
      entries.push({
        id,
        section: claimablePoints > 0 ? "待领取积分" : section,
        title: claimablePoints > 0
          ? "领取待领取积分"
          : imageTitle || paragraphTitle || ariaTitle || text.slice(0, 80) || "未命名入口",
        text,
        kind: element.tagName === "A" ? "link" : "button",
        url: element.tagName === "A" ? element.href || element.getAttribute("href") : null,
        disabled: Boolean(
          element.disabled || element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" || restrictionText
        ),
        action: claimablePoints > 0 ? "claim-points" : null,
        rewardPoints: detectedRewardPoints,
        signals: {
          opensNewTab: element.getAttribute("target") === "_blank",
          hasProgress: PROGRESS_PATTERN.test(text),
          hasRewardBadge: explicitReward || detectedRewardPoints !== null,
          clickOnlyCue: CLICK_ONLY_PATTERN.test(text) ||
            /[?&]rnoreward=1(?:&|$)/i.test(element.href ?? ""),
          completed: completedFromPageState(text),
        },
      });
    });
    return { entries, missingSections: [] };
  }

  function collectQuestEntries(parentTitle) {
    const main = document.querySelector("main");
    if (!main) return { entries: [], missingSections: [`任务子步骤：${parentTitle}`] };
    const entries = [];
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
        },
      });
    });
    return { entries, missingSections: [] };
  }

  async function activateRewardsButton(entryId) {
    const element = document.querySelector(`[data-rewards-auto-id="${entryId}"]`);
    if (!element || element.tagName !== "BUTTON") return false;
    const action = element.getAttribute("data-rewards-auto-action");
    element.querySelectorAll?.("a[target]").forEach((link) => link.removeAttribute("target"));
    element.click();
    if (action !== "claim-points") return true;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const confirmButton = Array.from(document.querySelectorAll("button")).find((button) => {
        const text = normalize(button.innerText || button.textContent);
        return text === "领取积分" && Boolean(button.closest?.('[role="dialog"]'));
      });
      if (confirmButton) {
        confirmButton.click();
        return true;
      }
      await delay(100);
    }
    return false;
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
      entries: catalog.entries.map(({ section, title, text, kind, url, disabled, action }) => ({
        section, title, text, kind, url, disabled, action,
      })),
    });
  }

  async function collectStableCatalog(collector, args = [], requireSections = false) {
    let previousSignature = null;
    let latest = { entries: [], missingSections: [] };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      latest = collector(...args);
      const currentSignature = signature(latest);
      if (currentSignature === previousSignature &&
          (!requireSections || latest.missingSections.length === 0)) return latest;
      previousSignature = currentSignature;
      if (attempt < 29) await delay(500);
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
    state.catalog.push(...catalog.entries.map((entry) => ({ ...entry, source, sourceUrl })));
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
    const pending = state.pending;
    if (!pending?.entry) throw new Error("PENDING_ACTION_MISSING");
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

    state.phase = "execute-button-wait";
    setState(state);
    const restoreWindowOpen = forceWindowOpenIntoCurrentTab();
    const activated = await activateRewardsButton(matches[0].id);
    await delay(SETTLE_DELAY_MS);
    restoreWindowOpen();
    if (!activated) {
      await finishPendingAction(state, "FAILED", "BUTTON_ACTIVATION_FAILED");
      return;
    }
    await finishPendingAction(state);
  }

  async function executeCatalog(state) {
    while (state.index < state.catalog.length) {
      const entry = state.catalog[state.index];
      setCurrentStep(state, entry.title || "未命名入口", entry.section || "积分任务");
      const recognition = classifyEntry(entry);
      const previous = readValue(MEMORY_KEY, {})[taskMemoryKey(entry)];
      const dateKey = beijingDateKey(new Date(state.startedAt));
      const decision = state.trigger !== "manual" && recognition.decision === "ELIGIBLE" &&
        previous?.lastCompletedDate === dateKey
        ? { ...recognition, decision: "SKIPPED", reason: "ALREADY_TRIGGERED_TODAY" }
        : recognition;

      if (decision.decision === "SKIPPED") {
        storeTaskResult(state, entry, recognition, "SKIPPED", decision.reason, Date.now());
        state.index += 1;
        setState(state);
        await delay(30);
        continue;
      }

      state.pending = { entry, recognition, startedAt: Date.now() };
      if (entry.kind === "link") {
        state.phase = "execute-link-wait";
        setState(state);
        if (navigateCurrentTab(entry.url)) return;
        await delay(SETTLE_DELAY_MS);
        await finishPendingAction(state);
        return;
      }

      state.phase = "execute-button";
      setState(state);
      await executeButton(state);
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
    setState(state);
    console.warn(`[Rewards Auto Claim] ABORTED: ${reason}`);
  }

  async function resumeRun() {
    const state = getState();
    if (!state || state.status !== "running" || globalThis[RUNNER_KEY]) return;
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
      appendCatalog(state, catalog, "dashboard", DASHBOARD_URL);
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
    const startedAt = new Date();
    return {
      version: VERSION,
      runId: `userscript-${startedAt.getTime()}`,
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
      currentStep: {
        title: "正在识别积分入口",
        section: "任务识别",
        status: "running",
        index: 0,
        total: 0,
      },
      results: [],
      summary: { total: 0, completed: 0, skipped: 0, failed: 0 },
    };
  }

  function startRun(trigger = "manual") {
    const current = getState();
    if (current?.status === "running") {
      mountPanel();
      renderPanel(current);
      void resumeRun();
      return;
    }
    const state = createRun(trigger);
    mountPanel();
    setState(state);
    void resumeRun();
  }

  function panelMarkup() {
    return `
      <button class="brac-toggle" type="button" aria-label="折叠面板">−</button>
      <div class="brac-body">
        <header><div><small>BING REWARDS v${VERSION}</small><h1>简单积分领取</h1></div><span data-role="status">尚未运行</span></header>
        <div class="brac-schedule"><span>每日首次访问自动执行</span><strong>北京时间 09:00 后</strong></div>
        <button class="brac-run" data-role="run" type="button">立即领取</button>
        <section class="brac-progress" data-role="progress" hidden><small data-role="progress-meta"></small><strong data-role="progress-title"></strong></section>
        <section class="brac-summary"><div><small>最近结果</small><strong data-role="summary">完成 0 · 跳过 0 · 失败 0</strong><small data-role="memory">已识别 0 个任务入口</small></div><time data-role="finished"></time></section>
        <div class="brac-results" data-role="results"></div>
      </div>`;
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const host = document.createElement("div");
    host.id = PANEL_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 24px);font-family:Inter,"Segoe UI","PingFang SC",sans-serif;color:#162033}
      *{box-sizing:border-box}.brac-body{overflow:auto;max-height:calc(100vh - 24px);padding:20px;border:1px solid #d0d5dd;border-radius:16px;background:#f5f7fa;box-shadow:0 18px 45px rgba(15,23,42,.28)}
      header,.brac-schedule,.brac-summary{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{margin:2px 0 0;font-size:22px}small{display:block;color:#667085;font-size:11px;font-weight:650}header span{border:1px solid #d0d5dd;border-radius:999px;padding:6px 10px;background:#fff;color:#475467;font-size:12px}
      .brac-schedule,.brac-summary{margin-top:16px;border:1px solid #e4e7ec;border-radius:12px;padding:13px;background:#fff;font-size:12px}.brac-run{width:100%;min-height:44px;margin-top:14px;border:0;border-radius:10px;background:#175cd3;color:#fff;font:inherit;font-weight:700;cursor:pointer}.brac-run:disabled{opacity:.55;cursor:wait}
      .brac-progress{margin-top:12px;border:1px solid #84adff;border-radius:12px;padding:12px 14px;background:#eff8ff}.brac-progress[hidden]{display:none}.brac-progress strong{display:block;margin-top:4px;color:#1849a9;font-size:14px}.brac-summary strong{display:block;margin:3px 0;font-size:13px}.brac-summary time{color:#667085;font-size:11px}.brac-results{display:grid;gap:8px;margin-top:14px}.brac-item{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;border-left:3px solid #98a2b3;padding:8px 9px;background:#fff;font-size:11px}.brac-item[data-outcome="COMPLETED"]{border-left-color:#079455}.brac-item[data-outcome="FAILED"]{border-left-color:#d92d20}.brac-item strong{display:block;font-size:12px}.brac-item small{margin-top:3px}.brac-outcome{flex:none;color:#475467}
      .brac-toggle{position:absolute;top:8px;right:8px;z-index:2;width:28px;height:28px;border:1px solid #d0d5dd;border-radius:50%;background:#fff;color:#475467;cursor:pointer}:host(.collapsed){width:48px;height:48px}:host(.collapsed) .brac-body{display:none}:host(.collapsed) .brac-toggle{top:0;right:0;width:44px;height:44px;font-size:0}:host(.collapsed) .brac-toggle::after{content:"积";font-size:14px;font-weight:700;color:#175cd3}
    </style>${panelMarkup()}`;
    shadow.querySelector('[data-role="run"]').addEventListener("click", () => startRun("manual"));
    shadow.querySelector(".brac-toggle").addEventListener("click", (event) => {
      const collapsed = host.classList.toggle("collapsed");
      event.currentTarget.textContent = collapsed ? "+" : "−";
      event.currentTarget.setAttribute("aria-label", collapsed ? "展开面板" : "折叠面板");
    });
    document.documentElement.append(host);
  }

  function renderPanel(state = getState()) {
    const host = document.getElementById(PANEL_ID);
    const root = host?.shadowRoot;
    if (!root) return;
    const running = state?.status === "running";
    const summary = state?.summary ?? { completed: 0, skipped: 0, failed: 0 };
    const memory = readValue(MEMORY_KEY, {});
    const status = root.querySelector('[data-role="status"]');
    const runButton = root.querySelector('[data-role="run"]');
    const progress = root.querySelector('[data-role="progress"]');
    status.textContent = running ? "执行中" : state?.status === "completed" ? "执行完成" :
      state?.status === "aborted" ? "异常结束" : "尚未运行";
    runButton.disabled = running;
    runButton.textContent = running ? "正在领取…" : "立即领取";
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
    inferCompleted,
    analyzeEntryFeatures,
    classifyEntry,
    beijingDateKey,
    isAfterBeijingRunTime,
    urlsMatchPage,
  };
  if (globalThis.__BING_REWARDS_USERSCRIPT_TEST__) {
    globalThis.__BING_REWARDS_USERSCRIPT_API__ = testApi;
    return;
  }

  GM_registerMenuCommand("Bing Rewards：立即领取", () => startRun("manual"));
  const initialState = getState();
  if (location.hostname === "rewards.bing.com" || initialState?.status === "running") {
    mountPanel();
    renderPanel(initialState);
  }
  scheduleAutomaticRun();
})();

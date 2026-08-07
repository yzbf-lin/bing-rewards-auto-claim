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

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findRewardPoints(text) {
  const claimableMatch = text.match(/可领取(?:\s+可领取)?\s+([\d,]+)\s+领取/i);
  if (claimableMatch) {
    return Number(claimableMatch[1].replaceAll(",", ""));
  }

  const plusMatch = text.match(/\+\s*([\d,]{1,9})(?:\s*积分)?/i);
  if (plusMatch) {
    return Number(plusMatch[1].replaceAll(",", ""));
  }

  const pointsMatch = text.match(/([\d,]{1,9})\s*(?:积分|points?)/i);
  return pointsMatch ? Number(pointsMatch[1].replaceAll(",", "")) : null;
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

function isTrustedDestination(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"));
  } catch {
    return false;
  }
}

export function analyzeEntryFeatures(entry) {
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
  const interactiveQuiz = /答题|测验|trivia|\bquiz\b/i.test(visibleContent) ||
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
    clickOnlyCue,
    hasRewardSignal,
    navigationOnly,
    trustedDestination,
    opensNewTab,
    interactiveQuiz,
    complex,
    declaredOneStep,
    confidence,
    genericOneStep:
      confidence >= 70 &&
      !hasProgress &&
      !complex &&
      (hasRewardSignal || clickOnlyCue) &&
      (!navigationOnly || trustedDestination),
  };
}

export function classifyEntry(entry) {
  const features = analyzeEntryFeatures(entry);
  const { rewardPoints } = features;

  if (entry.disabled) {
    return { decision: "SKIPPED", reason: "DISABLED", rewardPoints };
  }

  if (features.completed) {
    return { decision: "SKIPPED", reason: "COMPLETED", rewardPoints };
  }

  if (!features.supported) {
    return { decision: "SKIPPED", reason: "UNSUPPORTED_ENTRY_TYPE", rewardPoints };
  }

  if (features.interactiveQuiz) {
    return { decision: "SKIPPED", reason: "INTERACTIVE_QUIZ", rewardPoints };
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

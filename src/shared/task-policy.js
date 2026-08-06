const COMPLEX_TASK_PATTERNS = [
  /搜索|search/i,
  /答题|测验|quiz|trivia/i,
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

function isKnownOneStepReward(entry, rewardPoints) {
  if (rewardPoints === null) return false;

  if (entry.section === "待领取积分" && entry.kind === "button") return true;
  if (entry.section === "每日活动" && entry.kind === "link") return true;
  if (entry.kind !== "link") return false;

  const url = normalize(entry.url);
  const fromDashboard = entry.source === "dashboard" || entry.section === "积分首页";
  return (
    fromDashboard &&
    /^https:\/\/www\.bing\.com\/search\?/i.test(url) &&
    /[?&]rnoreward=1(?:&|$)/i.test(url)
  );
}

export function classifyEntry(entry) {
  const title = normalize(entry.title);
  const text = normalize(entry.text);
  const url = normalize(entry.url);
  const searchable = `${title} ${text} ${url}`;
  const rewardPoints = findRewardPoints(`${title} ${text}`);

  if (entry.disabled) {
    return { decision: "SKIPPED", reason: "DISABLED", rewardPoints };
  }

  if (COMPLETED_PATTERN.test(searchable)) {
    return { decision: "SKIPPED", reason: "COMPLETED", rewardPoints };
  }

  if (!SUPPORTED_KINDS.has(entry.kind)) {
    return { decision: "SKIPPED", reason: "UNSUPPORTED_ENTRY_TYPE", rewardPoints };
  }

  if (isKnownOneStepReward(entry, rewardPoints)) {
    return { decision: "ELIGIBLE", reason: "KNOWN_ONE_STEP_REWARD", rewardPoints };
  }

  if (COMPLEX_TASK_PATTERNS.some((pattern) => pattern.test(searchable))) {
    return { decision: "SKIPPED", reason: "COMPLEX_TASK", rewardPoints };
  }

  if (rewardPoints === null) {
    return { decision: "SKIPPED", reason: "NO_REWARD_SIGNAL", rewardPoints };
  }

  return { decision: "ELIGIBLE", reason: "ONE_STEP_REWARD", rewardPoints };
}

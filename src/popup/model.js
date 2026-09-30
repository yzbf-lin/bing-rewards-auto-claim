const OUTCOME_LABELS = {
  COMPLETED: "已完成",
  SKIPPED: "已跳过",
  FAILED: "失败",
};

const REASON_LABELS = {
  SCRIPTING_PAGE_UNSUPPORTED: "当前页面无法运行积分脚本，请打开 Bing Rewards 页面并确认已登录后重试",
  ACTION_TRIGGERED: "已触发领取动作",
  SEARCH_STREAK: "单次搜索打卡",
  SEARCH_STREAK_ALREADY_ATTEMPTED: "本轮已尝试搜索打卡，不重复提交",
  SEARCH_STREAK_UNAVAILABLE: "搜索打卡当前不可用，未提交搜索",
  SEARCH_STREAK_COMPLETED: "今日搜索已确认 1/1",
  SEARCH_STREAK_LINK_UNAVAILABLE: "搜索打卡弹窗未出现可用的“立即搜索”入口",
  SEARCH_STREAK_LINK_NOT_UNIQUE: "搜索打卡弹窗入口不唯一，已停止",
  SEARCH_STREAK_LINK_UNSAFE: "搜索打卡弹窗链接不受支持",
  SEARCH_STREAK_NAVIGATION_NOT_CONFIRMED: "未进入搜索打卡目标页，请重新运行",
  SEARCH_QUERY_REQUIRED: "未设置打卡搜索词，请在设置中保存后重试",
  SEARCH_QUERY_INVALID: "打卡搜索词无效，请在设置中修改后重试",
  SEARCH_FORM_UNAVAILABLE: "未找到可用的必应搜索框",
  SEARCH_FORM_UNSAFE: "搜索表单目标不受支持",
  SEARCH_FORM_INVALID: "搜索表单校验未通过",
  SEARCH_PAGE_UNSUPPORTED: "当前页面不支持提交必应搜索",
  SEARCH_SUBMIT_UNAVAILABLE: "页面暂不支持提交搜索",
  SEARCH_SUBMIT_FAILED: "提交搜索失败，请重试",
  SEARCH_SUBMIT_NOT_CONFIRMED: "未确认搜索结果页加载，已停止本次搜索",
  SEARCH_SUBMIT_CANCELLED: "页面取消了搜索提交",
  SEARCH_STREAK_NOT_CONFIRMED: "未确认今日搜索进度达到 1/1",
  SEARCH_STREAK_DATE_CHANGED: "任务期间已跨日，未确认今天的搜索进度",
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

export function buildPopupModel({ currentRun, lastRun, taskMemory }) {
  const active = currentRun?.status === "running";
  const displayRun = currentRun ?? lastRun;
  const summary = displayRun?.summary ?? { completed: 0, skipped: 0, failed: 0 };
  const groupsBySection = new Map();

  for (const result of displayRun?.results ?? []) {
    const section = result.section || "运行信息";
    if (!groupsBySection.has(section)) groupsBySection.set(section, []);
    groupsBySection.get(section).push({
      ...result,
      outcomeLabel: OUTCOME_LABELS[result.outcome] ?? result.outcome,
      reasonLabel: REASON_LABELS[result.reason] ?? result.reason,
    });
  }

  let statusLabel = "尚未运行";
  if (active && currentRun.progress?.total > 0) {
    statusLabel = `正在领取 ${currentRun.progress.current}/${currentRun.progress.total}`;
  } else if (active) statusLabel = "正在读取任务";
  else if (lastRun?.status === "completed") statusLabel = "上次领取已完成";
  else if (lastRun?.status === "aborted") statusLabel = "上次运行异常结束";

  const step = currentRun?.currentStep;
  const stepCurrent = step?.index ?? currentRun?.progress?.current ?? 0;
  const stepTotal = step?.total ?? currentRun?.progress?.total ?? 0;

  return {
    statusLabel,
    actionDisabled: active,
    summaryText: `完成 ${summary.completed} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`,
    memoryText: `已识别 ${Object.keys(taskMemory ?? {}).length} 个任务入口`,
    finishedAt: displayRun?.finishedAt ?? null,
    currentStepTitle: active ? step?.title || "正在准备执行任务" : null,
    currentStepMeta: active
      ? `${stepTotal > 0 ? `步骤 ${stepCurrent}/${stepTotal} · ` : ""}${step?.section || "积分任务"}`
      : null,
    groups: [...groupsBySection].map(([section, items]) => ({ section, items })),
  };
}

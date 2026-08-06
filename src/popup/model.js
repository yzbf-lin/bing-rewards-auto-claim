const OUTCOME_LABELS = {
  COMPLETED: "已完成",
  SKIPPED: "已跳过",
  FAILED: "失败",
};

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

export function buildPopupModel({ currentRun, lastRun, taskMemory }) {
  const active = currentRun?.status === "running";
  const summary = lastRun?.summary ?? { completed: 0, skipped: 0, failed: 0 };
  const groupsBySection = new Map();

  for (const result of lastRun?.results ?? []) {
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

  return {
    statusLabel,
    actionDisabled: active,
    summaryText: `完成 ${summary.completed} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`,
    memoryText: `已识别 ${Object.keys(taskMemory ?? {}).length} 个任务入口`,
    finishedAt: lastRun?.finishedAt ?? null,
    groups: [...groupsBySection].map(([section, items]) => ({ section, items })),
  };
}

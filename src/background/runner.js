import { beijingDateKey } from "./scheduler.js";
import { summarizeResults } from "./results.js";
import { classifyEntry } from "../shared/task-policy.js";
import { rememberTask, taskMemoryKey } from "../shared/task-memory.js";

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createClaimRunner({
  driver,
  storage,
  logger = console,
  now = () => new Date(),
}) {
  let activeRun = null;

  const execute = async (trigger, context = {}) => {
    const startedAt = now();
    const run = {
      runId: `claim-${startedAt.getTime()}`,
      trigger,
      status: "running",
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      phase: "collecting",
      progress: null,
      currentStep: {
        title: "正在识别积分入口",
        section: "任务识别",
        status: "running",
      },
      results: [],
      summary: { total: 0, completed: 0, skipped: 0, failed: 0 },
    };

    await storage.set({ currentRun: run });
    if (typeof driver.showProgress === "function") {
      try {
        await driver.showProgress(context);
      } catch (error) {
        logger.error("[Rewards Auto Claim] PROGRESS_PANEL_FAILED", serializeError(error));
      }
    }
    const stored = await storage.get("taskMemory");
    let taskMemory = stored.taskMemory ?? {};
    const runDateKey = beijingDateKey(startedAt);

    const recordTask = (entry, decision, outcome) => {
      taskMemory = rememberTask(taskMemory, {
        entry,
        decision,
        outcome,
        observedAt: now().toISOString(),
        dateKey: runDateKey,
      });
    };

    try {
      const catalog = await driver.loadCatalog(context);
      logger.info("[Rewards Auto Claim] CATALOG_LOADED", {
        entries: catalog.entries?.length ?? 0,
        missingSections: catalog.missingSections ?? [],
      });
      run.phase = "executing";
      run.progress = { current: 0, total: catalog.entries?.length ?? 0 };
      run.currentStep = {
        title: `已识别 ${run.progress.total} 个积分入口`,
        section: "任务识别",
        status: "completed",
        index: 0,
        total: run.progress.total,
      };

      for (const section of catalog.missingSections ?? []) {
        run.results.push({
          scope: "section",
          section,
          title: section,
          outcome: "FAILED",
          reason: "SECTION_NOT_FOUND",
          durationMs: 0,
        });
      }

      run.summary = summarizeResults(run.results);
      await storage.set({ currentRun: run });

      for (const [entryIndex, entry] of (catalog.entries ?? []).entries()) {
        run.currentStep = {
          title: entry.title || "未命名入口",
          section: entry.section || "积分任务",
          status: "running",
          index: entryIndex + 1,
          total: run.progress.total,
        };
        await storage.set({ currentRun: run });

        const recognition = classifyEntry(entry);
        const previous = taskMemory[taskMemoryKey(entry)];
        const decision =
          trigger !== "manual" &&
          recognition.decision === "ELIGIBLE" &&
          previous?.lastCompletedDate === runDateKey
            ? {
              decision: "SKIPPED",
              reason: "ALREADY_TRIGGERED_TODAY",
              rewardPoints: recognition.rewardPoints,
            }
            : recognition;
        const itemStartedAt = now().getTime();

        if (decision.decision === "SKIPPED") {
          const result = {
            ...entry,
            scope: "entry",
            outcome: "SKIPPED",
            reason: decision.reason,
            rewardPoints: decision.rewardPoints,
            durationMs: 0,
          };
          run.results.push(result);
          recordTask(entry, recognition, result.outcome);
          logger.warn("[Rewards Auto Claim] SKIPPED", result);
          run.currentStep.status = "skipped";
          run.progress.current = entryIndex + 1;
          run.summary = summarizeResults(run.results);
          await storage.set({ currentRun: run, taskMemory });
          continue;
        }

        try {
          const actionResult = entry.kind === "link"
            ? await driver.executeLink(entry, context)
            : await driver.executeButton(entry, context);
          const result = {
            ...entry,
            ...actionResult,
            scope: "entry",
            outcome: "COMPLETED",
            reason: "ACTION_TRIGGERED",
            rewardPoints: decision.rewardPoints,
            durationMs: now().getTime() - itemStartedAt,
          };
          run.results.push(result);
          recordTask(entry, recognition, result.outcome);
          logger.info("[Rewards Auto Claim] COMPLETED", result);
          run.currentStep.status = "completed";
        } catch (error) {
          const result = {
            ...entry,
            scope: "entry",
            outcome: "FAILED",
            reason: serializeError(error),
            rewardPoints: decision.rewardPoints,
            durationMs: now().getTime() - itemStartedAt,
          };
          run.results.push(result);
          recordTask(entry, recognition, result.outcome);
          logger.error("[Rewards Auto Claim] FAILED", result);
          run.currentStep.status = "failed";
        }

        run.progress.current = entryIndex + 1;
        run.summary = summarizeResults(run.results);
        await storage.set({ currentRun: run, taskMemory });
      }

      if (context.targetTabId && typeof driver.restore === "function") {
        run.phase = "returning";
        run.currentStep = {
          title: "正在返回积分页面",
          section: "运行状态",
          status: "running",
          index: run.progress.current,
          total: run.progress.total,
        };
        await storage.set({ currentRun: run, taskMemory });
        try {
          await driver.restore(context);
        } catch (error) {
          logger.error("[Rewards Auto Claim] RESTORE_FAILED", serializeError(error));
        }
      }

      run.status = "completed";
    } catch (error) {
      run.status = "aborted";
      run.phase = "failed";
      run.currentStep = {
        title: "执行过程已中断",
        section: "运行状态",
        status: "failed",
      };
      const result = {
        scope: "page",
        title: "积分页面",
        outcome: "FAILED",
        reason: serializeError(error),
        durationMs: now().getTime() - startedAt.getTime(),
      };
      run.results.push(result);
      logger.error("[Rewards Auto Claim] ABORTED", result);
      await storage.set({ currentRun: run, taskMemory });
    } finally {
      try {
        await driver.cleanup();
      } catch (error) {
        logger.error("[Rewards Auto Claim] CLEANUP_FAILED", serializeError(error));
      }
    }

    run.finishedAt = now().toISOString();
    run.phase = "finished";
    run.currentStep = {
      title: run.status === "completed" ? "本轮任务检查完成" : "执行过程已中断",
      section: "运行状态",
      status: run.status === "completed" ? "completed" : "failed",
    };
    run.summary = summarizeResults(run.results);
    const finalState = { currentRun: null, lastRun: run, taskMemory };
    if (trigger !== "manual") {
      finalState.lastAutomaticDate = beijingDateKey(now());
    }
    await storage.set(finalState);
    logger.info("[Rewards Auto Claim] RUN_FINISHED", run.summary);
    return run;
  };

  return {
    run(trigger = "manual", context = {}) {
      if (activeRun) return activeRun;
      activeRun = execute(trigger, context).finally(() => {
        activeRun = null;
      });
      return activeRun;
    },
    isRunning() {
      return activeRun !== null;
    },
  };
}

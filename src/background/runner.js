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
      results: [],
      summary: { total: 0, completed: 0, skipped: 0, failed: 0 },
    };

    await storage.set({ currentRun: run });
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
        const recognition = classifyEntry(entry);
        const previous = taskMemory[taskMemoryKey(entry)];
        const decision =
          recognition.decision === "ELIGIBLE" && previous?.lastCompletedDate === runDateKey
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
        }

        run.progress.current = entryIndex + 1;
        run.summary = summarizeResults(run.results);
        await storage.set({ currentRun: run, taskMemory });
      }

      run.status = "completed";
    } catch (error) {
      run.status = "aborted";
      run.phase = "failed";
      const result = {
        scope: "page",
        title: "积分页面",
        outcome: "FAILED",
        reason: serializeError(error),
        durationMs: now().getTime() - startedAt.getTime(),
      };
      run.results.push(result);
      logger.error("[Rewards Auto Claim] ABORTED", result);
    } finally {
      try {
        await driver.cleanup();
      } catch (error) {
        logger.error("[Rewards Auto Claim] CLEANUP_FAILED", serializeError(error));
      }
    }

    run.finishedAt = now().toISOString();
    run.phase = "finished";
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

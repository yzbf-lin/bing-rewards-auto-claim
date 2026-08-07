function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function beginManualRun({
  runner,
  targetTabId,
  consumePendingAutomaticRun,
  logger = console,
}) {
  const completion = Promise.resolve(runner.run("manual", { targetTabId }))
    .then(() => consumePendingAutomaticRun())
    .catch((error) => logger.warn("[Rewards Auto Claim] MANUAL_RUN_FAILED", serializeError(error)));

  return {
    response: { ok: true, started: true },
    completion,
  };
}

export function summarizeResults(results) {
  const summary = { total: results.length, completed: 0, skipped: 0, failed: 0 };

  for (const result of results) {
    if (result.outcome === "COMPLETED") summary.completed += 1;
    if (result.outcome === "SKIPPED") summary.skipped += 1;
    if (result.outcome === "FAILED") summary.failed += 1;
  }

  return summary;
}

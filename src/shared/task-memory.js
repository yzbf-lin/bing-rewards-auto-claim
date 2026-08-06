const MAX_TASK_RECORDS = 200;
const TRACKING_PARAMETERS = new Set(["form", "ocid", "publ", "crea", "filters"]);

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

export function taskMemoryKey(entry) {
  return [
    normalize(entry.source || entry.section),
    normalize(entry.kind),
    normalize(entry.title),
    normalizedUrl(entry.url),
  ].join("|");
}

export function rememberTask(memory, {
  entry,
  decision,
  outcome,
  observedAt,
  dateKey,
}) {
  const key = taskMemoryKey(entry);
  const previous = memory?.[key] ?? {};
  const next = {
    ...(memory ?? {}),
    [key]: {
      key,
      section: entry.section,
      title: entry.title,
      kind: entry.kind,
      url: entry.url,
      rewardPoints: decision.rewardPoints,
      recognitionDecision: decision.decision,
      recognitionReason: decision.reason,
      lastOutcome: outcome,
      lastSeenAt: observedAt,
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

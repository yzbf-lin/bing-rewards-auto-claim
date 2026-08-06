const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const RUN_HOUR = 9;

function shiftedBeijingDate(date) {
  return new Date(date.getTime() + BEIJING_OFFSET_MS);
}

export function beijingDateKey(date = new Date()) {
  return shiftedBeijingDate(date).toISOString().slice(0, 10);
}

export function nextBeijingRunAt(now = new Date()) {
  const shifted = shiftedBeijingDate(now);
  const target = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      RUN_HOUR,
    ) - BEIJING_OFFSET_MS,
  );

  if (target.getTime() > now.getTime()) {
    return target;
  }

  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() + 1,
      RUN_HOUR,
    ) - BEIJING_OFFSET_MS,
  );
}

export function shouldCatchUp({ now = new Date(), lastAutomaticDate }) {
  const shifted = shiftedBeijingDate(now);
  const afterDeadline = shifted.getUTCHours() >= RUN_HOUR;
  return afterDeadline && lastAutomaticDate !== beijingDateKey(now);
}

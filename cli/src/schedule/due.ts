import type { ScheduleRecurrence } from '@browser-agent/shared';

function atTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// Each entry in `times` is its own independent trigger — this finds the
// latest one on `date` that has already passed `now` (a date fully in the
// past has all its times count; "today" only counts times already reached).
function latestSlotOnOrBefore(date: Date, times: string[], now: Date): Date | null {
  let best: Date | null = null;
  for (const time of times) {
    const slot = atTime(date, time);
    if (slot <= now && (!best || slot > best)) best = slot;
  }
  return best;
}

// Returns the single most recent due slot, or null if nothing is due yet.
// Scanning backward from today (weekly) or checking the one date (once)
// means a daemon that was asleep through several missed occurrences — be it
// several days or several times within one day — fires once for the most
// recent one, not once per missed occurrence: no catch-up spam.
export function computeDueSlot(recurrence: ScheduleRecurrence, now: Date = new Date()): Date | null {
  if (recurrence.type === 'once') {
    return latestSlotOnOrBefore(new Date(`${recurrence.date}T00:00:00`), recurrence.times, now);
  }

  // <= 7, not < 7: when today is the only matching weekday and none of its
  // times have happened yet, the previous occurrence is exactly 7 days back
  // — stopping at 6 would miss it and wrongly report "not due".
  for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
    const candidateDate = new Date(now);
    candidateDate.setDate(candidateDate.getDate() - daysAgo);
    if (!recurrence.weekdays.includes(candidateDate.getDay())) continue;

    const slot = latestSlotOnOrBefore(candidateDate, recurrence.times, now);
    if (slot) return slot;
  }

  return null;
}

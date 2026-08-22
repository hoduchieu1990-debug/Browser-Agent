import type { ScheduleRecurrence } from '@browser-agent/shared';

function atTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// Returns the single most recent due slot, or null if nothing is due yet.
// For `weekly`, scanning backward from today means a daemon that was asleep
// through several missed occurrences fires once for the most recent one,
// not once per missed occurrence — no catch-up spam.
export function computeDueSlot(recurrence: ScheduleRecurrence, now: Date = new Date()): Date | null {
  if (recurrence.type === 'once') {
    const slot = new Date(`${recurrence.date}T${recurrence.time}:00`);
    return slot <= now ? slot : null;
  }

  // <= 7, not < 7: when today is the only matching weekday and its time
  // hasn't happened yet, the previous occurrence is exactly 7 days back —
  // stopping at 6 would miss it and wrongly report "not due".
  for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
    const candidateDate = new Date(now);
    candidateDate.setDate(candidateDate.getDate() - daysAgo);
    if (!recurrence.weekdays.includes(candidateDate.getDay())) continue;

    const slot = atTime(candidateDate, recurrence.time);
    if (slot <= now) return slot;
  }

  return null;
}

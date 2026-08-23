const assert = require('assert');
const { computeDueSlot } = require('../cli/dist/schedule/due.js');

// Wednesday, 2026-08-19 10:00 local — a fixed "now" so every case below is
// deterministic regardless of when this actually runs.
const NOW = new Date(2026, 7, 19, 10, 0, 0); // month is 0-based: 7 = August

function check(label, actual, expected) {
  const actualIso = actual ? actual.toISOString() : null;
  const expectedIso = expected ? expected.toISOString() : null;
  assert.strictEqual(actualIso, expectedIso, `${label}: expected ${expectedIso}, got ${actualIso}`);
  console.log(`[ok] ${label}`);
}

(() => {
  // once: time already passed today -> due, slot is that exact moment
  check(
    'once, earlier today -> due',
    computeDueSlot({ type: 'once', date: '2026-08-19', times: ['08:00'] }, NOW),
    new Date(2026, 7, 19, 8, 0, 0),
  );

  // once: time later today -> not due yet
  check('once, later today -> not due', computeDueSlot({ type: 'once', date: '2026-08-19', times: ['12:00'] }, NOW), null);

  // once: a future date entirely -> not due
  check('once, future date -> not due', computeDueSlot({ type: 'once', date: '2026-08-20', times: ['08:00'] }, NOW), null);

  // once: a past date -> due (still fires even if "late")
  check(
    'once, past date -> due',
    computeDueSlot({ type: 'once', date: '2026-08-01', times: ['08:00'] }, NOW),
    new Date(2026, 7, 1, 8, 0, 0),
  );

  // once: multiple independent times the same day -> the latest one that has passed
  check(
    'once, multiple times today, 10:00 now -> latest passed (08:00, not 12:00/15:00)',
    computeDueSlot({ type: 'once', date: '2026-08-19', times: ['08:00', '12:00', '15:00'] }, NOW),
    new Date(2026, 7, 19, 8, 0, 0),
  );

  // weekly: today is Wednesday (day 3), scheduled for today, time already passed -> due today
  check(
    'weekly, today matches and time passed -> due today',
    computeDueSlot({ type: 'weekly', weekdays: [3], times: ['08:00'] }, NOW),
    new Date(2026, 7, 19, 8, 0, 0),
  );

  // weekly: today matches but the time hasn't happened yet -> falls back to last week's slot
  check(
    'weekly, today matches but time not reached yet -> most recent PAST slot',
    computeDueSlot({ type: 'weekly', weekdays: [3], times: ['12:00'] }, NOW),
    new Date(2026, 7, 12, 12, 0, 0),
  );

  // weekly: several independent times a day — each is its own trigger, so the
  // one already fired (08:00, claimed via state.lastRunAt in the real runner)
  // must not block a LATER same-day time from being seen as newly due.
  check(
    'weekly, multiple times today -> the latest one that has passed (not the earliest)',
    computeDueSlot({ type: 'weekly', weekdays: [3], times: ['08:00', '09:30'] }, NOW),
    new Date(2026, 7, 19, 9, 30, 0),
  );

  // weekly: daemon asleep through a couple of missed Mondays -> fires once, for
  // the MOST RECENT missed occurrence, not once per missed week (no backlog spam)
  check(
    'weekly, several missed Mondays -> most recent one only',
    computeDueSlot({ type: 'weekly', weekdays: [1], times: ['08:00'] }, NOW),
    new Date(2026, 7, 17, 8, 0, 0), // the Monday just before NOW, not any earlier one
  );

  // weekly: no configured weekday has occurred within the lookback window relative
  // to "now" in a way that's still pending -> not due (every candidate already handled)
  check(
    'weekly, empty weekdays -> never due',
    computeDueSlot({ type: 'weekly', weekdays: [], times: ['08:00'] }, NOW),
    null,
  );

  // weekly: a day that matches but has no configured times -> never due
  check(
    'weekly, empty times -> never due',
    computeDueSlot({ type: 'weekly', weekdays: [3], times: [] }, NOW),
    null,
  );

  console.log('PASS: schedule-due-check');
})();

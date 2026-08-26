/**
 * The TypeScript shape an `interval` column surfaces as (D4) — a
 * structured value, not `unknown`. Every field is optional and defaults to
 * `0` (D8's `col?: T` convention), so `{}` is the zero interval and a
 * caller only spells out the axes they actually use.
 *
 * **Why these seven fields, and why they're safe.** Postgres stores an
 * interval as exactly three independent values — `months`, `days`,
 * `microseconds` (`src/backend/utils/adt/timestamp.c`'s `Interval`
 * struct; `years`/`weeks` are pure input/output sugar, never stored on
 * their own). Critically, **months and days do not convert into one
 * another** — a month is 28–31 days depending on which month, so there is
 * no fixed "days per month" this type could use, and it never tries to
 * compute one. Every field below maps onto exactly one of those three
 * Postgres axes, additively, and never crosses an axis boundary:
 *
 * - `years`, `months` → Postgres's `months` axis only
 *   (`totalMonths = years * 12 + months`). This is exactly how Postgres's
 *   own "postgres"-style output already splits one stored integer into
 *   "N years M mons" for display (`years = totalMonths / 12`,
 *   `months = totalMonths % 12`) — parsing that text back (task 3.8) is
 *   the reverse of the same arithmetic, so this direction is lossless.
 * - `days` → Postgres's `days` axis only, unmodified. There is no `weeks`
 *   field: Postgres never *outputs* weeks (`interval '2 weeks'` is input
 *   sugar for `days: 14`; nothing round-trips through a stored "weeks"
 *   value), so a `weeks` field here would be write-only and is omitted.
 * - `hours`, `minutes`, `seconds`, `microseconds` → Postgres's
 *   `microseconds` axis only (`totalMicroseconds = (((hours * 60 +
 *   minutes) * 60 + seconds) * 1_000_000) + microseconds`). Postgres's own
 *   text output for this axis is a single `HH:MM:SS.ffffff` field with up
 *   to *microsecond* precision — stopping at `milliseconds` here would
 *   silently drop the last three digits on round-trip, which is exactly
 *   the silent-precision-loss failure mode this group's house rule
 *   (fail-fast, D3) rejects elsewhere; `microseconds` alone carries the
 *   full sub-second remainder instead, so no separate `milliseconds`
 *   field is needed (and none is offered, to avoid two fields that could
 *   double-count the same microseconds).
 *
 * None of the three axes is ever combined with either of the other two —
 * that is the one operation Postgres itself cannot do losslessly, and
 * this type structurally cannot express it either (there is no single
 * "total days" or "total seconds" field spanning axes). Building/reading
 * a value is a pure function per axis (task 3.8), never a type-level
 * computation, per this group's "no distributive tricks" guidance.
 */
export type IntervalValue = {
	readonly years?: number;
	readonly months?: number;
	readonly days?: number;
	readonly hours?: number;
	readonly minutes?: number;
	readonly seconds?: number;
	readonly microseconds?: number;
};

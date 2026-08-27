import type { ColumnMeta, NumericMode } from "./column-builder";
import type {
	DefaultBigintMode,
	DefaultNumericMode,
} from "./numeric-mode-defaults";

/**
 * The structured TypeScript value an `interval` column reads back as (D4)
 * — a structured value, not `unknown`. Every field is required, never
 * optional: a value read back from the database is always normalized (the
 * parser in `@hejbro/query` fills every axis, `0` for one the source text
 * didn't mention), so two intervals that are the same value compare equal
 * regardless of which axes their source text happened to spell out.
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
 *   (`totalMonths = years * 12 + months`).
 * - `days` → Postgres's `days` axis only, unmodified. There is no `weeks`
 *   field: Postgres never *outputs* weeks.
 * - `hours`, `minutes`, `seconds`, `microseconds` → Postgres's
 *   `microseconds` axis only. Postgres's own text output for this axis
 *   carries up to *microsecond* precision — stopping at `milliseconds`
 *   here would silently drop the last three digits on round-trip, the
 *   silent-precision-loss failure mode this group's house rule (D3)
 *   rejects elsewhere; `microseconds` alone carries the full sub-second
 *   remainder, so no separate `milliseconds` field exists.
 *
 * The value's own construction (parsing driver text, normalizing) is
 * `@hejbro/query`'s pure-function job (`parseInterval`), not this type's —
 * this is the type only, living in core because D1's declared-column →
 * TypeScript-type mapping is a property of the declaration DSL, and
 * `.$type<T>()`'s narrowing constraint (`column-builder.ts`) needs to see
 * this type without core importing `@hejbro/query`.
 */
export type IntervalValue = {
	readonly years: number;
	readonly months: number;
	readonly days: number;
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
	readonly microseconds: number;
};

/**
 * `bigint({mode})`/`numeric({mode})`'s resolved `NumericMode` (task 3.4) →
 * the TS type it reads back as (D3, mirrors Drizzle). Every member of
 * `NumericMode` has its own branch ending in `never` — not a `string`/wide
 * fallback — so a fourth mode added to `NumericMode` later fails this
 * file's own `check-types` instead of silently reading back as `string`.
 */
type NumericModeTsType<TMode extends NumericMode> = TMode extends "number"
	? number
	: TMode extends "bigint"
		? bigint
		: TMode extends "string"
			? string
			: never;

/**
 * The *base* scalar TS type for one declared type name — deliberately
 * brand-agnostic (never reads `TMeta["jsonType"]`; `json`/`jsonb` are
 * always `unknown` here). `.$type<T>()`'s own narrowing constraint in
 * `column-builder.ts` is `T extends BaseTsType<TMeta>`, so a base mapping
 * that consulted the brand it's constraining would depend on the very
 * thing being established — this keeps that dependency one-directional.
 * A flat lookup, not a distributive conditional over a naked union (D1's
 * "no distributive tricks" guidance) — every branch tests one concrete
 * `TTypeName` literal.
 *
 * The {@link DefaultBigintMode}/{@link DefaultNumericMode} fallbacks below
 * (when `TMeta` carries no `mode`) derive structurally from
 * `numeric-mode-defaults.ts`'s own constants (#310) — the same module
 * `column-builder-factories.ts`'s `bigint()`/`numeric()` read their runtime
 * default from, so the type-level fallback and the runtime default can
 * never drift apart. That module lives outside
 * `column-builder-factories.ts`'s own export surface specifically so
 * `column-builder.test.ts`'s "every factory's mode is accounted for (C19)"
 * exhaustiveness check (which sweeps that file's exports as the known
 * factory list) never has to see it — **never "fix" a future drift risk by
 * weakening C19's own exhaustiveness assertion instead**; that check is
 * what caught the original hand-spelled-literal drift risk this comment
 * used to describe.
 */
type BaseScalarTsType<TTypeName, TMeta extends ColumnMeta> = TTypeName extends
	| "uuid"
	| "text"
	| "varchar"
	| "char"
	| "enum"
	| "inet"
	| "cidr"
	| "macaddr"
	? string
	: TTypeName extends "boolean"
		? boolean
		: TTypeName extends
					| "smallint"
					| "integer"
					| "real"
					| "double precision"
					| "serial"
					| "smallserial"
			? number
			: TTypeName extends "bigint"
				? NumericModeTsType<
						TMeta extends { readonly mode: infer TMode extends NumericMode }
							? TMode
							: DefaultBigintMode
					>
				: TTypeName extends "numeric"
					? NumericModeTsType<
							TMeta extends {
								readonly mode: infer TMode extends NumericMode;
							}
								? TMode
								: DefaultNumericMode
						>
					: TTypeName extends "bigserial"
						? // not user-configurable (task 3.4 gives serial/smallserial/
							// bigserial no mode field, D66) -- 'bigint' is the one mode
							// that can never silently lose precision for a 64-bit value,
							// so that's the fixed (not defaulted-then-overridable) choice.
							bigint
						: TTypeName extends "date" | "timestamp" | "timestamptz"
							? Date
							: // node-postgres has no parser for time (oid 1083) / timetz
								// (oid 1266) -- they come back as raw text (e.g.
								// "12:34:56"), never a Date. Mapping them to Date would be a
								// type that lies about what the runtime hands back.
								TTypeName extends "time" | "timetz"
								? string
								: TTypeName extends "interval"
									? IntervalValue
									: TTypeName extends "json" | "jsonb"
										? unknown
										: TTypeName extends "bytea"
											? // Uint8Array, not Node's Buffer: this maps into every
												// consumer's public result type, browser/edge
												// included. Buffer extends Uint8Array, so a Node
												// driver returning an actual Buffer still satisfies
												// this contract.
												Uint8Array
											: // "array" (a nested array's own inner element, task
												// 3.15's own known gap: only one level of `element` is
												// ever recorded) or an unrecognized type name.
												unknown;

/**
 * The *base* TypeScript type a declared column reads back as, before any
 * `.$type<T>()` brand narrows it (D1/D3/D5) — the declared type name
 * decides the shape, `bigint`/`numeric`'s resolved mode narrows it
 * further, and `.array()` (task 3.15) wraps the *element's* base mapping
 * (mode read off the same `TMeta`, since `ArrayCarriedFlags` already
 * hoists it there) in a `ReadonlyArray` — with `| null` on the element
 * (#349): Postgres arrays are element-nullable always (no DDL can forbid
 * it; `notNull` binds to the array itself), and the query-execution spec
 * already promises "every `NULL` element is `null`" on arrival, so an
 * element type without `null` was the type lying about specified
 * behavior — except under `.notNullElements()` (add-array-ergonomics),
 * which drops the `| null` because the declaration backs the claim with
 * a real CHECK (`table()` derives it into the declaration's own checks
 * list), so the type is never lying there either. Column-level
 * nullability from `notNull` is still select-result inference's job
 * (task 3.10), not this one's — two
 * independent axes — and a `.$type<T>()` brand narrowing this
 * further is `@hejbro/query`'s `column-map.ts`'s job, not this one's
 * either (this file never reads `TMeta["jsonType"]`, see
 * {@link BaseScalarTsType}).
 */
export type BaseTsType<TMeta extends ColumnMeta> = TMeta extends {
	readonly typeName: "array";
}
	? TMeta extends { readonly notNullElements: true }
		? ReadonlyArray<
				BaseScalarTsType<
					TMeta extends { readonly element?: infer TElement }
						? TElement
						: never,
					TMeta
				>
			>
		: ReadonlyArray<BaseScalarTsType<
				TMeta extends { readonly element?: infer TElement } ? TElement : never,
				TMeta
			> | null>
	: BaseScalarTsType<
			TMeta extends { readonly typeName: infer TTypeName } ? TTypeName : never,
			TMeta
		>;

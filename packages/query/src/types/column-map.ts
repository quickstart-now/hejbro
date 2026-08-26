import type { ColumnBuilder, NumericMode } from "@hejbro/core";
import type { IntervalValue } from "./interval";

/**
 * Extracts a {@link ColumnBuilder}'s `TMeta` type parameter, structurally —
 * no new core export needed beyond the already-public `ColumnBuilder`
 * (mirrors `dsl/table.ts`'s own `Table<infer TColumns>` extraction, task
 * 3.3): `infer` never requires naming core's internal `ColumnMeta`
 * constraint, only substituting whatever concrete meta object a call site
 * actually produced.
 */
type BuilderMeta<TBuilder extends ColumnBuilder> =
	TBuilder extends ColumnBuilder<infer _TFamily, infer TMeta> ? TMeta : never;

/**
 * `bigint({mode})`/`numeric({mode})`'s resolved `NumericMode` (task 3.4) →
 * the TS type it reads back as (D3, mirrors Drizzle). `TMode` is
 * constrained to the real, imported `NumericMode` (not duplicated inline)
 * and every one of its three members has its own branch ending in `never`
 * — not a `string`/wide fallback — so a fourth mode added to core later
 * fails this file's own `check-types` instead of silently reading back as
 * `string`, the exact single-second-place-for-a-decision drift this group
 * has removed everywhere else (mode's own resolved-at-the-factory rule,
 * D1's phantom-brand fix, …).
 */
type NumericModeTsType<TMode extends NumericMode> = TMode extends "number"
	? number
	: TMode extends "bigint"
		? bigint
		: TMode extends "string"
			? string
			: never;

/**
 * The scalar TS type for one declared type name, given the full `TMeta`
 * it's read from (needed for `bigint`/`numeric`'s `mode` and `jsonb`'s
 * `jsonType` brand, task 3.4/3.5). A flat lookup, not a distributive
 * conditional over a naked union (D1's "no distributive tricks" guidance)
 * — every branch tests one concrete `TTypeName` literal.
 */
type ScalarTsType<TTypeName, TMeta = unknown> = TTypeName extends
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
							: "bigint"
					>
				: TTypeName extends "numeric"
					? NumericModeTsType<
							TMeta extends { readonly mode: infer TMode extends NumericMode }
								? TMode
								: "string"
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
								// (oid 1266) -- they come back as raw text (e.g. "12:34:56"),
								// never a Date. Mapping them to Date would be exactly the
								// runtime-lying-about-nullability class of bug this group
								// keeps removing elsewhere (task 3.15's array()/3.16's
								// primaryKey()).
								TTypeName extends "time" | "timetz"
								? string
								: TTypeName extends "interval"
									? IntervalValue
									: TTypeName extends "json"
										? // D5: only jsonb opts into a $type brand; json always stays
											// unknown, brand or not.
											unknown
										: TTypeName extends "jsonb"
											? TMeta extends { readonly jsonType: infer TJson }
												? TJson
												: unknown
											: TTypeName extends "bytea"
												? // Buffer is Node-only; @hejbro/query is core-grade pure and
													// this maps into every consumer's public result type, browser/
													// edge included. Uint8Array is the platform-neutral supertype --
													// Buffer extends Uint8Array, so a Node driver returning an actual
													// Buffer still satisfies this contract; callers narrow if they want.
													Uint8Array
												: // "array" (a nested array's own inner element, task
													// 3.15's own known gap: only one level of `element` is
													// ever recorded) or an unrecognized type name.
													unknown;

/**
 * The TypeScript type a declared column reads back as (D1/D3/D5) — the
 * declared type name decides the shape, `bigint`/`numeric`'s resolved mode
 * and `jsonb`'s `$type` brand narrow it further, and `.array()` (task
 * 3.15) wraps the *element's* mapping (mode/brand read off the same
 * `TMeta`, since `ArrayCarriedFlags` already hoists them there) in a
 * `ReadonlyArray`. This maps the scalar type only — nullability from
 * `notNull` is select-result inference's job (task 3.10), not this one's.
 */
export type ColumnTsType<TBuilder extends ColumnBuilder> =
	BuilderMeta<TBuilder> extends infer TMeta
		? TMeta extends { readonly typeName: "array" }
			? ReadonlyArray<
					ScalarTsType<
						TMeta extends { readonly element?: infer TElement }
							? TElement
							: never,
						TMeta
					>
				>
			: ScalarTsType<
					TMeta extends { readonly typeName: infer TTypeName }
						? TTypeName
						: never,
					TMeta
				>
		: never;

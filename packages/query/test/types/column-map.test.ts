import {
	bigint,
	type bigserial,
	type boolean,
	type bytea,
	type char,
	type cidr,
	type date,
	type doublePrecision,
	type inet,
	type integer,
	type interval,
	type json,
	jsonb,
	type macaddr,
	type numeric,
	type real,
	type serial,
	type smallint,
	type smallserial,
	text,
	type time,
	type timestamp,
	type timestamptz,
	type timetz,
	type uuid,
	type varchar,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { ColumnTsType } from "../../src/types/column-map";
import type { IntervalValue } from "../../src/types/interval";

describe("column-map (D1/D3/D5, task 3.6)", () => {
	it("each declared type name maps to its TS type", () => {
		// text-like.
		expectTypeOf<
			ColumnTsType<ReturnType<typeof uuid>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof text>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof varchar>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof char>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof inet>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof cidr>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof macaddr>>
		>().toEqualTypeOf<string>();

		// boolean.
		expectTypeOf<
			ColumnTsType<ReturnType<typeof boolean>>
		>().toEqualTypeOf<boolean>();

		// plain numeric-family (never overflows number, no mode).
		expectTypeOf<
			ColumnTsType<ReturnType<typeof smallint>>
		>().toEqualTypeOf<number>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof integer>>
		>().toEqualTypeOf<number>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof real>>
		>().toEqualTypeOf<number>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof doublePrecision>>
		>().toEqualTypeOf<number>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof serial>>
		>().toEqualTypeOf<number>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof smallserial>>
		>().toEqualTypeOf<number>();
		// bigserial has no mode field (task 3.4) -- fixed to bigint, the
		// mode that can't silently lose precision for a 64-bit value.
		expectTypeOf<
			ColumnTsType<ReturnType<typeof bigserial>>
		>().toEqualTypeOf<bigint>();

		// bigint/numeric: mode consumption (task 3.4's own field, read
		// here). bigint/numeric are generic over TMode, so ReturnType needs
		// an explicit instantiation -- a bare `ReturnType<typeof bigint>`
		// resolves TMode from its constraint, not its default, and is not
		// what any real call site produces.
		expectTypeOf<
			ColumnTsType<ReturnType<typeof bigint<"bigint">>>
		>().toEqualTypeOf<bigint>(); // default
		expectTypeOf<
			ColumnTsType<ReturnType<typeof numeric<"string">>>
		>().toEqualTypeOf<string>(); // default
		expectTypeOf<
			ColumnTsType<ReturnType<typeof bigint<"number">>>
		>().toEqualTypeOf<number>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof bigint<"string">>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof numeric<"number">>>
		>().toEqualTypeOf<number>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof numeric<"bigint">>>
		>().toEqualTypeOf<bigint>();

		// date/time. Only date/timestamp/timestamptz parse to a real Date --
		// node-postgres has no parser for time (oid 1083) / timetz (oid
		// 1266), which come back as raw text ("12:34:56"); mapping them to
		// Date would be a type that lies about what the runtime hands back.
		expectTypeOf<ColumnTsType<ReturnType<typeof date>>>().toEqualTypeOf<Date>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof time>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof timetz>>
		>().toEqualTypeOf<string>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof timestamp>>
		>().toEqualTypeOf<Date>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof timestamptz>>
		>().toEqualTypeOf<Date>();

		// interval: structured value (D4/task 3.7), not unknown.
		expectTypeOf<
			ColumnTsType<ReturnType<typeof interval>>
		>().toEqualTypeOf<IntervalValue>();

		// json/jsonb: json always unknown; jsonb unknown unless branded
		// (task 3.5's jsonType consumption, read here) -- the positive/
		// negative contrast this whole distinction turns on (R3).
		expectTypeOf<
			ColumnTsType<ReturnType<typeof json>>
		>().toEqualTypeOf<unknown>();
		expectTypeOf<
			ColumnTsType<ReturnType<typeof jsonb>>
		>().toEqualTypeOf<unknown>();
		type Payload = { readonly kind: "widget"; readonly count: number };
		const brandedJsonb = jsonb().$type<Payload>();
		expectTypeOf<ColumnTsType<typeof brandedJsonb>>().toEqualTypeOf<Payload>();

		// bytea: the platform-neutral Uint8Array, not Node's Buffer (R2) --
		// @hejbro/query is core-grade pure, and this maps into every
		// consumer's public result type, browser/edge included.
		expectTypeOf<
			ColumnTsType<ReturnType<typeof bytea>>
		>().toEqualTypeOf<Uint8Array>();
	});

	it("array() (task 3.15) maps through the element, mode/brand included", () => {
		const textArray = text().array();
		expectTypeOf<ColumnTsType<typeof textArray>>().toEqualTypeOf<
			ReadonlyArray<string>
		>();

		const numberModeBigintArray = bigint<"number">().array();
		expectTypeOf<ColumnTsType<typeof numberModeBigintArray>>().toEqualTypeOf<
			ReadonlyArray<number>
		>();

		type Payload = { readonly kind: "widget" };
		const brandedJsonbArray = jsonb().$type<Payload>().array();
		expectTypeOf<ColumnTsType<typeof brandedJsonbArray>>().toEqualTypeOf<
			ReadonlyArray<Payload>
		>();
	});
});

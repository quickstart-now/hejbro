import { describe, expect, it } from "vitest";
import { sqlTypeFamilies } from "../../src/expr/type-family";
import {
	bigint,
	boolean,
	bytea,
	defineFunction,
	integer,
	schema,
	sql,
	text,
	timestamptz,
	uuid,
} from "../../src/index";
import { isRefusedReturnFamily } from "../../src/plpgsql/return-family";

const app = schema("app");

/** The `code` of the HejbroError `run` throws — the codes are the stable contract, the prose is not. */
const codeOf = (run: () => unknown): string => {
	try {
		run();
	} catch (error) {
		return (error as { code: string }).code;
	}
	return "(did not throw)";
};

describe("scalar return family cross-check (#478)", () => {
	it("a uuid expression returned as integer fails with scalar-return-family-mismatch", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"owner_of",
					{ args: { rowId: uuid() }, returns: integer() },
					(ctx, args) => {
						ctx.return(args.rowId);
					},
				),
			),
		).toBe("scalar-return-family-mismatch");
	});

	it("the mismatch names both families in its message", () => {
		expect(() =>
			defineFunction(
				app,
				"owner_of_msg",
				{ args: { rowId: uuid() }, returns: integer() },
				(ctx, args) => {
					ctx.return(args.rowId);
				},
			),
		).toThrowError(/uuid expression.*numeric type.*Next:/s);
	});

	it("a numeric expression returned as a datetime is accepted", () => {
		// 20260101 is a valid ISO date — the pair is value-dependent, and
		// hejbro does not refuse what Postgres might accept.
		const fn = defineFunction(
			app,
			"epoch_guess",
			{ args: { n: integer() }, returns: timestamptz() },
			(ctx, args) => {
				ctx.return(args.n);
			},
		);
		expect(fn.declarationKind).toBe("function");
	});

	it("a sql fragment return is never family-checked", () => {
		const fn = defineFunction(
			app,
			"fragment_return",
			{ returns: integer() },
			(ctx) => {
				ctx.return(sql`(select count(*) from "app"."rows")`);
			},
		);
		expect(fn.declarationKind).toBe("function");
	});

	it("a same-family pair is accepted", () => {
		const fn = defineFunction(
			app,
			"widen",
			{ args: { n: integer() }, returns: bigint() },
			(ctx, args) => {
				ctx.return(args.n);
			},
		);
		expect(fn.declarationKind).toBe("function");
	});

	it("a text-returning declaration accepts every family", () => {
		expect(
			sqlTypeFamilies.filter((family) => isRefusedReturnFamily("text", family)),
		).toHaveLength(0);
		const fn = defineFunction(
			app,
			"flag_text",
			{ args: { enabled: boolean() }, returns: text() },
			(ctx, args) => {
				ctx.return(args.enabled);
			},
		);
		expect(fn.declarationKind).toBe("function");
	});

	it("a bytea-returning declaration accepts every family", () => {
		expect(
			sqlTypeFamilies.filter((family) =>
				isRefusedReturnFamily("bytea", family),
			),
		).toHaveLength(0);
		const fn = defineFunction(
			app,
			"raw_of",
			{ args: { rowId: uuid() }, returns: bytea() },
			(ctx, args) => {
				ctx.return(args.rowId);
			},
		);
		expect(fn.declarationKind).toBe("function");
	});
});

describe("the refusal table holds exactly the measured pairs", () => {
	it("pins the measured verdict for spot pairs, both directions", () => {
		expect(isRefusedReturnFamily("numeric", "uuid")).toBe(true);
		expect(isRefusedReturnFamily("uuid", "numeric")).toBe(true);
		// value-dependent pairs, measured accepted: 20260101 is a date,
		// {} is an empty array literal, a jsonb payload can be a number.
		expect(isRefusedReturnFamily("datetime", "numeric")).toBe(false);
		expect(isRefusedReturnFamily("array", "json")).toBe(false);
		expect(isRefusedReturnFamily("numeric", "json")).toBe(false);
		// asymmetry is real: a date can print as a macaddr, never the reverse.
		expect(isRefusedReturnFamily("net", "datetime")).toBe(false);
		expect(isRefusedReturnFamily("datetime", "net")).toBe(true);
	});

	it("holds 49 refused pairs, none same-family, none involving unknown", () => {
		const refusedPairs = sqlTypeFamilies.flatMap((declared) =>
			sqlTypeFamilies
				.filter((returned) => isRefusedReturnFamily(declared, returned))
				.map((returned) => `${declared}<-${returned}`),
		);
		expect(refusedPairs).toHaveLength(49);
		expect(
			refusedPairs.filter((pair) => pair.includes("unknown")),
		).toHaveLength(0);
		expect(
			sqlTypeFamilies.filter((family) => isRefusedReturnFamily(family, family)),
		).toHaveLength(0);
	});
});

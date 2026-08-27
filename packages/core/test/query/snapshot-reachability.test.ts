import { describe, expect, it } from "vitest";
import { decodeExprNode, encodeExprNode } from "../../src/expr/codec";
import type { IntervalValue } from "../../src/index";
import { bigint, eq, interval, schema, table, uuid } from "../../src/index";

/**
 * Pins that #322's new AST literal kinds (`bigint`/`interval`/`array` text
 * literals, task 2.3, constructed only by `query/column-value.ts`'s
 * `liftColumnValue`) are unreachable from every declaration-time path
 * `codec.ts` encodes into a snapshot — column `.default()`
 * (`table-kind.ts`), index column expressions and partial predicates,
 * CHECK constraints, RLS `using`/`withCheck` (`policy-kind.ts`), and a
 * view's own `SelectNode` (`view-kind.ts`) all resolve their literal
 * operands through `eq`/the other comparison operators
 * (`expr/operators.ts`), which — like `.default()` — type-gates through
 * `LiftableFor<TFamily>` (`expr/type-family.ts`). This group's changes
 * never touch `LiftableFor` (`git diff` on that file is empty); the only
 * new, wider type is `mutate.ts`'s `MutationValue`, a write-path-only
 * type never shared with `.default()`/the comparison operators. Snapshot
 * format v5 (`snapshot.ts`) therefore stays single-grammar: the
 * declaration path can't construct the new literal kinds, so it can never
 * carry one into a persisted snapshot, and no format-version bump is
 * needed for this change.
 */
const app = schema("app");
const t = table(app, "t", {
	id: uuid().primaryKey(),
	amount: bigint(),
	duration: interval(),
});

describe("snapshot-reachable paths still reject bigint/interval (task 2.3, #322 -- no snapshot format hazard)", () => {
	it(".default() still type-gates through LiftableFor, unaffected by MutationValue's write-side widening", () => {
		// Routed through variables (not fresh object/primitive literals) so
		// each rejection can only be assignability against the contract
		// itself, never excess-property checking reacting to literal
		// freshness. Both calls are wrapped in `expect(...).toThrow()`:
		// bypassing the type gate still reaches `liftLiteral` at runtime,
		// which is genuinely unchanged (reverted to its pre-#322 baseline)
		// and still rejects both shapes -- `bigint` as unsupported
		// (`invalid-literal`), a structured interval as ambiguous
		// (`ambiguous-literal`) -- so neither call may throw uncaught.
		const bigintValue: bigint = 1n;
		expect(() => {
			// @ts-expect-error a bigint default -- `.default()`'s signature is
			// `LiftableFor<TFamily> | Expr<TFamily> | Expr<"unknown">`
			// (column-builder.ts, untouched by this group), never
			// `MutationValue`.
			bigint().default(bigintValue);
		}).toThrow(expect.objectContaining({ code: "invalid-literal" }));

		const intervalValue: IntervalValue = {
			years: 0,
			months: 0,
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
			microseconds: 0,
		};
		expect(() => {
			// @ts-expect-error a structured IntervalValue default -- same
			// gate; `LiftableFor<"interval">` is `never` (type-family.ts's
			// own `LiftableFor`, no branch for "interval" at all).
			interval().default(intervalValue);
		}).toThrow(expect.objectContaining({ code: "ambiguous-literal" }));
	});

	it("eq()/comparison operators still type-gate through LiftableFor, unaffected by MutationValue's write-side widening -- the one gate CHECK/index-predicate/RLS/view-query literals all share", () => {
		// snapshot format v5 stays single-grammar because the declaration
		// path can't construct the new literal kinds -- this is that gate,
		// exercised through the exact same operator CHECK constraints,
		// partial index predicates, RLS policies, and view queries all
		// build their literal operands with.
		const bigintValue: bigint = 1n;
		expect(() => {
			// @ts-expect-error comparing a bigint column against a raw bigint --
			// `Operand<TFamily>` (operators.ts) is also `LiftableFor<TFamily>`-
			// based, the same untouched gate `.default()` uses.
			eq(t.amount, bigintValue);
		}).toThrow(expect.objectContaining({ code: "invalid-literal" }));
	});

	// The "declaration path can't construct these kinds" argument above is
	// about ordinary DSL usage. These two tests pin the boundary itself,
	// one layer down: `codec.ts`'s encode/decode maps are keyed by
	// `SnapshotLiteralKind` (`Exclude<..., "bigint" | "interval" | "array">`,
	// codec.ts), not the full `LiteralNode` union, so even a hand-built node
	// carrying one of the three new kinds (bypassing the DSL entirely) is
	// rejected rather than silently encoded/decoded as a legitimate v5
	// snapshot node. (F) settled that these three carry canonical text for
	// the query-compile pipeline only, never that they join the snapshot
	// grammar -- that's a separate, owner-gated `HEJBRO_SNAPSHOT_VERSION`
	// bump (D87), not something this change does.
	it("encoding a hand-built bigint/interval/array literal node throws non-snapshot-literal, never silently encodes it", () => {
		const bigintNode = {
			nodeKind: "literal" as const,
			literal: { literalKind: "bigint" as const, text: "1" },
		};
		expect(() => encodeExprNode(bigintNode)).toThrowError(
			expect.objectContaining({ code: "non-snapshot-literal" }),
		);

		const intervalNode = {
			nodeKind: "literal" as const,
			literal: { literalKind: "interval" as const, text: "0 years" },
		};
		expect(() => encodeExprNode(intervalNode)).toThrowError(
			expect.objectContaining({ code: "non-snapshot-literal" }),
		);

		const arrayNode = {
			nodeKind: "literal" as const,
			literal: { literalKind: "array" as const, text: "{1}" },
		};
		expect(() => encodeExprNode(arrayNode)).toThrowError(
			expect.objectContaining({ code: "non-snapshot-literal" }),
		);
	});

	it("decoding a hand-written v5 snapshot node naming bigint/interval/array falls through to the EXISTING malformed-snapshot-node rejection, never a new decode path", () => {
		// A snapshot file some future (or hand-edited) build wrote with one
		// of these three kinds already in it -- `SnapshotLiteralKind` narrows
		// `decodeLiteralHandlers`'s own keys, so `isKnownLiteralKind` (a
		// runtime `value in decodeLiteralHandlers` membership check) sees no
		// entry for "bigint" and falls through to the same
		// `unknownDiscriminator` every other unrecognized `literalKind`
		// already hits -- no new error code, no new message.
		const handWrittenNode = {
			nodeKind: "literal",
			literal: { literalKind: "bigint", text: "1" },
		};
		expect(() => decodeExprNode(handWrittenNode)).toThrowError(
			expect.objectContaining({ code: "malformed-snapshot-node" }),
		);
	});
});

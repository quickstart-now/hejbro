import { bigint, jsonb, schema, sql, table, text, uuid } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { ChainApi } from "../../src/db/chain";
import type { InsertInput, UpdateInput } from "../../src/types/insert-input";

/**
 * #337: the chain mutation entry points (`.values()`/`.set()`/
 * `onConflictDoUpdate`'s `set`) must consume {@link InsertInput}/
 * {@link UpdateInput} — the spec's "Insert and update input types follow
 * the declaration" requirement was tracked only by the standalone
 * `insert-input.test.ts` while the chains still took core's
 * `MutationRow` (every key optional, explicit `null` accepted on
 * `notNull` columns). These tests assert the requirement at the surface
 * a user actually types against.
 */

const app = schema("chain_input");

type Payload = { readonly kind: "widget" };

const orders = table(app, "orders", {
	// primaryKey materializes notNull (task 3.16); no default -> required.
	id: uuid().primaryKey(),
	// notNull, no default -> required.
	label: text().notNull(),
	// nullable -> optional key, accepts an explicit null write.
	note: text(),
	// notNull + default -> optional key (Postgres fills it when omitted).
	slug: text().notNull().default("untitled"),
	// unwritable family (json/jsonb/bytea): no raw-value write path, the
	// sql escape hatch (an Expr) is the only accepted value.
	payload: jsonb().$type<Payload>().notNull(),
	// mode-resolved value type (default mode 'bigint').
	amount: bigint().notNull(),
});

type Orders = typeof orders;

/** Type-only chain handle — never assigned, never called at runtime (the same technique `chain-types.test.ts` uses for `Tx["execute"]`); every "call" below lives inside an arrow that is type-checked but never invoked. */
declare const chains: ChainApi;
declare const startedInsert: ReturnType<typeof chains.insert<Orders>>;
declare const startedUpdate: ReturnType<typeof chains.update<Orders>>;

const ID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_EXPR = sql`'{"kind":"widget"}'::jsonb`;

describe("chain .values() consumes InsertInput (#337)", () => {
	it("the parameter type IS InsertInput, not a parallel shape", () => {
		type ValuesParam = Parameters<typeof startedInsert.values>[0];
		expectTypeOf<ValuesParam>().toEqualTypeOf<
			InsertInput<Orders> | ReadonlyArray<InsertInput<Orders>>
		>();
	});

	it("accepts a complete row; defaulted and nullable keys stay optional", () => {
		const accepted = () =>
			startedInsert.values({
				id: ID,
				label: "first",
				payload: PAYLOAD_EXPR,
				amount: 1n,
				// slug (defaulted) and note (nullable) omitted -- legal.
			});
		expectTypeOf(accepted).toBeFunction();
	});

	it("rejects a row that omits a required key", () => {
		const rejected = () =>
			// @ts-expect-error label (notNull, no default) is a required key
			startedInsert.values({ id: ID, payload: PAYLOAD_EXPR, amount: 1n });
		expectTypeOf(rejected).toBeFunction();
	});

	it("rejects an unknown key", () => {
		const rejected = () =>
			startedInsert.values({
				id: ID,
				label: "first",
				payload: PAYLOAD_EXPR,
				amount: 1n,
				// @ts-expect-error undeclared columns are rejected
				extra: 1,
			});
		expectTypeOf(rejected).toBeFunction();
	});

	it("rejects an explicit null write to a notNull column", () => {
		const rejected = () =>
			startedInsert.values({
				id: ID,
				// @ts-expect-error a notNull column never accepts an explicit null
				label: null,
				payload: PAYLOAD_EXPR,
				amount: 1n,
			});
		expectTypeOf(rejected).toBeFunction();
	});

	it("accepts an explicit null write to a nullable column", () => {
		const accepted = () =>
			startedInsert.values({
				id: ID,
				label: "first",
				note: null,
				payload: PAYLOAD_EXPR,
				amount: 1n,
			});
		expectTypeOf(accepted).toBeFunction();
	});

	it("rejects a raw value on an unwritable (jsonb) column", () => {
		const rejected = () =>
			startedInsert.values({
				id: ID,
				label: "first",
				// @ts-expect-error jsonb has no raw-value write path -- Expr only
				payload: { kind: "widget" },
				amount: 1n,
			});
		expectTypeOf(rejected).toBeFunction();
	});

	it("requires every row of a multi-row insert to carry its own required keys", () => {
		const rejected = () =>
			startedInsert.values([
				{ id: ID, label: "first", payload: PAYLOAD_EXPR, amount: 1n },
				// @ts-expect-error the second row omits label -- per-row requirement
				{ id: ID, payload: PAYLOAD_EXPR, amount: 2n },
			]);
		expectTypeOf(rejected).toBeFunction();
	});
});

describe("chain .set() and onConflictDoUpdate set consume UpdateInput (#337)", () => {
	it("the parameter type IS UpdateInput, not a parallel shape", () => {
		type SetParam = Parameters<typeof startedUpdate.set>[0];
		expectTypeOf<SetParam>().toEqualTypeOf<UpdateInput<Orders>>();
	});

	it("accepts a partial row -- required keys do not constrain updates", () => {
		const accepted = () => startedUpdate.set({ label: "renamed" });
		expectTypeOf(accepted).toBeFunction();
	});

	it("rejects an unknown key", () => {
		const rejected = () =>
			startedUpdate.set({
				label: "renamed",
				// @ts-expect-error undeclared columns are rejected
				extra: 1,
			});
		expectTypeOf(rejected).toBeFunction();
	});

	it("rejects an explicit null write to a notNull column, accepts one to a nullable column", () => {
		const acceptedNullable = () => startedUpdate.set({ note: null });
		const rejected = () =>
			startedUpdate.set({
				// @ts-expect-error a notNull column never accepts an explicit null
				label: null,
			});
		expectTypeOf(acceptedNullable).toBeFunction();
		expectTypeOf(rejected).toBeFunction();
	});

	it("onConflictDoUpdate's set is UpdateInput too", () => {
		const rejected = () =>
			startedInsert
				.values({ id: ID, label: "first", payload: PAYLOAD_EXPR, amount: 1n })
				.onConflictDoUpdate({
					target: [orders.id],
					set: {
						// @ts-expect-error a notNull column never accepts an explicit null
						label: null,
					},
				});
		expectTypeOf(rejected).toBeFunction();
	});
});

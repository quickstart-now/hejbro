import type { HejbroInput } from "@hejbro/core";
import { existingTable, HejbroError, schema, table, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractOrigin } from "../src/contract/emit";
import { emitContract } from "../src/contract/emit";
import { buildFixturePayload } from "./support/contract-fixture";

const GIT_ORIGIN: ContractOrigin = {
	source: "git",
	commit: "abc123",
	exportHash: "sha256:deadbeef",
};

const DATABASE_ORIGIN: ContractOrigin = {
	source: "database",
	database: "app_db",
	schemas: ["a", "b"],
};

const idOnly = { id: uuid().primaryKey() };

const a = schema("a");
const b = schema("b");
const c = schema("c");
const app = schema("app");

const emitOrThrow = (
	declarations: ReadonlyArray<HejbroInput>,
	origin: ContractOrigin,
): HejbroError => {
	try {
		emitContract(buildFixturePayload(declarations), origin);
	} catch (error) {
		if (error instanceof HejbroError) {
			return error;
		}
		throw error;
	}
	throw new Error("emitContract did not refuse");
};

/** Every position of one qualified table in the message, so the order
 * assertion below can compare positions rather than eyeball text. */
const positionOf = (message: string, qualified: string): number => {
	const index = message.indexOf(qualified);
	expect(index, `${qualified} named in: ${message}`).toBeGreaterThan(-1);
	return index;
};

const COLLIDING_LAYOUTS: ReadonlyArray<{
	readonly label: string;
	readonly declarations: ReadonlyArray<HejbroInput>;
	readonly names: ReadonlyArray<{
		readonly sqlName: string;
		readonly qualified: ReadonlyArray<string>;
	}>;
}> = [
	{
		label: "managed a.widgets beside managed b.widgets",
		declarations: [
			a,
			b,
			table(a, "widgets", idOnly),
			table(b, "widgets", idOnly),
		],
		names: [
			{ sqlName: "widgets", qualified: ['"a"."widgets"', '"b"."widgets"'] },
		],
	},
	{
		label: "existing auth.users beside managed app.users",
		declarations: [
			app,
			existingTable("auth", "users", idOnly),
			table(app, "users", idOnly),
		],
		names: [
			{ sqlName: "users", qualified: ['"app"."users"', '"auth"."users"'] },
		],
	},
	{
		label: "users in three schemas",
		declarations: [
			a,
			b,
			c,
			table(c, "users", idOnly),
			table(a, "users", idOnly),
			table(b, "users", idOnly),
		],
		names: [
			{
				sqlName: "users",
				qualified: ['"a"."users"', '"b"."users"', '"c"."users"'],
			},
		],
	},
	{
		label: "users in three schemas beside widgets in two",
		declarations: [
			a,
			b,
			c,
			table(b, "widgets", idOnly),
			table(c, "users", idOnly),
			table(a, "widgets", idOnly),
			table(b, "users", idOnly),
			table(a, "users", idOnly),
		],
		names: [
			{
				sqlName: "users",
				qualified: ['"a"."users"', '"b"."users"', '"c"."users"'],
			},
			{ sqlName: "widgets", qualified: ['"a"."widgets"', '"b"."widgets"'] },
		],
	},
];

const ORIGINS: ReadonlyArray<{
	readonly origin: ContractOrigin;
	readonly code: string;
	readonly next: string;
}> = [
	{
		origin: GIT_ORIGIN,
		code: "vendor-table-name-collision",
		next: "Next: --schema is reserved on vendor, so the export itself must carry one table per SQL name",
	},
	{
		origin: DATABASE_ORIGIN,
		code: "pull-table-name-collision",
		next: "Next: drop one of the schemas from --schema",
	},
];

describe("two carried tables with one SQL name are refused at emission (#1004)", () => {
	ORIGINS.forEach(({ origin, code, next }) => {
		COLLIDING_LAYOUTS.forEach(({ label, declarations, names }) => {
			it(`${origin.source} origin: ${label}`, () => {
				const error = emitOrThrow(declarations, origin);
				expect(error.code).toBe(code);
				expect(error.message).toContain(next);
				names.forEach(({ sqlName, qualified }) => {
					expect(error.message).toContain(`named "${sqlName}"`);
					const positions = qualified.map((entry) =>
						positionOf(error.message, entry),
					);
					expect(positions).toEqual([...positions].sort((x, y) => x - y));
				});
			});
		});

		it(`${origin.source} origin: a unique-name layout with an existing table is emitted`, () => {
			const authUsers = existingTable("auth", "users", idOnly);
			const source = emitContract(
				buildFixturePayload([
					app,
					authUsers,
					table(app, "accounts", idOnly),
					table(app, "posts", {
						id: uuid().primaryKey(),
						authorId: uuid().references(() => authUsers.id),
					}),
				]),
				origin,
			);
			expect(source).toContain('"users": {');
			expect(source).toContain('"accounts": {');
			expect(source).toContain('"posts": {');
		});
	});

	it("the names in one message are listed in identity order across both names", () => {
		const twoNames = COLLIDING_LAYOUTS.at(-1);
		if (twoNames === undefined) {
			throw new Error("the two-name layout is the last row");
		}
		const error = emitOrThrow(twoNames.declarations, GIT_ORIGIN);
		expect(positionOf(error.message, 'named "users"')).toBeLessThan(
			positionOf(error.message, 'named "widgets"'),
		);
	});
});

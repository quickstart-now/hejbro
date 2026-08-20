import { describe, expect, it } from "vitest";
import { notNullWithoutDefaultWarnings } from "../src/engine/core-validators";
import type { KindChange } from "../src/kind/object-kind";

const tableSnapshot = (
	name: string,
	columns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: string;
	}>,
) => ({
	schema: "app",
	name,
	columns,
	indexes: [],
	foreignKeys: [],
});

const alterChange = (
	previousColumns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: string;
	}>,
	nextColumns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: string;
	}>,
): KindChange => ({
	kind: "table",
	operation: "alter",
	identity: "app.posts",
	previous: tableSnapshot("posts", previousColumns),
	next: tableSnapshot("posts", nextColumns),
	notes: [],
});

const createChange = (
	columns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: string;
	}>,
): KindChange => ({
	kind: "table",
	operation: "create",
	identity: "app.posts",
	previous: null,
	next: tableSnapshot("posts", columns),
	notes: [],
});

describe("notNullWithoutDefaultWarnings", () => {
	it("warns once, with a fixed message, when an alter adds a not-null column without a default", () => {
		const change = alterChange(
			[{ name: "id", notNull: true }],
			[
				{ name: "id", notNull: true },
				{ name: "status", notNull: true },
			],
		);

		const warnings = notNullWithoutDefaultWarnings([change]);

		expect(warnings).toEqual([
			{
				severity: "warning",
				code: "not-null-without-default",
				message:
					'column "app"."posts"."status" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.',
				declaredAt: null,
			},
		]);
	});

	it("does not warn for a brand-new table (create, not alter)", () => {
		const change = createChange([{ name: "status", notNull: true }]);

		expect(notNullWithoutDefaultWarnings([change])).toEqual([]);
	});

	it("does not warn when the added not-null column has a default", () => {
		const change = alterChange(
			[{ name: "id", notNull: true }],
			[
				{ name: "id", notNull: true },
				{ name: "status", notNull: true, default: "'draft'" },
			],
		);

		expect(notNullWithoutDefaultWarnings([change])).toEqual([]);
	});

	it("does not warn when the added column is nullable", () => {
		const change = alterChange(
			[{ name: "id", notNull: true }],
			[{ name: "id", notNull: true }, { name: "status" }],
		);

		expect(notNullWithoutDefaultWarnings([change])).toEqual([]);
	});
});

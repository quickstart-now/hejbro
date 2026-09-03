import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// [task 3.12, #753] A CLI-level witness (no Docker, no database) that the
// same-kind dependency refinement (task 1.2) never moves the name a run's
// migration file is written under, only the statements inside it: three
// shapes -- a create pair, an alter-only pair, and a drop pair -- each
// with a table whose own foreign key makes the refined (emitted) order
// differ from the pre-refinement (kind order, then identity) order
// deriveSlug names by.

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const writeSchema = (source: string): Promise<void> =>
	writeFixtureFile(cwd, "src/app.schema.ts", source);

const lastSqlFileName = async (): Promise<string> => {
	const entries = await readdir(join(cwd, "migrations"));
	const names = entries.filter((name) => name.endsWith(".sql")).sort();
	return names[names.length - 1] as string;
};

// widget_parts sorts before widgets by identity ("widget_parts" < "widgets"
// -- "_" is less than "s") but references widgets, so create/alter order
// puts widgets first; the pre-refinement (identity) order the slug SHALL
// follow puts widget_parts first.
const CREATE_PAIR_SOURCE = `import { schema, table, uuid } from "hejbro";

export const app = schema("app");

export const widgets = table(app, "widgets", {
	id: uuid().primaryKey().defaultRandom(),
});

export const widgetParts = table(
	app,
	"widget_parts",
	{ id: uuid().primaryKey().defaultRandom(), widgetId: uuid() },
	(t) => ({
		foreignKeys: [
			{
				columns: [t.widgetId],
				references: { table: widgets, columns: [widgets.id] },
			},
		],
	}),
);
`;

const ALTER_PAIR_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const widgets = table(app, "widgets", {
	id: uuid().primaryKey().defaultRandom(),
	name: text().notNull(),
});

export const widgetParts = table(
	app,
	"widget_parts",
	{
		id: uuid().primaryKey().defaultRandom(),
		widgetId: uuid(),
		label: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.widgetId],
				references: { table: widgets, columns: [widgets.id] },
			},
		],
	}),
);
`;

// a_lookups sorts before z_tags by identity, and is what z_tags
// references -- the reverse shape from the pair above: drop order puts
// z_tags (the dependent) first, but the pre-refinement identity order the
// slug SHALL follow puts a_lookups first.
const DROP_PAIR_SOURCE = `import { schema, table, uuid } from "hejbro";

export const app = schema("app");

export const aLookups = table(app, "a_lookups", {
	id: uuid().primaryKey().defaultRandom(),
});

export const zTags = table(
	app,
	"z_tags",
	{ id: uuid().primaryKey().defaultRandom(), lookupId: uuid() },
	(t) => ({
		foreignKeys: [
			{
				columns: [t.lookupId],
				references: { table: aLookups, columns: [aLookups.id] },
			},
		],
	}),
);
`;

const EMPTY_SCHEMA_SOURCE = `import { schema } from "hejbro";

export const app = schema("app");
`;

describe("a migration's file name follows the pre-refinement change order (task 3.12, #753)", () => {
	it("a create pair -- named from the referencing table, which sorts first by identity, not the referenced table create emits first", async () => {
		await runCli(cwd, ["init"]);
		// The schema itself created here first, so the pair below is the
		// only thing that changes in the next run -- otherwise "schema
		// app" (kind order: schema before table) would be the run's own
		// first change, naming the migration "add_app" regardless of
		// which table sorts first, and this case would test nothing.
		await writeSchema(EMPTY_SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(CREATE_PAIR_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);

		const fileName = await lastSqlFileName();
		expect(fileName).toContain("_add_widget_parts.sql");
	});

	it("an alter-only pair, the same shape -- named from the referencing table's own alter, not the referenced table's", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(CREATE_PAIR_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(ALTER_PAIR_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);

		const fileName = await lastSqlFileName();
		expect(fileName).toContain("_alter_widget_parts.sql");
	});

	it("a drop pair -- named from the referenced table, which sorts first by identity, not the dependent table drop emits first", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(DROP_PAIR_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(EMPTY_SCHEMA_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);

		const fileName = await lastSqlFileName();
		expect(fileName).toContain("_drop_a_lookups.sql");
	});
});

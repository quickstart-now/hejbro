import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildSnapshot,
	createDefaultRegistry,
	defineTrigger,
	emptySnapshot,
	generateMigration,
	getTableMeta,
	grant,
	migrationPrefixStrategies,
	roleName,
	schema,
	table,
	uuid,
} from "../src/index";

// D57 (#128): output tokens hejbro authors itself must be kebab-case
// (snapshot values, identity segments, kind ids, diagnostic codes, config
// values, golden directory names) — never camelCase. This scans *output*
// produced through the public API, not source text, so it can't be
// satisfied by renaming a variable without changing what actually ships.
//
// Explicit exception (not checked here): user-supplied SQL identifiers —
// table/column/role names — stay snake_case (D36, assertSqlName's own
// realm). This file only ever inspects hejbro's own closed-vocabulary
// tokens, never a value the user typed, so that exception needs no special
// case — it's satisfied by what this file simply never looks at.

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const GOLDEN_CASES_DIR = join(
	REPO_ROOT,
	"packages",
	"core",
	"test",
	"golden",
	"cases",
);

const app = schema("app");
const registry = createDefaultRegistry();

describe("D57 naming convention: output tokens are kebab-case", () => {
	it("kind ids (the object-kind registry) are all kebab-case", () => {
		const kindIds = registry.list().map((kind) => kind.kind);
		expect(kindIds.length).toBeGreaterThan(0);
		const offenders = kindIds.filter((id) => !KEBAB_CASE.test(id));
		expect(offenders).toEqual([]);
	});

	it("migration prefix strategy values are all kebab-case", () => {
		expect(migrationPrefixStrategies.length).toBeGreaterThan(0);
		const offenders = migrationPrefixStrategies.filter(
			(value) => !KEBAB_CASE.test(value),
		);
		expect(offenders).toEqual([]);
	});

	it("golden case directory names are all kebab-case", () => {
		const entries = readdirSync(GOLDEN_CASES_DIR, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		expect(entries.length).toBeGreaterThan(0);
		const offenders = entries.filter((name) => !KEBAB_CASE.test(name));
		expect(offenders).toEqual([]);
	});

	it("the snapshot's own format-version field is `formatVersion`, not `hejbroSnapshot`", () => {
		expect(Object.hasOwn(emptySnapshot, "formatVersion")).toBe(true);
		expect(Object.hasOwn(emptySnapshot, "hejbroSnapshot")).toBe(false);
	});

	it("a schema snapshot's self-naming field is `name`, not `schemaName`", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			registry,
		});
		const schemaNode = result.snapshot.objects["schema:app"] as Record<
			string,
			unknown
		>;
		expect(schemaNode).toBeDefined();
		expect(Object.hasOwn(schemaNode, "name")).toBe(true);
		expect(Object.hasOwn(schemaNode, "schemaName")).toBe(false);
	});

	it("a trigger snapshot's function-reference field is `function`, not `functionName`", () => {
		const comments = table(app, "comments", {
			id: uuid().primaryKey(),
			postId: uuid().notNull(),
		});
		const guard = defineTrigger(
			comments,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const result = generateMigration({
			declarations: [comments, guard],
			previousSnapshot: emptySnapshot,
			registry,
		});
		const triggerNode = result.snapshot.objects[
			"trigger:app.comments.guard"
		] as Record<string, unknown>;
		expect(triggerNode).toBeDefined();
		expect(Object.hasOwn(triggerNode, "function")).toBe(true);
		expect(Object.hasOwn(triggerNode, "functionName")).toBe(false);
	});

	it("every grantKind value is kebab-case, and the migration banner carries the kebab token", () => {
		const readerRole = roleName("app_reader");
		const usageGrant = grant(app).usage.to(readerRole);
		const tablesGrant = grant(app).tables("select").to(readerRole);
		const defaultTablesGrant = grant(app)
			.defaultPrivileges.tables("select")
			.to(readerRole);

		const result = generateMigration({
			declarations: [app, usageGrant, tablesGrant, defaultTablesGrant],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const grantChanges = result.changes.filter(
			(change) => change.kind === "grant",
		);
		expect(grantChanges.length).toBe(3);

		const grantKinds = grantChanges.map((change) => {
			const node = change.next as Record<string, unknown>;
			return node.grantKind as string;
		});
		const offenders = grantKinds.filter((value) => !KEBAB_CASE.test(value));
		expect(offenders).toEqual([]);

		// The identity — and therefore the migration banner — embeds the
		// same token (`<schema>.<grantKind>.<role>`); a passing snapshot
		// check alone wouldn't catch a mismatch between the two.
		for (const grantKind of grantKinds) {
			expect(result.sql).toContain(`.${grantKind}.`);
		}
	});

	it("a real error diagnostic code is kebab-case (ambiguous-column-rename)", () => {
		const postsV1 = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: uuid().notNull(),
		});
		const previousSnapshot = buildSnapshot([getTableMeta(postsV1)], registry);
		const postsV2 = table(app, "posts", {
			id: uuid().primaryKey(),
			handle: uuid().notNull(),
		});
		const result = generateMigration({
			declarations: [postsV2],
			previousSnapshot,
			registry,
		});
		expect(result.errors.length).toBeGreaterThan(0);
		const offenders = result.errors
			.map((error) => error.code)
			.filter((code) => !KEBAB_CASE.test(code));
		expect(offenders).toEqual([]);
	});

	it("a real warning diagnostic code is kebab-case (not-null-without-default)", () => {
		const usersV1 = table(app, "users", { id: uuid().primaryKey() });
		const previousSnapshot = buildSnapshot([getTableMeta(usersV1)], registry);
		const usersV2 = table(app, "users", {
			id: uuid().primaryKey(),
			email: uuid().notNull(),
		});
		const result = generateMigration({
			declarations: [usersV2],
			previousSnapshot,
			registry,
		});
		expect(result.warnings.length).toBeGreaterThan(0);
		const offenders = result.warnings
			.map((warning) => warning.code)
			.filter((code) => !KEBAB_CASE.test(code));
		expect(offenders).toEqual([]);
	});
});

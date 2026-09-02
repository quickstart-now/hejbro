import type { Snapshot, TableSnapshot } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { emitDeclarationFiles, renderHeader } from "../src/declare-emit/emit";
import type { InferCatalogResult } from "../src/infer/compose";

const widgetsTable: TableSnapshot = {
	schema: "app",
	name: "widgets",
	columns: [
		{
			name: "id",
			typeNode: { typeName: "uuid" },
			notNull: true,
			primaryKey: true,
		},
		{ name: "label", typeNode: { typeName: "text" }, notNull: true },
	],
	indexes: [],
	foreignKeys: [],
	primaryKeyName: "widgets_pkey",
};

type EnumFactLike = {
	readonly schema: string;
	readonly name: string;
	readonly values: ReadonlyArray<string>;
};

const snapshotWith = (
	tables: ReadonlyArray<TableSnapshot>,
	enumFacts: ReadonlyArray<EnumFactLike> = [],
): Snapshot => ({
	formatVersion: 8,
	dialect: "postgres",
	objects: Object.fromEntries([
		...tables.map(
			(table) => [`table:${table.schema}.${table.name}`, table] as const,
		),
		...enumFacts.map((row) => [`enum:${row.schema}.${row.name}`, row] as const),
	]),
});

const resultFor = (
	tables: ReadonlyArray<TableSnapshot>,
	enumFacts: ReadonlyArray<EnumFactLike> = [],
): InferCatalogResult => ({
	snapshot: snapshotWith(tables, enumFacts),
	description: {
		tables: tables.map((table) => ({
			schema: table.schema,
			table: table.name,
			columns: table.columns.map((column) => ({
				sqlName: column.name,
				tsKey: column.name,
			})),
		})),
		roleNames: [],
	},
	lossReport: [],
	// unused by this suite -- emitDeclarationFiles never reads it.
	sql: "",
});

describe("emitDeclarationFiles / 2.1", () => {
	it("emits one file for one schema, importing only the symbols it uses", () => {
		const files = emitDeclarationFiles(resultFor([widgetsTable]));

		expect(files).toHaveLength(1);
		const [file] = files;
		if (file === undefined) {
			throw new Error("expected one file");
		}
		expect(file.schema).toBe("app");
		expect(file.fileBaseName).toBe("app");
		expect(file.source).toContain(
			'import { schema, table, text, uuid } from "hejbro";',
		);
		expect(file.source).toContain('export const app = schema("app");');
		expect(file.source).toContain("export const widgets = table(");
		expect(file.source).toContain("id: uuid().notNull().primaryKey(),");
		expect(file.source).toContain("label: text().notNull(),");
		// no engine symbol ever appears in a generated import (#471).
		expect(file.source).not.toContain("generateMigration");
		expect(file.source).not.toContain("buildSnapshot");
	});

	it("names a table `check` without shadowing the imported `check` function (CI-G2-R1-06 Q2)", () => {
		const checkTable: TableSnapshot = {
			schema: "app",
			name: "check",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			checks: [
				{
					name: "check_id_not_null",
					expression: { nodeKind: "raw-sql", sql: "id is not null" },
				},
			],
			primaryKeyName: "check_pkey",
		};
		const files = emitDeclarationFiles(resultFor([checkTable]));
		const [file] = files;
		if (file === undefined) {
			throw new Error("expected one file");
		}
		// the table's own identifier must be suffixed (bare `check` is the
		// imported function) -- and the import line still names `check`
		// exactly once, for the function, not the table.
		expect(file.source).toContain("export const check2 = table(");
		expect(file.source).not.toContain("export const check = table(");
		const importLine = file.source
			.split("\n")
			.find(
				(line) => line.startsWith("import { ") && line.includes('"hejbro"'),
			);
		expect(importLine).toBeDefined();
		expect((importLine ?? "").match(/\bcheck\b/g)).toHaveLength(1);
	});

	it("is deterministic: a reversed table order produces the same file text (CI-G2-R1-05)", () => {
		const a: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "a_pkey",
		};
		const b: TableSnapshot = {
			schema: "app",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "b_pkey",
		};
		const forward = emitDeclarationFiles(resultFor([a, b]));
		const reversed = emitDeclarationFiles(resultFor([b, a]));
		expect(forward).toEqual(reversed);
	});

	it('is deterministic: the same input run twice emits byte-identical files (cli-commands delta: "a second import writes the same bytes")', () => {
		const result = resultFor([widgetsTable]);
		const first = emitDeclarationFiles(result);
		const second = emitDeclarationFiles(result);
		expect(first).toEqual(second);
	});

	it("handles only the schema-graph's own back edge on a cross-schema cycle, keeping a real import on the other direction (CI-G2-R1-18)", () => {
		const appA: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "b_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "a_b_id_fkey",
					columns: ["b_id"],
					referencesTable: "billing.b",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "a_pkey",
		};
		const billingB: TableSnapshot = {
			schema: "billing",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "a_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "b_a_id_fkey",
					columns: ["a_id"],
					referencesTable: "app.a",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "b_pkey",
		};

		const files = emitDeclarationFiles(resultFor([appA, billingB]));
		expect(files).toHaveLength(2);
		const appFile = files.find((file) => file.schema === "app");
		const billingFile = files.find((file) => file.schema === "billing");
		if (appFile === undefined || billingFile === undefined) {
			throw new Error("expected one file per schema");
		}

		// app and billing would otherwise import each other (a -> b and
		// b -> a both cross the same file pair) -- CI-G2-R1-18: the schema
		// graph's own deterministic DFS (identity order: "app" before
		// "billing") visits app -> billing first, so billing -> app is the
		// back edge; only billing's own edge to app goes through a handle,
		// while app's own edge to billing keeps a real import (severing
		// one direction already makes the import graph acyclic).
		expect(appFile.source).toContain('import { b } from "./billing.schema";');
		expect(appFile.source).toContain(
			"references: { table: b, columns: [b.id] }",
		);
		expect(appFile.source).not.toContain("existingTable");

		expect(billingFile.source).not.toContain('from "./app.schema"');
		expect(billingFile.source).toContain('existingTable("app", "a"');
		expect(billingFile.source).toContain(
			"references: { table: appABAIdFkeyRef, columns: [appABAIdFkeyRef.id] }",
		);
		expect(billingFile.source).not.toContain(".references(() =>");
	});

	it("handles the table-level closing edge for a same-schema (same-file) cycle too (CI-G2-R1-16: measured -- thunking it crashes with a TDZ error, `Cannot access 'x' before initialization`, since the target isn't declared yet at that textual point)", () => {
		const tableX: TableSnapshot = {
			schema: "app",
			name: "x",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "y_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "x_y_id_fkey",
					columns: ["y_id"],
					referencesTable: "app.y",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "x_pkey",
		};
		const tableY: TableSnapshot = {
			schema: "app",
			name: "y",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "x_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "y_x_id_fkey",
					columns: ["x_id"],
					referencesTable: "app.x",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "y_pkey",
		};

		const files = emitDeclarationFiles(resultFor([tableX, tableY]));
		expect(files).toHaveLength(1);
		const [file] = files;
		if (file === undefined) {
			throw new Error("expected one file");
		}

		// same file, no ESM import at all -- but the topological order still
		// declares y before x, so y's own back-reference to x would read
		// `x` before its own `const x = table(...)` line ever runs. A
		// thunk doesn't help (CI-G2-R1-16): y's own edge goes through a
		// handle just like a cross-file one would, while x's forward
		// reference to the already-declared `y` stays a normal extras
		// entry.
		expect(file.source).toContain("references: { table: y, columns: [y.id] }");
		expect(file.source).toContain('existingTable("app", "x"');
		expect(file.source).toContain(
			"references: { table: appXYXIdFkeyRef, columns: [appXYXIdFkeyRef.id] }",
		);
		expect(file.source).not.toContain(".references(() =>");
	});

	it("aliases the import when a same-named table is imported from another schema, never renaming the local one (D106 R2-B2, CI-G2-R1-09: app.users / audit.users is an ordinary case)", () => {
		const appUsers: TableSnapshot = {
			schema: "app",
			name: "users",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "users_pkey",
		};
		const auditUsers: TableSnapshot = {
			schema: "audit",
			name: "users",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "app_user_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "audit_users_app_user_id_fkey",
					columns: ["app_user_id"],
					referencesTable: "app.users",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "users_pkey",
		};

		const files = emitDeclarationFiles(resultFor([appUsers, auditUsers]));
		const appFile = files.find((file) => file.schema === "app");
		const auditFile = files.find((file) => file.schema === "audit");
		if (appFile === undefined || auditFile === undefined) {
			throw new Error("expected one file per schema");
		}

		// D106 R2-B2: each file's own local identifiers are resolved with
		// no cross-file knowledge, so neither table is ever renamed --
		// both keep the bare name "users" in their own file. The import
		// that would otherwise collide is what gets aliased instead
		// (owning schema's identifier + Pascal-cased symbol: "appUsers").
		expect(appFile.source).toContain("export const users = table(");
		expect(auditFile.source).toContain("export const users = table(");
		expect(auditFile.source).toContain(
			'import { users as appUsers } from "./app.schema";',
		);
		expect(auditFile.source).toContain(
			"references: { table: appUsers, columns: [appUsers.id] }",
		);
	});

	it("declares a composite cross-schema cycle-closing FK against an unexported existingTable handle, with every one of its target columns (CI-G2-R1-16)", () => {
		const appA: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "b_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "a_b_id_fkey",
					columns: ["b_id"],
					referencesTable: "billing.b",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "a_pkey",
		};
		const billingB: TableSnapshot = {
			schema: "billing",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "a_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					// composite (spans two columns) -- CI-G2-R1-16: a handle is
					// used here regardless of column count, same as the
					// single-column edge on the other side of this cycle.
					name: "b_a_id_fkey",
					columns: ["a_id", "id"],
					referencesTable: "app.a",
					referencesColumns: ["id", "b_id"],
				},
			],
			primaryKeyName: "b_pkey",
		};

		const files = emitDeclarationFiles(resultFor([appA, billingB]));
		const appFile = files.find((file) => file.schema === "app");
		const billingFile = files.find((file) => file.schema === "billing");
		if (appFile === undefined || billingFile === undefined) {
			throw new Error("expected one file per schema");
		}

		// no import of `a` from app.schema -- the handle carries the schema
		// and table as string literals instead, so the cross-schema cycle
		// import never actually happens (app -> billing is now the only
		// direction, so there is no file cycle left to worry about at all).
		expect(billingFile.source).not.toContain('from "./app.schema"');
		expect(billingFile.source).toContain("existingTable");
		expect(billingFile.source).toContain('existingTable("app", "a"');
		expect(billingFile.source).not.toContain(".references(() =>");
		expect(billingFile.source).toContain("// Closes a declaration-file cycle");
		expect(billingFile.source).toContain(
			"references: { table: appABAIdFkeyRef, columns: [appABAIdFkeyRef.id, appABAIdFkeyRef.b_id] }",
		);

		// app.a's own edge to billing.b is the schema graph's forward
		// direction (not the back edge -- "app" sorts before "billing", so
		// app -> billing is visited first), so it stays a real cross-file
		// import regardless of its own shape being single-column/no-action
		// (CI-G2-R1-18: only the back edge needs a handle).
		expect(appFile.source).toContain('import { b } from "./billing.schema";');
		expect(appFile.source).toContain(
			"references: { table: b, columns: [b.id] }",
		);
		expect(appFile.source).not.toContain("existingTable");
	});

	it("picks the same back edge regardless of catalog row order (CI-G2-R1-18 condition 1: the same database import run twice must not flip which direction gets the handle)", () => {
		const appA: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "b_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "a_b_id_fkey",
					columns: ["b_id"],
					referencesTable: "billing.b",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "a_pkey",
		};
		const billingB: TableSnapshot = {
			schema: "billing",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "a_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "b_a_id_fkey",
					columns: ["a_id"],
					referencesTable: "app.a",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "b_pkey",
		};

		const forward = emitDeclarationFiles(resultFor([appA, billingB]));
		const reversed = emitDeclarationFiles(resultFor([billingB, appA]));
		expect(forward).toEqual(reversed);
	});

	/** Every `import { ... } from "./<schema>.schema";` line's own target schema, parsed straight out of the generated source -- a direct assertion on the declared invariant itself (cli-commands: "Declaration files never import each other in a cycle"), independent of whether any particular fixture happens to execute successfully. */
	const importedSchemasFrom = (source: string): ReadonlyArray<string> =>
		[...source.matchAll(/from "\.\/([^"]+)\.schema";/g)].map(
			(match) => match[1] ?? "",
		);

	/**
	 * D106 R3-N4: keyed and probed by `fileBaseName` throughout, never
	 * `schema` -- `importedSchemasFrom` parses an import line's own
	 * target, which is always the *file* base name a `from "./<...>
	 * .schema"` path names, not the schema itself. A schema whose name
	 * isn't already a safe file base name (`safeFileBaseName` folds
	 * `a.b`/`a b` to `a_b`) used to make every lookup miss when this map
	 * was keyed by `schema` instead, so the whole graph read as empty and
	 * this assertion passed vacuously even over a real cycle.
	 */
	const hasImportCycle = (
		files: ReadonlyArray<{
			readonly fileBaseName: string;
			readonly source: string;
		}>,
	): boolean => {
		const adjacency = new Map(
			files.map(
				(file) =>
					[file.fileBaseName, importedSchemasFrom(file.source)] as const,
			),
		);
		const visit = (
			visited: ReadonlySet<string>,
			node: string,
		): ReadonlySet<string> => {
			if (visited.has(node)) {
				return visited;
			}
			const nextVisited = new Set([...visited, node]);
			return (adjacency.get(node) ?? []).reduce(visit, nextVisited);
		};
		/** Reachable from `start` through at least one real edge -- never trivially "reachable from itself" in zero steps, or every acyclic graph would falsely report a cycle at every node. */
		const reachesItself = (start: string): boolean =>
			(adjacency.get(start) ?? []).reduce(visit, new Set<string>()).has(start);
		return files.some((file) => reachesItself(file.fileBaseName));
	};

	it('never emits a set of files whose imports form a cycle (cli-commands: "Declaration files never import each other in a cycle")', () => {
		const appA: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "b_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "a_b_id_fkey",
					columns: ["b_id"],
					referencesTable: "billing.b",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "a_pkey",
		};
		const billingB: TableSnapshot = {
			schema: "billing",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "a_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "b_a_id_fkey",
					columns: ["a_id"],
					referencesTable: "app.a",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "b_pkey",
		};

		const files = emitDeclarationFiles(resultFor([appA, billingB]));
		expect(hasImportCycle(files)).toBe(false);
		// the assertion itself must be able to see a cycle when there is
		// one, or it proves nothing -- a hand-built pair of mutually
		// importing files is exactly that case.
		expect(
			hasImportCycle([
				{ fileBaseName: "x", source: 'import { y } from "./y.schema";' },
				{ fileBaseName: "y", source: 'import { x } from "./x.schema";' },
			]),
		).toBe(true);
	});

	/**
	 * D106 R3-N4: a schema name that isn't already a safe file base name
	 * (`safeFileBaseName` folds `a.b` to `a_b`, N6's own fixture shape) --
	 * the cycle here is real (`a_b` imports `c`, `c` imports `a_b`), and
	 * the assertion must still catch it even though the schema's own
	 * name (`a.b`) and its file base name (`a_b`) differ.
	 */
	it("hasImportCycle still catches a cycle when a schema's own name folds into a different file base name", () => {
		expect(
			hasImportCycle([
				{ fileBaseName: "a_b", source: 'import { c1 } from "./c.schema";' },
				{ fileBaseName: "c", source: 'import { a1 } from "./a_b.schema";' },
			]),
		).toBe(true);
	});

	/**
	 * D106 B1 (CI-D106-R2-02): this same direct assertion already covers an
	 * enum crossing too (`importedSchemasFrom`'s own regex only ever reads
	 * the target of a `from "./<schema>.schema"` import line, whatever
	 * symbol it names) -- what was missing was a *fixture* exercising an
	 * enum crossing at all, which is exactly evaluation.md's own repro:
	 * `app.users.kind` types against `audit.event_kind` (enum, app ->
	 * audit), `audit.logs.user_id` references `app.users` (FK, audit ->
	 * app).
	 */
	it('never emits a set of files whose imports form a cycle, when the cycle is closed by an enum reference rather than (or alongside) a foreign key (D106 B1, cli-commands: "Declaration files never import each other in a cycle")', () => {
		const usersTable: TableSnapshot = {
			schema: "app",
			name: "users",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{
					name: "kind",
					typeNode: {
						typeName: "enum",
						enumSchema: "audit",
						enumName: "event_kind",
					},
					notNull: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "users_pkey",
		};
		const logsTable: TableSnapshot = {
			schema: "audit",
			name: "logs",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "user_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "logs_user_id_fkey",
					columns: ["user_id"],
					referencesTable: "app.users",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "logs_pkey",
		};
		const eventKind = {
			schema: "audit",
			name: "event_kind",
			values: ["created", "updated"],
		};

		const files = emitDeclarationFiles(
			resultFor([usersTable, logsTable], [eventKind]),
		);
		expect(hasImportCycle(files)).toBe(false);

		const appFile = files.find((file) => file.schema === "app");
		const auditFile = files.find((file) => file.schema === "audit");
		if (appFile === undefined || auditFile === undefined) {
			throw new Error("expected one file per schema");
		}
		// candidate B+A (lead verdict): the FK crossing (audit -> app) is
		// preferred as the cut, so app's own enum reference keeps a real
		// import and audit's own FK reference goes through a handle.
		expect(appFile.source).toContain(
			'import { eventKind } from "./audit.schema";',
		);
		expect(appFile.source).not.toContain("pgEnum(schema(");
		expect(auditFile.source).not.toContain('from "./app.schema"');
		expect(auditFile.source).toContain('existingTable("app", "users"');
	});

	it("picks the same edge to cut for an enum-crossing cycle regardless of catalog row order (D106 B1's own determinism condition)", () => {
		const usersTable: TableSnapshot = {
			schema: "app",
			name: "users",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{
					name: "kind",
					typeNode: {
						typeName: "enum",
						enumSchema: "audit",
						enumName: "event_kind",
					},
					notNull: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "users_pkey",
		};
		const logsTable: TableSnapshot = {
			schema: "audit",
			name: "logs",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "user_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "logs_user_id_fkey",
					columns: ["user_id"],
					referencesTable: "app.users",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "logs_pkey",
		};
		const eventKind = {
			schema: "audit",
			name: "event_kind",
			values: ["created", "updated"],
		};

		const forward = emitDeclarationFiles(
			resultFor([usersTable, logsTable], [eventKind]),
		);
		const reversed = emitDeclarationFiles(
			resultFor([logsTable, usersTable], [eventKind]),
		);
		expect(forward).toEqual(reversed);
	});

	it("carries a one-line constraint comment at the enum clone's own cut site, mirroring the FK handle's own comment (D106 B1)", () => {
		const appA: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{
					name: "kind",
					typeNode: {
						typeName: "enum",
						enumSchema: "audit",
						enumName: "status",
					},
					notNull: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "a_pkey",
		};
		const auditB: TableSnapshot = {
			schema: "audit",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{
					name: "other_kind",
					typeNode: {
						typeName: "enum",
						enumSchema: "app",
						enumName: "category",
					},
					notNull: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "b_pkey",
		};
		const enumFacts = [
			{ schema: "audit", name: "status", values: ["created", "updated"] },
			{ schema: "app", name: "category", values: ["x", "y"] },
		];

		const files = emitDeclarationFiles(resultFor([appA, auditB], enumFacts));
		const withClone = files.find((file) =>
			file.source.includes("pgEnum(schema("),
		);
		if (withClone === undefined) {
			throw new Error("expected exactly one file to carry an enum clone");
		}
		expect(withClone.source).toContain(
			"// Closes a declaration-file cycle -- importing the other file's own enum would close it the other way, so this column types against a local, unexported clone instead.",
		);
		const commentLine = withClone.source
			.split("\n")
			.findIndex((line) => line.includes("Closes a declaration-file cycle"));
		const nextLine = withClone.source.split("\n")[commentLine + 1] ?? "";
		expect(nextLine).toContain("pgEnum(schema(");
	});
});

describe("renderHeader / D106 R3-B1 (CI-R3-03: ASCII backslash, not a zero-width space): a star-slash pair inside a loss-report line never closes the header comment early", () => {
	// A star immediately followed by a slash is never spelled out
	// literally in this file's own comments, for the obvious reason --
	// built from parts at each call site instead.
	const starSlash = `${"*"}${"/"}`;
	const escaped = `${"*"}\\${"/"}`;

	it("splits every star-slash pair in a report line with a backslash so the block comment only ever closes at its own final line", () => {
		const header = renderHeader([
			`Omitted: column "app.widgets.a${starSlash}b" -- danger.`,
		]);
		const lines = header.split("\n");
		const closingLine = lines.at(-1);
		const body = lines.slice(0, -1).join("\n");
		expect(closingLine).toBe(" */");
		expect(body).not.toContain(starSlash);
		// the pair reads as itself plus one visible, explained backslash.
		expect(body).toContain(`app.widgets.a${escaped}b`);
	});

	it("splits more than one star-slash pair on the same line", () => {
		const header = renderHeader([`a${starSlash}b${starSlash}c`]);
		const body = header.split("\n").slice(0, -1).join("\n");
		expect(body).not.toContain(starSlash);
		expect(body).toContain(`a${escaped}b${escaped}c`);
	});

	it("leaves an ordinary report line (no star-slash pair) unchanged", () => {
		const header = renderHeader(["Guessed: TypeScript keys from SQL names."]);
		expect(header).toContain(" * Guessed: TypeScript keys from SQL names.");
	});

	it("explains the visible escape in the header's own intro, only when a report line actually needed one", () => {
		const escapedHeader = renderHeader([
			`Omitted: column "app.widgets.a${starSlash}b" -- danger.`,
		]);
		expect(escapedHeader).toContain(
			"A comment-ending pair inside a name below is escaped with a backslash.",
		);

		const ordinaryHeader = renderHeader([
			"Guessed: TypeScript keys from SQL names.",
		]);
		expect(ordinaryHeader).not.toContain("escaped with a backslash");
	});
});

describe("emitDeclarationFiles / D106 R3-B3: a foreign key's own catalog name", () => {
	const postsTable: TableSnapshot = {
		schema: "app",
		name: "posts",
		columns: [
			{
				name: "id",
				typeNode: { typeName: "uuid" },
				notNull: true,
				primaryKey: true,
			},
		],
		indexes: [],
		foreignKeys: [],
		primaryKeyName: "posts_pkey",
	};
	const commentsWithFkName = (name: string): TableSnapshot => ({
		schema: "app",
		name: "comments",
		columns: [
			{
				name: "id",
				typeNode: { typeName: "uuid" },
				notNull: true,
				primaryKey: true,
			},
			{ name: "post_id", typeNode: { typeName: "uuid" }, notNull: true },
		],
		indexes: [],
		foreignKeys: [
			{
				name,
				columns: ["post_id"],
				referencesTable: "app.posts",
				referencesColumns: ["id"],
			},
		],
		primaryKeyName: "comments_pkey",
	});

	it("omits an explicit name when the catalog name matches what hejbro would derive -- a hejbro-created database's own golden stays byte-identical", () => {
		const files = emitDeclarationFiles(
			resultFor([postsTable, commentsWithFkName("comments_post_id_fk")]),
		);
		const [file] = files;
		if (file === undefined) {
			throw new Error("expected one file");
		}
		expect(file.source).toContain(
			"references: { table: posts, columns: [posts.id] } }",
		);
		expect(file.source).not.toContain("name:");
	});

	it("emits the catalog's own name explicitly when it differs from what hejbro would derive", () => {
		const files = emitDeclarationFiles(
			resultFor([postsTable, commentsWithFkName("comments_post_id_fkey")]),
		);
		const [file] = files;
		if (file === undefined) {
			throw new Error("expected one file");
		}
		expect(file.source).toContain(
			'references: { table: posts, columns: [posts.id] }, name: "comments_post_id_fkey" }',
		);
	});
});

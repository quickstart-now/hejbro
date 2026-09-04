import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { CHECK_CATALOG_QUERIES, readCatalog } from "../src/check/catalog";

type CatalogQueryKey = keyof typeof CHECK_CATALOG_QUERIES;

const FIXTURE_ROWS: {
	readonly [K in CatalogQueryKey]: ReadonlyArray<DriverRow>;
} = {
	schemas: [{ schema: "app" }],
	tables: [{ schema: "app", table: "posts", rls: true }],
	columns: [
		{
			schema: "app",
			table: "posts",
			name: "id",
			notNull: true,
			catalogType: "integer",
			baseTypeKind: null,
			baseTypeSchema: null,
			baseTypeName: null,
			catalogDefault: null,
			catalogGenerated: null,
		},
	],
	constraints: [
		{
			schema: "app",
			table: "posts",
			name: "posts_pkey",
			type: "p",
			columns: ["id"],
		},
	],
	indexes: [
		{
			schema: "app",
			table: "posts",
			name: "posts_slug_idx",
			predicate: null,
			expressions: [],
		},
	],
	enums: [{ schema: "app", name: "status" }],
	sequences: [{ schema: "app", name: "posts_id_seq" }],
	functions: [{ schema: "app", name: "touch_updated_at" }],
	views: [{ schema: "app", name: "posts_view" }],
	policies: [{ schema: "app", table: "posts", name: "posts_select" }],
	triggers: [{ schema: "app", table: "posts", name: "posts_touch" }],
	tableGrants: [
		{
			schema: "app",
			table: "posts",
			role: "authenticated",
			privilege: "SELECT",
		},
	],
	schemaUsageGrants: [
		{ schema: "app", role: "authenticated", privilege: "USAGE" },
	],
	defaultTableGrants: [
		{ schema: "app", role: "authenticated", privilege: "SELECT" },
	],
	extensions: [{ name: "pgcrypto" }],
};

/** A fake single-connection session that answers each query by matching its exact text against {@link CHECK_CATALOG_QUERIES} -- order-independent, since `readCatalog` is free to run its reads concurrently in any order. */
const makeFakeSession = (): {
	readonly session: DriverSession;
	readonly calls: CompileResult[];
} => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			const entry = (
				Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
					[CatalogQueryKey, string]
				>
			).find(([, sql]) => sql === compiled.sql);
			if (entry === undefined) {
				throw new Error(
					`unexpected query sent to readCatalog: ${compiled.sql}`,
				);
			}
			return FIXTURE_ROWS[entry[0]];
		},
	};
	return { session, calls };
};

describe("readCatalog", () => {
	it("issues only parameterless read-only statements", async () => {
		const { session, calls } = makeFakeSession();

		await readCatalog(session);

		expect(calls).toHaveLength(Object.keys(CHECK_CATALOG_QUERIES).length);
		expect(
			calls.every(
				(call) =>
					call.params.length === 0 && /^select\b/i.test(call.sql.trim()),
			),
		).toBe(true);
	});

	it("returns the catalog rows the comparison needs", async () => {
		const { session } = makeFakeSession();

		const catalog = await readCatalog(session);

		expect(catalog).toEqual(FIXTURE_ROWS);
	});
});

describe("readCatalog / 1.2 columns and indexes carry expression texts", () => {
	// #778/#781: a generated column's expression and an index's predicate
	// and expression columns are new catalog-read fields this group's
	// comparison (1.3-1.5) needs -- pinned here at the read boundary so a
	// later regression shows up as a parse failure, not a silent `null`.
	it("pins the columns query text to attgenerated, and the indexes query text to indpred and pg_get_indexdef", () => {
		expect(CHECK_CATALOG_QUERIES.columns).toContain("attgenerated");
		expect(CHECK_CATALOG_QUERIES.indexes).toContain("indpred");
		expect(CHECK_CATALOG_QUERIES.indexes).toContain("pg_get_indexdef");
	});

	it("parses a generated column's row with catalogGenerated set and catalogDefault null", async () => {
		const rows: ReadonlyArray<DriverRow> = [
			{
				schema: "app",
				table: "posts",
				name: "total",
				notNull: false,
				catalogType: "numeric",
				baseTypeKind: null,
				baseTypeSchema: null,
				baseTypeName: null,
				catalogDefault: null,
				catalogGenerated: "(price * (qty)::numeric)",
			},
		];
		const session: DriverSession = {
			execute: async (compiled) => {
				if (compiled.sql === CHECK_CATALOG_QUERIES.columns) {
					return rows;
				}
				const entry = (
					Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
						[CatalogQueryKey, string]
					>
				).find(([key, sql]) => key !== "columns" && sql === compiled.sql);
				if (entry === undefined) {
					throw new Error(
						`unexpected query sent to readCatalog: ${compiled.sql}`,
					);
				}
				return FIXTURE_ROWS[entry[0]];
			},
		};

		const catalog = await readCatalog(session);

		expect(catalog.columns).toEqual(rows);
	});

	it("parses a partial, expression index's row with predicate and expressions set", async () => {
		const rows: ReadonlyArray<DriverRow> = [
			{
				schema: "app",
				table: "posts",
				name: "posts_partial_lower_idx",
				predicate: "(archived_at IS NULL)",
				expressions: ["lower(email)"],
			},
		];
		const session: DriverSession = {
			execute: async (compiled) => {
				if (compiled.sql === CHECK_CATALOG_QUERIES.indexes) {
					return rows;
				}
				const entry = (
					Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
						[CatalogQueryKey, string]
					>
				).find(([key, sql]) => key !== "indexes" && sql === compiled.sql);
				if (entry === undefined) {
					throw new Error(
						`unexpected query sent to readCatalog: ${compiled.sql}`,
					);
				}
				return FIXTURE_ROWS[entry[0]];
			},
		};

		const catalog = await readCatalog(session);

		expect(catalog.indexes).toEqual(rows);
	});
});

describe("CHECK_CATALOG_QUERIES.tableGrants / 1.4", () => {
	// information_schema.role_table_grants shows only the grants the
	// connected role is party to (grantor/grantee/membership) -- a
	// limited role reading it would see fewer grants than exist, and
	// `check` would report a real grant as absent. aclexplode on
	// pg_class.relacl directly is not role-filtered: every login role
	// reads the same access list. This is a query-text pin, not a
	// semantic proof: a unit test cannot run aclexplode() against a real
	// catalog under two different roles. 6.4 is the live witness that
	// proves the semantics this text only pins.
	it("pins tableGrants' query text to aclexplode(c.relacl), not information_schema (semantics proved by 6.4)", () => {
		expect(CHECK_CATALOG_QUERIES.tableGrants).not.toContain(
			"information_schema",
		);
		expect(CHECK_CATALOG_QUERIES.tableGrants).toContain("aclexplode");
		expect(CHECK_CATALOG_QUERIES.tableGrants).toContain("c.relacl");
	});

	// A null relacl means "the owner's default privileges", not "no
	// privileges" -- aclexplode(NULL) returns zero rows, so reading
	// relacl bare would silently drop every un-explicitly-granted
	// owner's-default privilege, bringing the same wrong "missing" back
	// through a different door for any project that grants to the
	// owning role. This is a query-text pin, not a semantic proof: a unit
	// test cannot run acldefault() against a real catalog. 6.4 is the
	// live witness that proves the semantics this text only pins.
	it("pins tableGrants to a role-independent catalog source (semantics proved by 6.4)", () => {
		expect(CHECK_CATALOG_QUERIES.tableGrants).toContain("acldefault");
		expect(CHECK_CATALOG_QUERIES.tableGrants).toContain("coalesce(c.relacl");
	});

	// grantee::regrole::text quotes an identifier only when Postgres itself
	// decides it needs quoting -- a role with uppercase letters, a hyphen,
	// or a reserved word then reads back quoted ("Reader") while nothing
	// in a declaration is ever spelled that way, so a real grant compares
	// as absent. pg_get_userbyid() returns the bare role name, unquoted,
	// every time.
	it("spells a grantee with pg_get_userbyid, never regrole::text", () => {
		expect(CHECK_CATALOG_QUERIES.tableGrants).toContain("pg_get_userbyid");
		expect(CHECK_CATALOG_QUERIES.tableGrants).not.toContain("regrole");
		expect(CHECK_CATALOG_QUERIES.schemaUsageGrants).toContain(
			"pg_get_userbyid",
		);
		expect(CHECK_CATALOG_QUERIES.schemaUsageGrants).not.toContain("regrole");
		expect(CHECK_CATALOG_QUERIES.defaultTableGrants).toContain(
			"pg_get_userbyid",
		);
		expect(CHECK_CATALOG_QUERIES.defaultTableGrants).not.toContain("regrole");
	});
});

describe("readCatalog / grantee spelling round-trips a mixed-case role", () => {
	it("returns a mixed-case role name verbatim, never case-folded", async () => {
		const rows: ReadonlyArray<DriverRow> = [
			{ schema: "app", table: "posts", role: "Reader", privilege: "SELECT" },
		];
		const session: DriverSession = {
			execute: async (compiled) => {
				if (compiled.sql === CHECK_CATALOG_QUERIES.tableGrants) {
					return rows;
				}
				const entry = (
					Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
						[CatalogQueryKey, string]
					>
				).find(([key, sql]) => key !== "tableGrants" && sql === compiled.sql);
				if (entry === undefined) {
					throw new Error(
						`unexpected query sent to readCatalog: ${compiled.sql}`,
					);
				}
				return FIXTURE_ROWS[entry[0]];
			},
		};

		const catalog = await readCatalog(session);

		expect(catalog.tableGrants).toEqual([
			{ schema: "app", table: "posts", role: "Reader", privilege: "SELECT" },
		]);
	});
});

describe("readCatalog / 1.4 unreadable catalog", () => {
	it("fails with a coded error when a catalog read is refused", async () => {
		const session: DriverSession = {
			execute: async () => {
				throw Object.assign(new Error("permission denied for schema app"), {
					code: "42501",
				});
			},
		};

		await expect(readCatalog(session)).rejects.toEqual(
			expect.objectContaining({ code: "check-catalog-unreadable" }),
		);
	});
});
